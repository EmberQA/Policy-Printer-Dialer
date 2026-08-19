/**
 * The Telnyx implementation of `VoiceTransport` (ENG-159 — Subplan 05).
 *
 * Reaches the browser as a SIP endpoint (`<Dial><Sip>`) rather than a Twilio
 * `<Client>`, because TeXML has no `<Client>` element. Three structural differences
 * from `TwilioTransport` drive everything below — none are stylistic:
 *
 * 1. NO PER-CALL EVENT EMITTER. There is no `call.on('accept')`. Every state change
 *    arrives on the CLIENT-level `telnyx.notification` stream as
 *    `{type: 'callUpdate', call}`, so this class demultiplexes by `call.id` and
 *    synthesizes the Twilio-shaped events itself. See `callStateEvents.ts`.
 *
 * 2. NO `updateToken`. The token is 24h (vs Twilio's 1h) and there is no in-place
 *    refresh — renewing it means reconnecting the socket, which would drop a live
 *    call. So refresh is scheduled on a timer AND deferred while a call is up.
 *
 * 3. AUDIO PLAYS THROUGH AN HTMLMediaElement. `client.remoteElement` is the sink, so
 *    arming audio is `element.play()` inside the user gesture — which DELETES the
 *    Twilio private-`_audioContext` hack rather than porting it.
 *
 * ⚠️ `preferred_codecs` is deliberately absent. It exists only on `ICallOptions`, and
 * every leg we handle is an INCOMING call the SDK constructs from the INVITE (outbound
 * bridges back to us as an incoming leg too), so the browser can never pin codecs on
 * this carrier. Opus is guaranteed on the credential CONNECTION instead — see
 * `ensureConnectionCodecs` in the backend's `dialer/telnyx.ts`.
 */

import {TelnyxRTC} from '@telnyx/webrtc';
import {
	isNewIncomingState,
	isTerminalState,
	legStateTransition
} from './callStateEvents';
import { normalizeTelnyxHeaders } from './legParameters';
import { readRttMs } from './rtcStats';
import {TelnyxHoldController} from './telnyxHold';
import type {
	IncomingLeg,
	LegEvent,
	TransportStatus,
	VoiceTransport,
	VoiceTransportOptions
} from './VoiceTransport';

/**
 * Token lifetime is checked on a SHORT TICK against the token's own expiry, rather than
 * scheduled as one long timer.
 *
 * ⚠️ WHY, because the obvious "setTimeout(18h)" is what this replaces. A single long timer
 * is one-shot: whether the refresh succeeded or failed, the next attempt was another 18
 * hours away — so one transient blip at the 18h mark meant either an agent going silently
 * offline at hour 24 (when the token actually died) or, if the reconnect was the half that
 * failed, going offline immediately with nothing to retry until hour 36. A softphone tab
 * open for a full shift is the normal case here, so that is not a rare shape.
 *
 * Ticking every 15 minutes and refreshing once we are within an hour of expiry fixes both
 * halves at once: a failed attempt simply gets retried on the next tick, with ~4 attempts
 * of runway inside the margin, and no retry/backoff bookkeeping of its own.
 */
const TOKEN_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000;
/** Fallback lifetime when a token carries no readable `exp` (Telnyx issues 24h). */
const TOKEN_ASSUMED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Read a JWT's `exp` as epoch milliseconds, without verifying it — we are not trusting
 * this token, we minted it; we only need to know when it dies. Returns null when the
 * token is not a readable JWT, and the caller falls back to an assumed lifetime.
 */
export const readTokenExpiry = (token: string): number | null => {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
		const exp = (JSON.parse(json) as {exp?: unknown}).exp;
		return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
	} catch {
		return null;
	}
};
/** Matches Twilio's `sample` cadence so the quality chip updates identically. */
const RTT_POLL_MS = 1_000;

/** The slice of the SDK's Call we use, so tests and hosts don't need the class. */
interface TelnyxCall {
	id: string;
	state: string;
	options?: {
		customHeaders?: Array<{name?: string; value?: string}>;
		remoteCallerNumber?: string;
	};
	answer(): void;
	hangup(): Promise<void> | void;
	muteAudio(): void;
	unmuteAudio(): void;
	readonly isAudioMuted: boolean;
	deaf(): void;
	undeaf(): void;
	readonly localStream: MediaStream | null;
	readonly peer?: {instance?: RTCPeerConnection | null} | null;
	setAudioInDevice(deviceId: string): Promise<void>;
	setAudioOutDevice(deviceId: string): Promise<boolean>;
}

export class TelnyxTransport implements VoiceTransport {
	readonly provider = 'telnyx' as const;

