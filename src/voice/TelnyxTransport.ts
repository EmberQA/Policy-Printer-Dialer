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
import {TelnyxConsultation} from './TelnyxConsultation';
import {TelnyxSupervision} from './TelnyxSupervision';
import {TelnyxMicrophone, stopMicrophoneStream} from './TelnyxMicrophone';
import type {
	IncomingLeg,
	LegEvent,
	TransportStatus,
	VoiceTransport,
	VoiceTransportOptions,
	CallParticipantState,
	StartParticipant,
	ExpectSupervision,
	SupervisionRole,
	SupervisionState
} from './VoiceTransport';

interface TelnyxTransportOptions extends VoiceTransportOptions {
	inputDeviceId?: string;
	outputDeviceId?: string;
}

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
	options: {
		localStream?: MediaStream;
		audio?: boolean;
		receiveOnlyAudio?: boolean;
		micId?: string;
		customHeaders?: Array<{name?: string; value?: string}>;
		remoteCallerNumber?: string;
	};
	/** Carrier-side ids of this leg. `telnyxCallControlId` is what another agent's
	 *  supervisor would target; logged on accept during the supervision experiments. */
	readonly telnyxIDs?: {
		telnyxCallControlId?: string;
		telnyxSessionId?: string;
		telnyxLegId?: string;
	};
	answer(): void;
	hangup(): Promise<void> | void;
	muteAudio(): void;
	unmuteAudio(): void;
	readonly isAudioMuted: boolean;
	deaf(): void;
	undeaf(): void;
	readonly localStream: MediaStream | null;
	readonly remoteStream: MediaStream | null;
	readonly peer?: {instance?: RTCPeerConnection | null} | null;
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
	/** Reapplied whenever token refresh constructs a replacement Telnyx client. */
	private inputDeviceId = 'default';
	private microphone: TelnyxMicrophone;
	private inputSwitches = 0;
	private outputDeviceId = 'default';
	private destroyed = false;
	private consultation: TelnyxConsultation;
	private participantCb: ((state: CallParticipantState) => void) | null = null;
	private supervision: TelnyxSupervision;
	private supervisionCb: ((state: SupervisionState) => void) | null = null;

	constructor(private readonly options: TelnyxTransportOptions) {
		this.inputDeviceId = options.inputDeviceId ?? 'default';
		this.outputDeviceId = options.outputDeviceId ?? 'default';
		this.microphone = new TelnyxMicrophone(this.inputDeviceId, () => {
			this.options.onError?.('Your selected microphone disconnected. Reconnect it and select it in Audio Setup.');
		});
		this.supervision = new TelnyxSupervision({
			prepareAudio: call => {
				if (!call.options) throw new Error('Call audio is not ready.');
				call.options.localStream = this.microphone.clone();
			},
			changed: state => this.supervisionCb?.(state),
			log: (step, data) => console.info('[dialer][supervision]', step, data)
		});
		this.consultation = new TelnyxConsultation({
			primary: () => this.activeCall(),
			canStart: () => !this.inputSwitches && !this.holdController && !this.activeCall()?.isAudioMuted && !this.destroyed,
			outputDevice: () => this.outputDeviceId,
			changed: state => this.participantCb?.(state),
			dial: (to, from, remoteElement, id) => {
				if (!this.client) throw new Error('Telnyx is not registered.');
				const localStream = this.microphone.clone();
				try {
					return this.client.newCall({id, destinationNumber: to, callerNumber: from, remoteElement, micId: this.inputDeviceId, localStream});
				} catch (error) {
					stopMicrophoneStream(localStream);
					throw error;
				}
			}
		});
	}

	onParticipantChange(cb: (state: CallParticipantState) => void): void { this.participantCb = cb; }
	startParticipant(request: StartParticipant): Promise<void> { return this.consultation.start(request); }
	mergeParticipant(): Promise<void> { return this.consultation.merge(); }
	endParticipant(): Promise<void> { return this.consultation.end(); }

	onSupervisionChange(cb: (state: SupervisionState) => void): void { this.supervisionCb = cb; }
	expectSupervision(request: ExpectSupervision): void {
		if (this.inputSwitches) throw new Error('Wait for the microphone change to finish.');
		if (this.activeCall() || this.consultation.busy) throw new Error('End your current call before supervising.');
		this.supervision.expect(request);
	}
	bindSupervisorLeg(callControlId: string): void { this.supervision.bindSupervisorLeg(callControlId); }
	cancelSupervision(): void { this.supervision.cancel(); }
	setSupervisionRole(role: SupervisionRole): void { this.supervision.setRole(role); }
	endSupervision(): Promise<void> { return this.supervision.end(); }

	async register(token: string): Promise<void> {
		this.statusCb?.('connecting');
		try { await this.microphone.ensure(); }
		catch { this.options.onError?.('Could not open your selected microphone. Select it in Audio Setup before taking calls.'); }
		if (this.destroyed) return;
		this.client = await this.buildClient(token);
		this.rememberTokenExpiry(token);
		this.startRefreshTicker();
	}

	/**
	 * Build a client, wire it, and bring the socket up. Returns it rather than assigning
	 * `this.client`, so a refresh can connect its replacement BEFORE retiring the working
	 * one — see `refreshNow`.
	 *
	 * ⚠️ The region is read off `this.options` on EVERY build, not captured once at
	 * `register`. That is what carries a wizard-discovered pin through `refreshNow` — which
	 * constructs a whole new client near the token's 24h expiry. Capture it once and a
	 * pinned agent silently reverts to the default host most of a day into their shift,
	 * which looks like a random overnight outage rather than a dropped setting.
	 */
	private async buildClient(
		token: string
	): Promise<InstanceType<typeof TelnyxRTC>> {
		const client = new TelnyxRTC({
			login_token: token,
			...(this.options.region ? {region: this.options.region} : {})
		});

		// The SDK plays remote audio into this element. It must exist before connect so
		// an immediately-arriving call has somewhere to land.
		client.remoteElement = this.ensureRemoteAudio();
		client.micId = this.inputDeviceId;
		client.speaker = this.outputDeviceId;
		client.enableMicrophone();

		client.on('telnyx.ready', () => this.statusCb?.('registered'));
		client.on('telnyx.socket.close', () => this.statusCb?.('offline'));
		client.on('telnyx.error', (event: unknown) => {
			const error = (event as {error?: {message?: string; fatal?: boolean}})?.error;
			// Only a fatal error means the client is no longer usable. A recoverable one
			// (a transient media problem) must NOT flip us out of 'registered', or the
			// heartbeat reports the agent unroutable and the backend stops claiming
			// inbound calls for them.
			// The SDK's own message is passed through when it has one; the fallback is
			// ours and is shown to the agent, so it stays carrier-neutral.
			if (error?.fatal)
				this.statusCb?.('error', error?.message || 'Call network error');
			else this.options.onError?.(error?.message || 'Call network error');
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
		// The SDK answers recovered legs itself, after synchronously announcing this
		// state. Give the replacement leg a clone before it can reacquire a default mic.
		if (call.state === 'recovering' && !call.options.localStream) {
			try { call.options.localStream = this.microphone.clone(); }
			catch (error) {
				// Make peer initialization fail instead of allowing SDK capture/fallback.
				call.options.audio = false;
				call.options.receiveOnlyAudio = false;
				this.options.onError?.(error instanceof Error ? error.message : 'Could not restore your microphone.');
			}
		}
		// Supervision legs are claimed (or refused) before anything else can see them.
		if (this.supervision?.onCall(call)) return;
		if (this.consultation?.onCall(call)) return;
		const existing = this.legs.get(call.id);

		if (!existing) {
			// Headers ride on the INVITE, so they are readable at 'ringing' — before we
			// answer. Anything earlier (new/trying) carries no metadata yet.
			if (!isNewIncomingState(call.state)) return;
			const leg = new TelnyxLeg(call, () => this.consultation?.busy ? this.consultation : null, () => {
				try {
					// Supplying localStream bypasses the SDK's default-device probing/fallback.
					call.options.localStream = this.microphone.clone();
					call.answer();
				} catch (error) {
					stopMicrophoneStream(call.options.localStream);
					this.options.onError?.(error instanceof Error ? error.message : 'Could not open your selected microphone.');
					leg.emit('error');
					void call.hangup();
				}
			});
			this.legs.set(call.id, leg);
			this.incomingCb?.(leg);
			return;
		}

		existing.call = call;
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
			// Agent-facing (renders as `device.error` on the Dial page), so no carrier name.
			this.options.onError?.('Reconnecting to the call network…');
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.microphone.destroy();
		this.supervision?.destroy();
		this.consultation?.destroy();
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
		await this.microphone.ensure();
		try {
			await this.ensureRemoteAudio().play();
		} catch {
			/* non-fatal: mic is granted; playback may still start when a call attaches */
		}
	}

	/** Acquire first; only commit the preference after the live call accepts it. */
	async setInputDevice(deviceId: string): Promise<void> {
		if (!this.client) throw new Error('Softphone audio is not ready yet.');
		if (this.consultation.busy) throw new Error('End the added call before switching audio devices.');
		if (this.supervision.busy) throw new Error('Stop supervising before switching audio devices.');
		this.inputSwitches++;
		try {
			await this.switchInputDevice(deviceId);
		} finally {
			this.inputSwitches--;
		}
	}

	private async switchInputDevice(deviceId: string): Promise<void> {
		await this.microphone.select(deviceId, async source => {
			// Recheck after capture: a call may have arrived while permission was pending.
			if (this.consultation.busy) throw new Error('End the added call before switching audio devices.');
			if (this.supervision.busy) throw new Error('Stop supervising before switching audio devices.');
			const call = this.activeCall();
			if (!call && this.legs.size) throw new Error('Wait for the call to connect before switching microphones.');
			if (!call) return;
			const next = source.clone();
			try {
				const track = next.getAudioTracks()[0];
				track.enabled = !call.isAudioMuted;
				if (this.holdController) {
					// Update Resume's saved track; the caller must keep hearing hold music.
					this.holdController.setHeldInputTrack(track);
				} else {
					const sender = call.peer?.instance?.getSenders().find(sender => sender.track?.kind === 'audio');
					if (!sender) throw new Error('Could not reach the call microphone.');
					await sender.replaceTrack(track);
				}
				if (this.destroyed || isTerminalState(call.state) || this.activeCall() !== call) throw new Error('The call has ended or reconnected. Select your microphone again.');
				track.enabled = !call.isAudioMuted;
				const previous = call.localStream;
				call.options.localStream = next;
				call.options.micId = deviceId;
				stopMicrophoneStream(previous);
			} catch (error) {
				stopMicrophoneStream(next);
				throw error;
			}
		});
		this.inputDeviceId = deviceId;
		if (this.client) this.client.micId = deviceId;
	}

	async setOutputDevice(deviceId: string): Promise<void> {
		if (this.consultation?.busy) throw new Error('End the added call before switching audio devices.');
		if (this.supervision?.busy) throw new Error('Stop supervising before switching audio devices.');
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
		if (this.inputSwitches) throw new Error('Wait for the microphone change to finish.');
		if (this.consultation?.busy) throw new Error('End the added call before changing hold.');
		if (this.supervision?.busy) throw new Error('Stop supervising before changing hold.');
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
	private answerStarted = false;

	constructor(public call: TelnyxCall, private readonly consultation: () => TelnyxConsultation | null, private readonly answer: () => void) {
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
		if (this.answerStarted || isTerminalState(this.call.state)) return;
		this.answerStarted = true;
		this.answer();
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
		const consultation = this.consultation();
		if (consultation) { consultation.setMuted(muted); return; }
		if (muted) this.call.muteAudio();
		else this.call.unmuteAudio();
	}

	isMuted(): boolean {
		const consultation = this.consultation();
		if (consultation) return consultation.isMuted;
		return this.call.isAudioMuted;
	}

	on(event: LegEvent, cb: (payload?: unknown) => void): void {
		const existing = this.handlers.get(event);
		if (existing) existing.push(cb);
		else this.handlers.set(event, [cb]);
	}

	carrierIds(): {sessionId?: string; legId?: string} {
		const ids = this.call.telnyxIDs;
		return {
			...(ids?.telnyxSessionId ? {sessionId: ids.telnyxSessionId} : {}),
			...(ids?.telnyxLegId ? {legId: ids.telnyxLegId} : {})
		};
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
