/**
 * The live audio test on Telnyx: a real call to this browser that prompts the agent,
 * records a few words, and plays them back.
 *
 * ⚠️ WHY A REAL CALL. The local echo test (`twilio/recordedEcho.ts`) records the mic and
 * plays it through a fresh `<audio>`, so it passes for agents whose LIVE call audio is
 * broken — most visibly Bluetooth headsets on Windows, where the call's open mic flips
 * the headset to its Hands-Free profile and the Stereo output goes quiet. This leg is
 * answered exactly like a customer call (a microphone clone, the transport's shared
 * remote element, no extra `play()`), so it fails where a customer call would.
 *
 * Matching mirrors `TelnyxSupervision`, because the problem is the same: claim exactly
 * one inbound INVITE that would otherwise reach ordinary call routing.
 *   - A leg whose `X-Echo-Test-Id` equals the id we generated BEFORE asking the backend
 *     to dial is ours. A test-tagged leg for any other id is hung up.
 *   - Headerless (the TeXML REST `CustomHeaders` path is not yet verified to reach the
 *     SDK): a leg carrying NO bridge metadata is matched by caller number — the agent's
 *     own DID, which the backend's response reports. The INVITE can beat that response,
 *     so such a leg is PARKED unanswered until it arrives.
 *
 * Caller number is a weaker proof than supervision's control id, and that is accepted
 * here deliberately: it only applies to legs with no bridge metadata, only while a test
 * the agent just started is pending, and the worst case is a test prompt played to an
 * unmarked call. The backend's TeXML REST response carries no browser-leg id to use.
 *
 * A claimed leg never becomes `activeCall`: no answer tone, no inbound lifecycle posts,
 * no lead form, no presence change.
 */

import {isTerminalState} from './callStateEvents';
import {normalizeTelnyxHeaders} from './legParameters';
import type {InboundAudioSample} from './rtcStats';
import type {EchoTestState} from './VoiceTransport';

/** The slice of the SDK call this module touches. */
export interface EchoTestCall {
	id: string;
	state: string;
	cause?: string;
	sipCode?: string | number;
	options?: {
		localStream?: MediaStream;
		customHeaders?: Array<{name?: string; value?: string}>;
		remoteCallerNumber?: string;
	};
	answer(): void;
	hangup(): Promise<void> | void;
}

/** No INVITE at all within this window means the dial failed carrier-side. */
export const ECHO_EXPECT_TIMEOUT_MS = 30_000;
/** How long a headerless INVITE waits for the backend to report the caller number. */
export const ECHO_PARK_TIMEOUT_MS = 10_000;
/** How often the incoming audio counters are read while the test call is up. */
export const ECHO_STATS_INTERVAL_MS = 1_000;

type Session = {
	state: EchoTestState;
	onChange: (state: EchoTestState) => void;
	call: EchoTestCall | null;
	callerNumber: string | null;
	parked: Map<string, {call: EchoTestCall; timer: number}>;
	expectTimer: number | null;
	statsTimer: number | null;
	done: boolean;
};

export class TelnyxEchoTest {
	private session: Session | null = null;
	/** Every SDK call id we claimed, parked or refused. Late events for them are
	 *  swallowed so they can never enter ordinary incoming-call routing. */
	private knownIds = new Set<string>();
	private destroyed = false;

	constructor(
		private readonly host: {
			prepareAudio(call: EchoTestCall): void;
			readInbound(call: EchoTestCall): Promise<InboundAudioSample | null>;
			/** A parked leg that turned out not to be ours goes back to normal routing. */
			release(call: EchoTestCall): void;
			log?(step: string, data: Record<string, unknown>): void;
		}
	) {}

	get busy(): boolean {
		return this.session !== null;
	}

	/** Arm BEFORE the backend dials. Throws rather than replacing a live test. */
	expect(testId: string, onChange: (state: EchoTestState) => void): void {
		if (this.destroyed) throw new Error('Call connection closed.');
		if (this.session) throw new Error('An audio test is already running.');
		const s: Session = {
			state: {testId, phase: 'calling', headersSeen: false, inbound: null},
			onChange,
			call: null,
			callerNumber: null,
			parked: new Map(),
			expectTimer: null,
			statsTimer: null,
			done: false
		};
		this.session = s;
		s.expectTimer = window.setTimeout(() => {
			if (this.session === s && !s.call) {
				this.finish(s, 'failed', 'The test call did not arrive. Check your connection and try again.');
			}
		}, ECHO_EXPECT_TIMEOUT_MS);
		this.emit(s);
	}

	/** The caller number the backend reported: resolves any parked INVITE. */
	bindCallerNumber(callerNumber: string): void {
		const s = this.session;
		if (!s || s.done) return;
		s.callerNumber = callerNumber;
		for (const [id, entry] of [...s.parked]) {
			this.unpark(s, id);
			if (!s.call && sameNumber(entry.call.options?.remoteCallerNumber, callerNumber)) {
				this.claim(s, entry.call, false);
			} else {
				this.releaseToRouting(entry.call);
			}
		}
	}

	/** Stop the test: hang up the test call (if any) and report nothing further. */
	cancel(): void {
		const s = this.session;
		if (!s || s.done) return;
		if (s.call && !isTerminalState(s.call.state)) void s.call.hangup();
		this.finish(s, 'ended', 'Audio test stopped.', false);
	}

	/** A real call needs the line: end the test and say why. */
	interrupt(message: string): void {
		const s = this.session;
		if (!s || s.done) return;
		if (s.call && !isTerminalState(s.call.state)) void s.call.hangup();
		this.finish(s, 'failed', message);
	}