	private client: InstanceType<typeof TelnyxRTC> | null = null;
	private remoteAudio: HTMLAudioElement | null = null;
	private legs = new Map<string, TelnyxLeg>();
	private holdController: TelnyxHoldController | null = null;
	private incomingCb: ((leg: IncomingLeg) => void) | null = null;
	private statusCb: ((s: TransportStatus, e?: string) => void) | null = null;
	private refreshTimer: number | null = null;
	/** When the CURRENT token dies, read from the token itself. */
	private tokenExpiresAt: number | null = null;
	/** A refresh is in flight — the tick and the call-end trigger must not overlap. */
	private refreshing = false;
	/**
	 * Only the OUTPUT selection is mirrored here. The mic needs no local copy: the
	 * `BaseCall` constructor reads `micId` and the session's audio constraints off the
	 * client, so a device chosen while idle is inherited by the next inbound call.
	 * The remote `<audio>` element is ours, so its sink is ours to reapply.
	 */
	private outputDeviceId = 'default';
	private destroyed = false;

	constructor(private readonly options: VoiceTransportOptions) {}

	async register(token: string): Promise<void> {
		this.statusCb?.('connecting');
		this.client = await this.buildClient(token);
		this.rememberTokenExpiry(token);
		this.startRefreshTicker();
	}

	/**
	 * Build a client, wire it, and bring the socket up. Returns it rather than assigning
	 * `this.client`, so a refresh can connect its replacement BEFORE retiring the working
	 * one — see `refreshNow`.
	 */
	private async buildClient(
		token: string
	): Promise<InstanceType<typeof TelnyxRTC>> {
		const client = new TelnyxRTC({login_token: token});

		// The SDK plays remote audio into this element. It must exist before connect so
		// an immediately-arriving call has somewhere to land.
		client.remoteElement = this.ensureRemoteAudio();
		client.enableMicrophone();

		client.on('telnyx.ready', () => this.statusCb?.('registered'));
		client.on('telnyx.socket.close', () => this.statusCb?.('offline'));
		client.on('telnyx.error', (event: unknown) => {
			const error = (event as {error?: {message?: string; fatal?: boolean}})?.error;
			// Only a fatal error means the client is no longer usable. A recoverable one
			// (a transient media problem) must NOT flip us out of 'registered', or the
			// heartbeat reports the agent unroutable and the backend stops claiming
			// inbound calls for them.
			if (error?.fatal) this.statusCb?.('error', error?.message || 'Telnyx error');
			else this.options.onError?.(error?.message || 'Telnyx error');
		});
		client.on('telnyx.notification', (n: unknown) => this.onNotification(n));

		await client.connect();
		return client;
	}

	/**
	 * The one entry point for call state. Every leg event in the dialer is reconstructed
	 * from here.
	 */
	private onNotification(notification: unknown): void {
		const payload = notification as {
			type?: string;
			call?: TelnyxCall;
			error?: {message?: string};
		};

		if (payload?.type === 'userMediaError') {
			this.options.onError?.(
				payload.error?.message || 'Could not access your microphone.'
			);
			return;
		}
		if (payload?.type !== 'callUpdate' || !payload.call) return;

		const call = payload.call;
		const existing = this.legs.get(call.id);

		if (!existing) {
			// Headers ride on the INVITE, so they are readable at 'ringing' — before we
			// answer. Anything earlier (new/trying) carries no metadata yet.
			if (!isNewIncomingState(call.state)) return;
			const leg = new TelnyxLeg(call);
			this.legs.set(call.id, leg);
			this.incomingCb?.(leg);
			return;
		}

		const transition = legStateTransition(call.state, existing.everActive);
		if (transition.kind === 'event') {
			if (transition.event === 'accept') existing.markActive();
			existing.emit(transition.event);
		}

		if (isTerminalState(call.state)) {
			existing.dispose();
			this.legs.delete(call.id);
			// A refresh deferred because a call was up has been waiting for exactly this.
			if (this.legs.size === 0) void this.maybeRefresh();
		}
	}

	/* ── token refresh ─────────────────────────────────────────────────────────
	   The SDK has no `tokenWillExpire` and no `updateToken`, so both the schedule and the
	   reconnect are ours. The schedule is a short repeating CHECK against the token's own
	   expiry rather than one long timer to the deadline — see the constants above for why
	   the one-shot version was a liability. */

	private rememberTokenExpiry(token: string): void {
		this.tokenExpiresAt =
			readTokenExpiry(token) ?? Date.now() + TOKEN_ASSUMED_TTL_MS;
	}

	private startRefreshTicker(): void {
		if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
		this.refreshTimer = window.setInterval(() => {
			void this.maybeRefresh();
		}, TOKEN_CHECK_INTERVAL_MS);
	}

