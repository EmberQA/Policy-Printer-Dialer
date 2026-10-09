import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	ECHO_EXPECT_TIMEOUT_MS,
	ECHO_PARK_TIMEOUT_MS,
	ECHO_STATS_INTERVAL_MS,
	TelnyxEchoTest,
	type EchoTestCall
} from './TelnyxEchoTest';
import type {EchoTestState} from './VoiceTransport';

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('window', {setTimeout, clearTimeout, setInterval, clearInterval});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const TEST_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_DID = '+15550002222';

function makeCall(
	id: string,
	state: string,
	extra: {headers?: Array<{name: string; value: string}>; from?: string} = {}
): EchoTestCall {
	return {
		id,
		state,
		options: {customHeaders: extra.headers, remoteCallerNumber: extra.from},
		answer: vi.fn(function (this: EchoTestCall) { this.state = 'active'; }),
		hangup: vi.fn(async function (this: EchoTestCall) { this.state = 'hangup'; })
	} as EchoTestCall;
}
const tagged = (id: string, testId = TEST_ID) =>
	makeCall(id, 'ringing', {headers: [{name: 'X-Echo-Test-Id', value: testId}]});
const realInbound = (id: string) =>
	makeCall(id, 'ringing', {
		headers: [{name: 'X-Parent-Call-Sid', value: 'v3:p'}, {name: 'X-Call-Direction', value: 'inbound'}],
		from: '+15551234567'
	});

function fixture(sample = {packetsReceived: 400, bytesReceived: 32_000, totalAudioEnergy: 0.4}) {
	const changes: EchoTestState[] = [];
	const release = vi.fn();
	const prepareAudio = vi.fn();
	const echo = new TelnyxEchoTest({
		prepareAudio,
		readInbound: vi.fn(async () => sample),
		release
	});
	echo.expect(TEST_ID, s => changes.push(s));
	return {echo, changes, release, prepareAudio, last: () => changes[changes.length - 1]};
}

describe('exact test-id matching', () => {
	it('claims and answers the INVITE carrying its test id, like a real call', () => {
		const f = fixture();
		const call = tagged('c1');
		expect(f.echo.onCall(call)).toBe(true);
		expect(f.prepareAudio).toHaveBeenCalledWith(call);
		expect(call.answer).toHaveBeenCalledTimes(1);
		expect(f.last().phase).toBe('active');
		expect(f.last().headersSeen).toBe(true);
	});

	it('hangs up a test leg for a different test id', () => {
		const f = fixture();
		const stale = tagged('c1', 'other-id');
		expect(f.echo.onCall(stale)).toBe(true);
		expect(stale.hangup).toHaveBeenCalled();
		expect(stale.answer).not.toHaveBeenCalled();
		expect(f.echo.busy).toBe(true);
	});

	it('refuses a test leg when no test is pending', () => {
		const echo = new TelnyxEchoTest({prepareAudio: vi.fn(), readInbound: vi.fn(), release: vi.fn()});
		const call = tagged('c1');
		expect(echo.onCall(call)).toBe(true);
		expect(call.hangup).toHaveBeenCalled();
	});

	it('never touches a real bridged call', () => {
		const f = fixture();
		const call = realInbound('c1');
		expect(f.echo.onCall(call)).toBe(false);
		expect(call.answer).not.toHaveBeenCalled();
		expect(call.hangup).not.toHaveBeenCalled();
	});
});

describe('headerless fallback by caller number', () => {
	it('parks an unmarked INVITE until the caller number arrives, then claims it', () => {
		const f = fixture();
		const call = makeCall('c1', 'ringing', {from: '15550002222'});
		expect(f.echo.onCall(call)).toBe(true);
		expect(call.answer).not.toHaveBeenCalled();

		f.echo.bindCallerNumber(AGENT_DID);
		expect(call.answer).toHaveBeenCalledTimes(1);
		expect(f.last().headersSeen).toBe(false);
	});

	it('releases a parked INVITE that turns out not to be ours', () => {
		const f = fixture();
		const call = makeCall('c1', 'ringing', {from: '+15559998888'});
		expect(f.echo.onCall(call)).toBe(true);
		f.echo.bindCallerNumber(AGENT_DID);
		expect(call.answer).not.toHaveBeenCalled();
		expect(call.hangup).not.toHaveBeenCalled();
		expect(f.release).toHaveBeenCalledWith(call);
	});

	it('hands a parked INVITE back to routing when the caller number never arrives', () => {
		const f = fixture();
		const call = makeCall('c1', 'ringing', {from: AGENT_DID});
		f.echo.onCall(call);
		vi.advanceTimersByTime(ECHO_PARK_TIMEOUT_MS);
		expect(call.hangup).not.toHaveBeenCalled();
		expect(f.release).toHaveBeenCalledWith(call);
	});

	it('matches directly once the caller number is known', () => {
		const f = fixture();
		f.echo.bindCallerNumber(AGENT_DID);
		const other = makeCall('c0', 'ringing', {from: '+15559998888'});
		expect(f.echo.onCall(other)).toBe(false);
		const call = makeCall('c1', 'ringing', {from: AGENT_DID});
		expect(f.echo.onCall(call)).toBe(true);
		expect(call.answer).toHaveBeenCalled();
	});
});

describe('lifecycle', () => {
	it('reports the incoming audio counters when the test call ends', async () => {
		const f = fixture();
		const call = tagged('c1');
		f.echo.onCall(call);
		await vi.advanceTimersByTimeAsync(ECHO_STATS_INTERVAL_MS * 2);
		call.state = 'hangup';
		expect(f.echo.onCall(call)).toBe(true);
		expect(f.last().phase).toBe('ended');
		expect(f.last().inbound).toEqual({packetsReceived: 400, bytesReceived: 32_000, totalAudioEnergy: 0.4});
		expect(f.echo.busy).toBe(false);
		// Late events for the finished leg stay out of ordinary routing.
		expect(f.echo.onCall(call)).toBe(true);
	});

	it('fails when the leg never connects', () => {
		const f = fixture();
		const call = makeCall('c1', 'ringing', {headers: [{name: 'X-Echo-Test-Id', value: TEST_ID}]});
		call.answer = vi.fn();
		f.echo.onCall(call);
		call.state = 'hangup';
		f.echo.onCall(call);
		expect(f.last().phase).toBe('failed');
	});

	it('fails when no INVITE arrives', () => {
		const f = fixture();
		vi.advanceTimersByTime(ECHO_EXPECT_TIMEOUT_MS);
		expect(f.last().phase).toBe('failed');
		expect(f.echo.busy).toBe(false);
	});

	it('a real call interrupts the test and hangs up the test leg', () => {
		const f = fixture();
		const call = tagged('c1');
		f.echo.onCall(call);
		f.echo.interrupt('A call came in.');
		expect(call.hangup).toHaveBeenCalled();
		expect(f.last()).toMatchObject({phase: 'failed', message: 'A call came in.'});
	});

	it('cancel hangs up silently', () => {
		const f = fixture();
		const call = tagged('c1');
		f.echo.onCall(call);
		const before = f.changes.length;
		f.echo.cancel();
		expect(call.hangup).toHaveBeenCalled();
		expect(f.changes.length).toBe(before);
		expect(f.echo.busy).toBe(false);
	});

	it('refuses a second test while one is pending', () => {
		const f = fixture();
		expect(() => f.echo.expect('another', () => undefined)).toThrow();
	});
});
