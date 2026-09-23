import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	EXPECT_TIMEOUT_MS,
	PARK_TIMEOUT_MS,
	TelnyxSupervision,
	type SupervisionCall
} from './TelnyxSupervision';
import type {SupervisionState} from './VoiceTransport';

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('window', {setTimeout, clearTimeout});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const SESSION = '11111111-1111-4111-8111-111111111111';

function makeCall(
	id: string,
	state: string,
	extra: {headers?: Array<{name: string; value: string}>; controlId?: string} = {}
): SupervisionCall {
	return {
		id,
		state,
		options: {customHeaders: extra.headers},
		telnyxIDs: extra.controlId
			? {telnyxCallControlId: extra.controlId, telnyxLegId: `${id}-leg`, telnyxSessionId: `${id}-session`}
			: undefined,
		answer: vi.fn(function (this: SupervisionCall) { this.state = 'active'; }),
		hangup: vi.fn(async function (this: SupervisionCall) { this.state = 'hangup'; }),
		muteAudio: vi.fn(),
		unmuteAudio: vi.fn()
	} as SupervisionCall;
}
const tagged = (id: string, session: string, role = 'monitor') =>
	makeCall(id, 'ringing', {headers: [{name: 'X-Supervision-Session', value: session}, {name: 'X-Supervision-Role', value: role}]});

function fixture(role: 'monitor' | 'whisper' = 'monitor') {
	const changes: SupervisionState[] = [];
	const log = vi.fn();
	const supervision = new TelnyxSupervision({changed: (s) => changes.push(s), log});
	supervision.expect({sessionId: SESSION, role});
	return {supervision, changes, log, last: () => changes[changes.length - 1]};
}

describe('exact session matching', () => {
	it('claims and answers only the INVITE carrying its session id, then mutes for monitor', () => {
		const f = fixture('monitor');
		const call = tagged('c1', SESSION);
		expect(f.supervision.onCall(call)).toBe(true);
		expect(call.answer).toHaveBeenCalledTimes(1);
		expect(call.hangup).not.toHaveBeenCalled();
		expect(f.last().phase).toBe('active');
		expect(f.last().headersSeen).toBe(true);
		expect(call.muteAudio).toHaveBeenCalled();
	});

	it('hangs up a supervision INVITE for a different session and never routes it', () => {
		const f = fixture();
		const wrong = tagged('c2', '22222222-2222-4222-8222-222222222222');
		expect(f.supervision.onCall(wrong)).toBe(true);
		expect(wrong.hangup).toHaveBeenCalled();
		expect(wrong.answer).not.toHaveBeenCalled();
		expect(f.last().phase).toBe('expecting');
		// Late terminal events for the refused leg are swallowed too.
		expect(f.supervision.onCall(makeCall('c2', 'hangup'))).toBe(true);
	});

	it('refuses an unexpected supervision INVITE when nothing is expected', () => {
		const supervision = new TelnyxSupervision({changed: () => undefined});
		const stray = tagged('c3', SESSION);
		expect(supervision.onCall(stray)).toBe(true);
		expect(stray.hangup).toHaveBeenCalled();
	});

	it('leaves ordinary customer legs to normal routing', () => {
		const f = fixture();
		const bridged = makeCall('c4', 'ringing', {headers: [{name: 'X-Parent-Call-Sid', value: 'CA1'}]});
		const retreaver = makeCall('c5', 'ringing', {headers: [{name: 'X-PH-RetreaverUUID', value: 'u'}]});
		expect(f.supervision.onCall(bridged)).toBe(false);
		expect(f.supervision.onCall(retreaver)).toBe(false);
		expect(f.supervision.onCall(makeCall('c6', 'hangup'))).toBe(false);
	});

	it('whisper leaves the microphone open and role switches apply live', () => {
		const f = fixture('whisper');
		const call = tagged('c7', SESSION, 'whisper');
		f.supervision.onCall(call);
		expect(call.unmuteAudio).toHaveBeenCalledTimes(1);
		expect(call.muteAudio).not.toHaveBeenCalled();
		f.supervision.setRole('monitor');
		expect(call.muteAudio).toHaveBeenCalledTimes(1);
		expect(f.last().role).toBe('monitor');
	});
});

