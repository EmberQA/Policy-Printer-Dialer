/**
 * Supervision (monitor / whisper) on the SUPERVISOR's browser.
 *
 * The backend dials a Telnyx Call Control leg to this browser's SIP credential with
 * `supervise_call_control_id` naming another agent's live leg. From the SDK's point
 * of view that is just another inbound INVITE — and every customer call the dialer
 * handles is also an inbound INVITE — so this module sits in front of the normal
 * incoming-call routing (`TelnyxTransport.onNotification`) and claims exactly one leg.
 *
 * ⚠️ EXACT MATCHING ONLY. A leg is ours when its `X-Supervision-Session` header equals
 * the session id we generated BEFORE asking the backend to dial. When that header is
 * absent (Stage 2 of plans/dialer_supervision decides whether custom headers survive
 * to the SDK), the only other accepted proof is the carrier `call_control_id` the Dial
 * response returned, handed in through `bindSupervisorLeg`. Because the INVITE can beat
 * that response, a headerless INVITE with no bridge metadata is PARKED unanswered for a
 * few seconds and resolved by control id — never by caller id, never "any supervision
 * header". A supervision-tagged INVITE for a different session is hung up.
 *
 * A claimed leg never becomes `activeCall`: no answer tone, no inbound lifecycle
 * posts, no lead form. Audio plays through the transport's remote element like any
 * answered leg; monitor additionally mutes our microphone (Telnyx already drops a
 * monitor's audio — the mute is belt and braces and what the UI reflects).
 */

import {isTerminalState} from './callStateEvents';
import {normalizeTelnyxHeaders} from './legParameters';
import type {
	ExpectSupervision,
	SupervisionRole,
	SupervisionState
} from './VoiceTransport';

/** The slice of the SDK call this module touches. */
export interface SupervisionCall {
	id: string;
	state: string;
	cause?: string;
	sipCode?: string | number;
	options?: {
		customHeaders?: Array<{name?: string; value?: string}>;
		remoteCallerNumber?: string;
	};
	readonly telnyxIDs?: {
		telnyxCallControlId?: string;
		telnyxSessionId?: string;
		telnyxLegId?: string;
	};
	answer(): void;
	hangup(): Promise<void> | void;
	muteAudio(): void;
	unmuteAudio(): void;
}

/** No INVITE at all within this window means the dial failed carrier-side. */
export const EXPECT_TIMEOUT_MS = 30_000;
/** How long a headerless INVITE waits for the Dial response's control id. */
export const PARK_TIMEOUT_MS = 10_000;

type Session = {
	state: SupervisionState;
	call: SupervisionCall | null;
	boundControlId: string | null;
	parked: Map<string, {call: SupervisionCall; timer: number}>;
	expectTimer: number | null;
	done: boolean;
};

export class TelnyxSupervision {
	private session: Session | null = null;
	/** Every SDK call id we ever claimed, parked or refused. Late terminal events for
	 *  them are swallowed so they can never enter ordinary incoming-call routing. */
	private knownIds = new Set<string>();
	private destroyed = false;

	constructor(
		private readonly host: {
			changed(state: SupervisionState): void;
			log?(step: string, data: Record<string, unknown>): void;
		}
	) {}

	get busy(): boolean {
		return this.session !== null;
	}

	get state(): SupervisionState | null {
		return this.session?.state ?? null;
	}

	/** Arm BEFORE the backend dials. Throws rather than replacing a live session. */
	expect(request: ExpectSupervision): void {
		if (this.destroyed) throw new Error('Call connection closed.');
		if (this.session) throw new Error('Already supervising a call.');
		const s: Session = {
			state: {
				sessionId: request.sessionId,
				role: request.role,
				phase: 'expecting',
				headersSeen: false,
				...(request.targetName ? {targetName: request.targetName} : {})
			},
			call: null,
			boundControlId: null,
			parked: new Map(),
			expectTimer: null,
			done: false
		};
		this.session = s;
		s.expectTimer = window.setTimeout(() => {
			if (this.session === s && !s.call) {
				this.finish(s, 'failed', 'The supervision call did not arrive.');
			}
		}, EXPECT_TIMEOUT_MS);
		this.emit(s);
	}

