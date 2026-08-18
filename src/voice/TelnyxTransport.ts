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

/** Telnyx tokens last 24h; renew at 75% so a failed attempt has hours of runway. */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_AT_MS = TOKEN_TTL_MS * 0.75;
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
	/** A refresh that came due mid-call and is waiting for the line to clear. */
	private refreshPending = false;
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
		await this.connectWith(token);
		this.scheduleRefresh();
	}

	private async connectWith(token: string): Promise<void> {
		const client = new TelnyxRTC({login_token: token});
		this.client = client;

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
			// A refresh that came due mid-call has been waiting for exactly this.
			if (this.refreshPending && this.legs.size === 0) void this.refreshNow();
		}
	}

	/* ── token refresh ─────────────────────────────────────────────────────────
	   The SDK has no `tokenWillExpire` and no `updateToken`, so the schedule and the
	   reconnect are both ours. An 18h timer against a minutes-long call makes deferral
	   free — there is no scenario where waiting for the line to clear risks expiry. */

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			if (this.destroyed) return;
			if (this.legs.size > 0) {
				this.refreshPending = true;
				return;
			}
			void this.refreshNow();
		}, TOKEN_REFRESH_AT_MS);
	}

	private async refreshNow(): Promise<void> {
		this.refreshPending = false;
		try {
			const token = await this.options.refreshToken();
			if (this.destroyed) return;
			const previous = this.client;
			this.client = null;
			try {
				await previous?.disconnect();
			} catch {
				/* the socket may already be gone */
			}
			this.statusCb?.('connecting');
			await this.connectWith(token);
		} catch {
			this.options.onError?.('Failed to refresh the Telnyx token');
		} finally {
			if (!this.destroyed) this.scheduleRefresh();
		}
	}

	destroy(): void {
		this.destroyed = true;
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
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
		if (call) {
			await call.setAudioInDevice(deviceId);
			return;
		}
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