describe('headerless fallback by carrier control id', () => {
	it('parks a headerless INVITE and claims it once the Dial response binds the same control id', () => {
		const f = fixture();
		const early = makeCall('c8', 'ringing', {controlId: 'v3:supervisor'});
		expect(f.supervision.onCall(early)).toBe(true);
		expect(early.answer).not.toHaveBeenCalled();
		f.supervision.bindSupervisorLeg('v3:supervisor');
		expect(early.answer).toHaveBeenCalledTimes(1);
		expect(f.last().phase).toBe('active');
		expect(f.last().headersSeen).toBe(false);
		expect(f.last().supervisorLeg?.callControlId).toBe('v3:supervisor');
	});

	it('hangs up a parked INVITE whose control id never matches', () => {
		const f = fixture();
		const other = makeCall('c9', 'ringing', {controlId: 'v3:someone-else'});
		f.supervision.onCall(other);
		f.supervision.bindSupervisorLeg('v3:supervisor');
		expect(other.answer).not.toHaveBeenCalled();
		vi.advanceTimersByTime(PARK_TIMEOUT_MS);
		expect(other.hangup).toHaveBeenCalled();
		expect(f.last().phase).toBe('expecting');
	});

	it('claims by control id when the INVITE arrives after the Dial response', () => {
		const f = fixture();
		f.supervision.bindSupervisorLeg('v3:supervisor');
		const stranger = makeCall('c10', 'ringing', {controlId: 'v3:other'});
		expect(f.supervision.onCall(stranger)).toBe(false);
		const ours = makeCall('c11', 'ringing', {controlId: 'v3:supervisor'});
		expect(f.supervision.onCall(ours)).toBe(true);
		expect(ours.answer).toHaveBeenCalled();
	});
});

describe('lifecycle', () => {
	it('fails when no INVITE arrives in time', () => {
		const f = fixture();
		vi.advanceTimersByTime(EXPECT_TIMEOUT_MS);
		expect(f.last().phase).toBe('failed');
		expect(f.supervision.busy).toBe(false);
	});

	it('ends when the carrier drops the claimed leg and swallows its late events', () => {
		const f = fixture();
		const call = tagged('c12', SESSION);
		f.supervision.onCall(call);
		call.state = 'hangup';
		expect(f.supervision.onCall(call)).toBe(true);
		expect(f.last().phase).toBe('ended');
		expect(f.supervision.busy).toBe(false);
		expect(f.supervision.onCall(makeCall('c12', 'destroy'))).toBe(true);
	});

	it('end() hangs up the claimed leg; cancel() abandons an expected session', async () => {
		const f = fixture();
		const call = tagged('c13', SESSION);
		f.supervision.onCall(call);
		await f.supervision.end();
		expect(call.hangup).toHaveBeenCalled();
		expect(f.last().phase).toBe('ended');

		const g = fixture();
		g.supervision.cancel();
		expect(g.last().phase).toBe('ended');
		expect(() => g.supervision.expect({sessionId: SESSION, role: 'monitor'})).not.toThrow();
	});

	it('refuses to arm twice', () => {
		const f = fixture();
		expect(() => f.supervision.expect({sessionId: SESSION, role: 'monitor'})).toThrow();
	});
});

it('keeps a muted retryable session when hangup fails', async () => {
 const f = fixture('whisper');
 const call = tagged('retry-stop', SESSION);
 f.supervision.onCall(call);
 vi.mocked(call.hangup).mockRejectedValueOnce(new Error('offline'));
 await expect(f.supervision.end()).rejects.toThrow('offline');
 expect(call.muteAudio).toHaveBeenCalled();
 expect(f.supervision.busy).toBe(true);
 expect(f.last().phase).toBe('ending');
 vi.mocked(call.unmuteAudio).mockClear();
 call.state = 'active';
 f.supervision.onCall(call);
 expect(call.unmuteAudio).not.toHaveBeenCalled();
 await f.supervision.end();
 expect(f.supervision.busy).toBe(false);
});