	/**
	 * Refresh if the token is close enough to death and the line is clear. Called on the
	 * tick and again whenever the last call ends.
	 *
	 * Deferral needs no queue: if a call is up we simply do nothing, and the next tick
	 * (or the call ending) asks again — against a fresh clock rather than a decision made
	 * minutes ago. The margin is an hour, so a deferral has ~4 more chances before the
	 * token actually expires.
	 */
	private async maybeRefresh(): Promise<void> {
		if (this.destroyed || this.refreshing) return;
		if (this.tokenExpiresAt === null) return;
		if (Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) return;
		if (this.legs.size > 0) return;

		this.refreshing = true;
		try {
			await this.refreshNow();
		} finally {
			this.refreshing = false;
		}
	}

	private async refreshNow(): Promise<void> {
		try {
			const token = await this.options.refreshToken();
			if (this.destroyed) return;

			// CONNECT THE REPLACEMENT BEFORE RETIRING THE WORKING CLIENT. Disconnecting
			// first — as this used to — meant a reconnect that failed for any reason left
			// the agent with no transport at all, offline until they happened to reload.
			// Building first means a failure here costs nothing: the old client is still
			// registered and still taking calls, and the next tick tries again.
			const next = await this.buildClient(token);
			if (this.destroyed) {
				try {
					await next.disconnect();
				} catch {
					/* nothing to unwind */
				}
				return;
			}

			const previous = this.client;
			this.client = next;
			this.rememberTokenExpiry(token);
			try {
				await previous?.disconnect();
			} catch {
				/* the socket may already be gone */
			}
		} catch {
			// Leave the existing client exactly where it is; it is still the working one.
			this.options.onError?.('Failed to refresh the Telnyx token');
		}
	}

	destroy(): void {
		this.destroyed = true;
		if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
		this.refreshTimer = null;
		void this.stopHold().catch(() => undefined);
		for (const leg of this.legs.values()) leg.dispose();
		this.legs.clear();
		try {
			void this.client?.disconnect();
		} catch {
			/* ignore */
		}
		this.client = null;
		this.remoteAudio?.remove();
		this.remoteAudio = null;
	}

	onIncoming(cb: (leg: IncomingLeg) => void): void {
		this.incomingCb = cb;
	}

	onStatus(cb: (status: TransportStatus, error?: string) => void): void {
		this.statusCb = cb;
	}

	/**
	 * Telnyx plays call audio through an HTMLMediaElement, so priming it is an ordinary
	 * `play()` inside the click gesture — no private fields, no shared AudioContext.
	 */
	async armAudio(): Promise<void> {
		try {
			await this.ensureRemoteAudio().play();
		} catch {
			/* non-fatal: mic is granted; playback may still start when a call attaches */
		}
	}

	/**
	 * Device selection is per-CALL on Telnyx but our settings UI is reachable outside a
	 * call, so route to the client when idle and to the live call when active — and
	 * remember the choice either way, so the next call inherits it.
	 */
	async setInputDevice(deviceId: string): Promise<void> {
		const call = this.activeCall();

		// ⚠️ NEVER SWITCH THE LIVE SENDER WHILE THE CALL IS HELD. Hold works by
		// `replaceTrack(musicTrack)` on the call's audio sender — and `setAudioInDevice`
		// replaces the track on that same sender. Calling it here would swap the hold
		// music back out for the agent's LIVE MICROPHONE: the caller, who was just put on
		// hold, starts hearing the room, while the agent (still `deaf()`) cannot hear them
		// and has no idea it happened. Hand the new device to the hold controller instead,
		// so the music keeps playing and Resume restores the microphone they just chose.
		if (call && this.holdController) {
			await this.holdController.setHeldInputDevice(deviceId);
			await this.persistInputPreference(deviceId);
			return;
		}

		if (call) {
			await call.setAudioInDevice(deviceId);
			// AND persist it on the client. Without this the change applies to the current
			// call only: the SDK builds each new call from the client's own `micId`, so the
			// next inbound silently reverts to the previous device while the settings UI
			// still shows the one the agent picked.
			await this.persistInputPreference(deviceId);
			return;
		}

		await this.persistInputPreference(deviceId);
	}

	/** The client-level microphone preference every future SDK-created call inherits. */
	private async persistInputPreference(deviceId: string): Promise<void> {
		const client = this.client;
		if (!client) throw new Error('Softphone audio is not ready yet.');
		client.micId = deviceId;
		await client.setAudioSettings({micId: deviceId});
	}

	async setOutputDevice(deviceId: string): Promise<void> {
		this.outputDeviceId = deviceId;
		const client = this.client;
		if (!client) throw new Error('Softphone audio is not ready yet.');
		// The client setter only STORES the preference (applied when a call attaches),
		// so also point our own element at the speaker now — otherwise a change made
		// while idle is inaudible until the next call.
		client.speaker = deviceId;
		await this.applySinkId(deviceId);
		const call = this.activeCall();
		if (call) await call.setAudioOutDevice(deviceId);
	}

