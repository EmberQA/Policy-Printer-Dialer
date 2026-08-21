/**
 * The carrier seam (ENG-159 — Subplan 05).
 *
 * `useDevice` owns the outbound attempt state machine, call ownership, ringback, the
 * answer tone, presence posting, and the caller-hangup notices — roughly a thousand
 * lines, none of which touch an SDK. This interface is everything that DOES, so both
 * carriers stay live simultaneously and re-deriving the state machine per provider is
 * never on the table.
 *
 * The provider is chosen by the BACKEND: `/policyPrinter/dialer/voice/token` returns
 * `{provider, token}` based on `dialer_agents.voice_provider`, so flipping an agent
 * changes the next token their browser fetches — no deploy, no client flag.
 *
 * ─── Two deliberate deviations from the drafted interface ─────────────────────
 *
 * 1. NO `refreshAuth(token)`. A transport takes `refreshToken` at construction and owns
 *    its own scheduling, because the carriers must be driven differently and the caller
 *    cannot know which: Twilio's SDK fires `tokenWillExpire` on a 1h token, while
 *    Telnyx's 24h token has no equivalent event AND no in-place update — refreshing it
 *    means reconnecting the socket, which the transport must defer while a call is up.
 *    A `refreshAuth` the hook calls would force that policy into the hook.
 *
 * 2. `onRtt(cb)` RATHER THAN `rtt(): Promise`. Twilio pushes a quality sample every
 *    second; a pull API would make us poll a carrier that already streams.
 */

import type {TwilioCustomParameters} from './legParameters';

export type VoiceProvider = 'telnyx' | 'twilio';

/** Mirrors `TwilioDeviceStatus` in lib/api.ts — the value posted on the heartbeat. */
export type TransportStatus = 'registered' | 'connecting' | 'offline' | 'error';

export type LegEvent = 'accept' | 'disconnect' | 'cancel' | 'reject' | 'error';

/**
 * One inbound leg at the browser. EVERY call the dialer handles arrives this way,
 * including outbound: the backend REST-originates the customer leg and bridges it back
 * to us, so from here an outbound call is an incoming leg carrying
 * `call_direction: 'outbound'`.
 */
export interface IncomingLeg {
	/**
	 * Local identity for this leg. Twilio: the browser Client-leg `CallSid`.
	 * Telnyx: `call.id`.
	 *
	 * ⚠️ This is NOT the value the backend receives. It fills exactly one role — the
	 * staleness key behind `clearActiveCallOwner`, so a late terminal event from an
	 * older leg cannot erase a newer call. The id the backend gets is
	 * `ActiveCall.callSid`, which comes from `parent_call_sid` on both carriers.
	 *
	 * On Telnyx this is deliberately `call.id` rather than `telnyxCallControlId`:
	 * `call.id` is always present and locally unique, whereas the call-control id can
	 * be undefined and is a carrier-side identity we have no local use for.
	 */
	legId: string;
	/** The caller's number, best-effort. Overridden for outbound by the dialed number. */
	from: string | null;
	/** Backend-supplied metadata, normalized across both carriers. See legParameters.ts. */
	params: Record<string, string>;
	accept(): void;
	/** Refuse the leg and tell the carrier. Used only when we do not own it. */
	reject(): void;
	/** Leave the leg alone — another tab owns it. Must NOT signal the carrier. */
	ignore(): void;
	/** End a leg we accepted. */
	disconnect(): void;
	mute(muted: boolean): void;
	isMuted(): boolean;
	on(event: LegEvent, cb: (payload?: unknown) => void): void;
	/** Live round-trip time in ms, or null when unavailable. */
	onRtt(cb: (ms: number | null) => void): void;
}

export interface VoiceTransportOptions {
	/**
	 * Mint a fresh token. The transport calls this on its own schedule; see the note
	 * above about why refresh policy lives here rather than in the hook.
	 */
	refreshToken: () => Promise<string>;
	/** Surfaced to the user; also the transport's channel for non-fatal problems. */
	onError?: (message: string) => void;
}

export interface VoiceTransport {
	provider: VoiceProvider;
	/** Bring the client up with an already-minted token. */
	register(token: string): Promise<void>;
	/** Tear everything down. Must be safe to call twice and after a failed register. */
	destroy(): void;
	onIncoming(cb: (leg: IncomingLeg) => void): void;
	/**
	 * ⚠️ Load-bearing on BOTH carriers despite the column's name. The heartbeat posts
	 * this as `twilio_device_status`, and `claimInboundCallByAgent` only claims an
	 * inbound call when it reads `'registered'`. A transport that connects but stops
	 * reporting leaves every agent on it rejected `agent_busy_or_unreachable` — a
	 * silent, total inbound outage that looks exactly like a bridge bug.
	 */
	onStatus(cb: (status: TransportStatus, error?: string) => void): void;

	/**
	 * Prime audio from a user gesture. The dialer auto-answers, so there is no per-call
	 * click to satisfy the browser's autoplay policy — this runs on the "Go ready"
	 * toggle instead. MUST be reachable synchronously from that click.
	 */
	armAudio(): Promise<void>;
	setInputDevice(deviceId: string): Promise<void>;
	setOutputDevice(deviceId: string): Promise<void>;

	/**
	 * Browser-side hold: replace the microphone with music and silence caller playback
	 * for the agent. The call never disconnects or changes legs on either carrier —
	 * Telnyx's native `call.hold()` is server-side and would give the caller Telnyx's
	 * treatment instead of ours, so it is deliberately unused.
	 */
	startHold(): Promise<void>;
	stopHold(): Promise<void>;
}

/** Narrow Twilio's `Call.customParameters` without importing the SDK here. */
export type {TwilioCustomParameters};