	/** The Dial response's `call_control_id`: resolves any parked INVITE by exact id. */
	bindSupervisorLeg(callControlId: string): void {
		const s = this.session;
		if (!s || s.done) return;
		s.boundControlId = callControlId;
		if (s.call) return;
		for (const [id, entry] of s.parked) {
			if (entry.call.telnyxIDs?.telnyxCallControlId === callControlId) {
				this.unpark(s, id);
				this.claim(s, entry.call, false);
				break;
			}
		}
		if (s.call) this.refuseParked(s);
	}

	/** Abandon an expected session (e.g. the backend refused to dial). */
	cancel(): void {
		const s = this.session;
		if (!s || s.done) return;
		void this.end().catch(() => undefined);
	}

	setRole(role: SupervisionRole): void {
		const s = this.session;
		if (!s || s.done) return;
		s.state = {...s.state, role};
		if (s.call && s.state.phase === 'active') this.applyRole(s);
		this.emit(s);
	}

	async end(): Promise<void> {
		const s = this.session;
		if (!s || s.done) return;
        s.call?.muteAudio();
        s.state = {...s.state, phase: 'ending', message: 'Stopping supervision…'};
        this.emit(s);
        if (s.call && !isTerminalState(s.call.state)) {
            try { await s.call.hangup(); }
            catch (error) {
                s.state = {...s.state, message: 'Could not stop supervision. Microphone muted; retry Stop.'};
                this.emit(s);
                throw error;
            }
        }
		this.finish(s, 'ended', 'Supervision ended.');
	}

	/**
	 * Called for EVERY `callUpdate` before normal routing. Returns true when the event
	 * belongs to supervision and must not reach `incomingCb`.
	 */
	onCall(call: SupervisionCall): boolean {
		const s = this.session;
		const params = normalizeTelnyxHeaders(call.options?.customHeaders);
		const taggedSession = params.supervision_session;

		if (!s || s.done) {
			if (this.knownIds.has(call.id)) return true;
			if (!taggedSession) return false;
			// Nobody asked for this. Refuse it and keep it out of the call state machine.
			this.knownIds.add(call.id);
			if (!isTerminalState(call.state)) void call.hangup();
			this.host.log?.('refused_unexpected', {
				sdk_call_id: call.id,
				supervision_session: taggedSession
			});
			return true;
		}

		if (s.call && call.id === s.call.id) {
			this.track(s, call);
			return true;
		}
		if (s.parked.has(call.id)) {
			if (isTerminalState(call.state)) this.unpark(s, call.id);
			return true;
		}
		if (this.knownIds.has(call.id)) return true;
		// Only a fresh INVITE is a candidate; other states belong to legs we never saw.
		if (call.state !== 'ringing') return false;

		if (taggedSession) {
			this.knownIds.add(call.id);
			if (taggedSession !== s.state.sessionId || s.call) {
				void call.hangup();
				this.host.log?.('refused_mismatch', {
					sdk_call_id: call.id,
					expected: s.state.sessionId,
					received: taggedSession,
					already_claimed: !!s.call
				});
				return true;
			}
			this.claim(s, call, true);
			return true;
		}

		// Headerless INVITE. Ours only by the carrier id the Dial response returned.
		if (s.call) return false;
		const control = call.telnyxIDs?.telnyxCallControlId;
		if (s.boundControlId) {
			if (control && control === s.boundControlId) {
				this.knownIds.add(call.id);
				this.claim(s, call, false);
				return true;
			}
			return false;
		}
		// No Dial response yet. A leg the backend bridged (parent sid / direction) or
		// a Retreaver direct-SIP call (its UUID) is never ours; anything else may be
		// the supervisor leg arriving early, so hold it for the control id.
		if (params.parent_call_sid || params.call_direction || params.retreaver_uuid) {
			return false;
		}
		this.park(s, call);
		return true;
	}