	async startHold(): Promise<void> {
		const call = this.activeCall();
		if (!call) throw new Error('There is no active call to place on hold.');
		if (this.holdController) return;
		const controller = new TelnyxHoldController(call);
		this.holdController = controller;
		try {
			await controller.start();
		} catch (error) {
			if (this.holdController === controller) this.holdController = null;
			await controller.stop().catch(() => undefined);
			throw error;
		}
	}

	async stopHold(): Promise<void> {
		const controller = this.holdController;
		if (!controller) return;
		await controller.stop();
		this.holdController = null;
	}

	/** The one leg that has actually connected, if any. */
	private activeCall(): TelnyxCall | null {
		for (const leg of this.legs.values()) {
			if (leg.everActive) return leg.call;
		}
		return null;
	}

	private ensureRemoteAudio(): HTMLAudioElement {
		if (this.remoteAudio) return this.remoteAudio;
		const element = document.createElement('audio');
		element.autoplay = true;
		element.setAttribute('playsinline', '');
		element.style.display = 'none';
		document.body.appendChild(element);
		this.remoteAudio = element;
		void this.applySinkId(this.outputDeviceId);
		return element;
	}

	private async applySinkId(deviceId: string): Promise<void> {
		const element = this.remoteAudio as
			| (HTMLAudioElement & {setSinkId?: (id: string) => Promise<void>})
			| null;
		if (!element?.setSinkId) return;
		try {
			await element.setSinkId(deviceId);
		} catch {
			/* the browser may not support output selection; the default speaker stands */
		}
	}
}

/**
 * One Telnyx SIP leg behind the carrier-neutral interface.
 *
 * Holds its own listener table because the SDK gives us no per-call emitter — the
 * transport pushes events in via `emit`.
 */
class TelnyxLeg implements IncomingLeg {
	readonly legId: string;
	readonly from: string | null;
	readonly params: Record<string, string>;
	/** The single bit that separates "the caller hung up" from "the caller gave up". */
	everActive = false;

	private handlers = new Map<LegEvent, Array<(payload?: unknown) => void>>();
	private rttTimer: number | null = null;
	private terminalEmitted = false;

	constructor(readonly call: TelnyxCall) {
		this.legId = call.id;
		this.from = call.options?.remoteCallerNumber || null;
		this.params = normalizeTelnyxHeaders(call.options?.customHeaders);
	}

	markActive(): void {
		this.everActive = true;
	}

	emit(event: LegEvent): void {
		// Terminal events fire at most once. Telnyx walks hangup → destroy → purge, and
		// each of those is a separate callUpdate that would otherwise re-run teardown.
		if (event === 'disconnect' || event === 'cancel') {
			if (this.terminalEmitted) return;
			this.terminalEmitted = true;
			this.stopRtt();
		}
		for (const handler of this.handlers.get(event) ?? []) handler();
	}

	accept(): void {
		this.call.answer();
	}

	/** No SIP-level reject; hanging up is the equivalent refusal. */
	reject(): void {
		void this.call.hangup();
	}

	/**
	 * Leave the leg ringing for whoever owns it. Deliberately a no-op: hanging up here
	 * would terminate the real owner's call, which is the exact bug Twilio's `ignore()`
	 * exists to avoid.
	 */
	ignore(): void {}

	disconnect(): void {
		void this.call.hangup();
	}

	mute(muted: boolean): void {
		if (muted) this.call.muteAudio();
		else this.call.unmuteAudio();
	}

	isMuted(): boolean {
		return this.call.isAudioMuted;
	}

	on(event: LegEvent, cb: (payload?: unknown) => void): void {
		const existing = this.handlers.get(event);
		if (existing) existing.push(cb);
		else this.handlers.set(event, [cb]);
	}

	/** No `sample` event here, so poll the peer connection the SDK already exposes. */
	onRtt(cb: (ms: number | null) => void): void {
		this.stopRtt();
		this.rttTimer = window.setInterval(() => {
			const peer = this.call.peer?.instance;
			if (!peer || typeof peer.getStats !== 'function') {
				cb(null);
				return;
			}
			void peer
				.getStats()
				.then((report) => cb(readRttMs(report)))
				.catch(() => cb(null));
		}, RTT_POLL_MS);
	}

	dispose(): void {
		this.stopRtt();
		this.handlers.clear();
	}

	private stopRtt(): void {
		if (this.rttTimer !== null) window.clearInterval(this.rttTimer);
		this.rttTimer = null;
	}
}
