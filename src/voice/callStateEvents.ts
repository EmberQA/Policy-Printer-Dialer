/**
 * Telnyx call-state → Twilio-shaped call events (ENG-159 — Subplan 05).
 *
 * ⚠️ THE REASON THIS FILE EXISTS. Telnyx has no per-call event emitter. There is no
 * `call.on('accept')`; every state change arrives on the CLIENT-level
 * `telnyx.notification` stream as `{type: 'callUpdate', call}`, and the SDK sets
 * `call.state` to the lowercased `State` enum name before dispatching
 * (`BaseCall.setState`). So the transport has to reconstruct per-leg events itself,
 * keyed by `call.id`.
 *
 * Getting the terminal event right is what preserves `callerHangupMessage`
 * (callTermination.ts) — the only consumer that distinguishes the two, and the reason
 * an agent sees "The caller ended the call before it connected." instead of nothing.
 *
 * `reject` is never synthesized. On Twilio it means "send a busy"; on Telnyx we reject
 * an unowned leg by hanging up, and `callerHangupMessage` already returns null for
 * `reject`, so collapsing it into the cancel/disconnect split loses no user-facing
 * behaviour.
 */

import type {LegEvent} from './VoiceTransport';

/**
 * `call.state` as the SDK reports it — `State[value].toLowerCase()`, verified against
 * the enum in `@telnyx/webrtc` 2.27.9.
 */
export type TelnyxCallState =
	| 'new'
	| 'requesting'
	| 'trying'
	| 'recovering'
	| 'ringing'
	| 'answering'
	| 'early'
	| 'active'
	| 'held'
	| 'hangup'
	| 'destroy'
	| 'purge';

/** States from which a call will never carry media again. */
const TERMINAL_STATES: ReadonlySet<string> = new Set([
	'hangup',
	'destroy',
	'purge'
]);

/** What one `callUpdate` should do to a leg we are already tracking. */
export type LegStateTransition =
	| {kind: 'ignore'}
	| {kind: 'event'; event: Extract<LegEvent, 'accept' | 'disconnect' | 'cancel'>};

/**
 * Decide what a state change means for a leg, given whether it ever connected.
 *
 * `everActive` is the caller's running memory, not something the SDK exposes: a call
 * that reaches `hangup` may report no trace of having been `active`, and that single
 * bit is the entire difference between "the caller hung up on you" and "the caller
 * gave up before you picked up".
 */
export const legStateTransition = (
	state: string,
	everActive: boolean
): LegStateTransition => {
	if (state === 'active') {
		// `held` → `active` re-enters the active state on a server-side hold. We never
		// use Telnyx's native hold (browser-side hold keeps parity across carriers), but
		// treating a re-entry as a second answer would restart the call timer and re-post
		// on_call, so accept fires exactly once per leg.
		return everActive ? {kind: 'ignore'} : {kind: 'event', event: 'accept'};
	}
	if (TERMINAL_STATES.has(state)) {
		return {kind: 'event', event: everActive ? 'disconnect' : 'cancel'};
	}
	return {kind: 'ignore'};
};

/** True once a leg has reached a state it can never come back from. */
export const isTerminalState = (state: string): boolean =>
	TERMINAL_STATES.has(state);

/**
 * True when a `callUpdate` is announcing a leg we have not seen before.
 *
 * `ringing` is the inbound INVITE — and every leg the dialer handles is inbound from
 * the browser's point of view, including outbound calls, which the backend bridges
 * back to us as an incoming leg. The `X-` headers are on the INVITE, so they are
 * readable here, before answering.
 */
export const isNewIncomingState = (state: string): boolean => state === 'ringing';