	destroy(): void {
		this.destroyed = true;
		const s = this.session;
		if (s && !s.done) {
			if (s.call && !isTerminalState(s.call.state)) void s.call.hangup();
			this.finish(s, 'ended', 'Call connection closed.');
		}
	}

	/* ── internals ─────────────────────────────────────────────────────────── */

	private claim(s: Session, call: SupervisionCall, headersSeen: boolean): void {
		this.knownIds.add(call.id);
		if (s.expectTimer !== null) window.clearTimeout(s.expectTimer);
		s.expectTimer = null;
		s.call = call;
		s.state = {
			...s.state,
			phase: 'ringing',
			headersSeen,
			supervisorLeg: legIds(call)
		};
		this.host.log?.('claimed', {
			sdk_call_id: call.id,
			session_id: s.state.sessionId,
			headers_seen: headersSeen,
			...legIds(call)
		});
		this.emit(s);
		this.refuseParked(s);
		call.answer();
		// The SDK may already report `active` on the same object after answer().
		this.track(s, call);
	}

	private track(s: Session, call: SupervisionCall): void {
		s.call = call;
		if (isTerminalState(call.state)) {
			const reason = [call.cause, call.sipCode].filter(Boolean).join(' / ');
			this.finish(
				s,
				'ended',
				s.state.connectedAt
					? 'Supervision ended.'
					: `The supervision call could not connect${reason ? ` (${reason})` : ''}.`
			);
			return;
		}
		if (call.state === 'active' && s.state.phase !== 'active' && s.state.phase !== 'ending') {
			s.state = {
				...s.state,
				phase: 'active',
				connectedAt: Date.now(),
				supervisorLeg: legIds(call)
			};
			this.applyRole(s);
			this.host.log?.('active', {sdk_call_id: call.id, ...legIds(call)});
			this.emit(s);
		}
	}

	private applyRole(s: Session): void {
		if (!s.call) return;
		if (s.state.role === 'monitor') s.call.muteAudio();
		else s.call.unmuteAudio();
	}

	private park(s: Session, call: SupervisionCall): void {
		this.knownIds.add(call.id);
		const timer = window.setTimeout(() => {
			if (!s.parked.has(call.id)) return;
			this.unpark(s, call.id);
			if (!isTerminalState(call.state)) void call.hangup();
			this.host.log?.('parked_expired', {sdk_call_id: call.id, ...legIds(call)});
		}, PARK_TIMEOUT_MS);
		s.parked.set(call.id, {call, timer});
		this.host.log?.('parked', {sdk_call_id: call.id, ...legIds(call)});
	}

	private unpark(s: Session, id: string): void {
		const entry = s.parked.get(id);
		if (!entry) return;
		window.clearTimeout(entry.timer);
		s.parked.delete(id);
	}

	private refuseParked(s: Session): void {
		for (const [id, entry] of [...s.parked]) {
			this.unpark(s, id);
			if (!isTerminalState(entry.call.state)) void entry.call.hangup();
		}
	}

	private finish(
		s: Session,
		phase: 'ended' | 'failed',
		message: string
	): void {
		if (s.done) return;
		s.done = true;
		if (s.expectTimer !== null) window.clearTimeout(s.expectTimer);
		s.expectTimer = null;
		this.refuseParked(s);
		if (this.session === s) this.session = null;
		s.state = {...s.state, phase, message};
		this.host.log?.(phase, {session_id: s.state.sessionId, message});
		this.emit(s);
	}

	private emit(s: Session): void {
		this.host.changed(s.state);
	}
}

const legIds = (call: SupervisionCall) => ({
	callControlId: call.telnyxIDs?.telnyxCallControlId,
	legId: call.telnyxIDs?.telnyxLegId,
	sessionId: call.telnyxIDs?.telnyxSessionId
});