	/**
	 * Called for EVERY `callUpdate` before normal routing. Returns true when the event
	 * belongs to the audio test and must not reach `incomingCb`.
	 */
	onCall(call: EchoTestCall): boolean {
		const s = this.session;
		const params = normalizeTelnyxHeaders(call.options?.customHeaders);
		const taggedTest = params.echo_test_id;

		if (!s || s.done) {
			if (this.knownIds.has(call.id)) return true;
			if (!taggedTest) return false;
			// A test leg nobody is waiting for (a stale or abandoned test). Refuse it.
			this.knownIds.add(call.id);
			if (!isTerminalState(call.state)) void call.hangup();
			this.host.log?.('refused_unexpected', {sdk_call_id: call.id});
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

		if (taggedTest) {
			this.knownIds.add(call.id);
			if (taggedTest !== s.state.testId || s.call) {
				void call.hangup();
				this.host.log?.('refused_mismatch', {sdk_call_id: call.id, already_claimed: !!s.call});
				return true;
			}
			this.claim(s, call, true);
			return true;
		}

		// Headerless. A leg the backend bridged, a supervision leg, or a Retreaver
		// direct-SIP call is never ours.
		if (s.call) return false;
		if (params.parent_call_sid || params.call_direction || params.retreaver_uuid || params.supervision_session) {
			return false;
		}
		if (s.callerNumber) {
			if (!sameNumber(call.options?.remoteCallerNumber, s.callerNumber)) return false;
			this.claim(s, call, false);
			return true;
		}
		this.park(s, call);
		return true;
	}

	destroy(): void {
		this.destroyed = true;
		this.interrupt('Call connection closed.');
	}

	/* ── internals ─────────────────────────────────────────────────────────── */

	private claim(s: Session, call: EchoTestCall, headersSeen: boolean): void {
		this.knownIds.add(call.id);
		if (s.expectTimer !== null) window.clearTimeout(s.expectTimer);
		s.expectTimer = null;
		s.call = call;
		s.state = {...s.state, phase: 'ringing', headersSeen};
		this.host.log?.('claimed', {sdk_call_id: call.id, headers_seen: headersSeen});
		this.emit(s);
		for (const [id, entry] of [...s.parked]) {
			this.unpark(s, id);
			this.releaseToRouting(entry.call);
		}
		try {
			this.host.prepareAudio(call);
			call.answer();
		} catch (error) {
			call.options?.localStream?.getTracks().forEach(track => track.stop());
			this.finish(s, 'failed', error instanceof Error ? error.message : 'Could not open your selected microphone.');
			void call.hangup();
			return;
		}
		// The SDK may already report `active` on the same object after answer().
		this.track(s, call);
	}

	private track(s: Session, call: EchoTestCall): void {
		s.call = call;
		if (isTerminalState(call.state)) {
			if (s.state.connectedAt) {
				this.finish(s, 'ended', 'Audio test complete.');
			} else {
				const reason = [call.cause, call.sipCode].filter(Boolean).join(' / ');
				this.finish(s, 'failed', `The test call could not connect${reason ? ` (${reason})` : ''}.`);
			}
			return;
		}
		if (call.state === 'active' && s.state.phase !== 'active') {
			s.state = {...s.state, phase: 'active', connectedAt: Date.now()};
			this.host.log?.('active', {sdk_call_id: call.id});
			this.emit(s);
			this.startStats(s, call);
		}
	}

	private startStats(s: Session, call: EchoTestCall): void {
		if (s.statsTimer !== null) return;
		s.statsTimer = window.setInterval(() => {
			void this.host.readInbound(call).then(sample => {
				if (s.done || !sample) return;
				s.state = {...s.state, inbound: sample};
			}).catch(() => undefined);
		}, ECHO_STATS_INTERVAL_MS);
	}

	private park(s: Session, call: EchoTestCall): void {
		this.knownIds.add(call.id);
		const timer = window.setTimeout(() => {
			if (!s.parked.has(call.id)) return;
			// The backend never reported a caller number. Not provably ours: hand it back
			// rather than hanging up something that may be a real call.
			this.unpark(s, call.id);
			this.releaseToRouting(call);
			this.host.log?.('parked_expired', {sdk_call_id: call.id});
		}, ECHO_PARK_TIMEOUT_MS);
		s.parked.set(call.id, {call, timer});
		this.host.log?.('parked', {sdk_call_id: call.id});
	}

	private unpark(s: Session, id: string): void {
		const entry = s.parked.get(id);
		if (!entry) return;
		window.clearTimeout(entry.timer);
		s.parked.delete(id);
	}

	private releaseToRouting(call: EchoTestCall): void {
		this.knownIds.delete(call.id);
		if (!isTerminalState(call.state)) this.host.release(call);
	}

	private finish(
		s: Session,
		phase: 'ended' | 'failed',
		message: string,
		notify = true
	): void {
		if (s.done) return;
		s.done = true;
		if (s.expectTimer !== null) window.clearTimeout(s.expectTimer);
		s.expectTimer = null;
		if (s.statsTimer !== null) window.clearInterval(s.statsTimer);
		s.statsTimer = null;
		for (const [id, entry] of [...s.parked]) {
			this.unpark(s, id);
			this.releaseToRouting(entry.call);
		}
		if (this.session === s) this.session = null;
		s.state = {...s.state, phase, message};
		this.host.log?.(phase, {test_id: s.state.testId, message, inbound: s.state.inbound});
		if (notify) this.emit(s);
	}

	private emit(s: Session): void {
		s.onChange(s.state);
	}
}

/** Compare on the last ten digits: the SDK and our database may disagree on `+1`. */
const sameNumber = (a: string | null | undefined, b: string | null | undefined): boolean => {
	const digits = (value: string | null | undefined) => String(value ?? '').replace(/\D/g, '').slice(-10);
	const left = digits(a);
	return left.length === 10 && left === digits(b);
};
