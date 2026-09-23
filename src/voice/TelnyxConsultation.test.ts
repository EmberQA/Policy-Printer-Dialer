import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TelnyxConsultation, type ConsultationCall} from './TelnyxConsultation';
import type {CallParticipantState} from './VoiceTransport';

const mocks = vi.hoisted(() => ({hold: vi.fn(), resume: vi.fn(), connect: vi.fn(), disconnect: vi.fn()}));
vi.mock('./telnyxHold', () => ({TelnyxHoldController: class {start = mocks.hold; stop = mocks.resume;}}));
vi.mock('./threeWayAudio', () => ({ThreeWayAudio: class {connect = mocks.connect; disconnect = mocks.disconnect;}}));
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
beforeEach(() => {
	vi.useFakeTimers(); vi.clearAllMocks();
	for (const mock of Object.values(mocks)) mock.mockResolvedValue(undefined);
	vi.stubGlobal('document', {body: {append() {}}, createElement: () => ({remove() {}})});
	vi.stubGlobal('window', {setTimeout, clearTimeout});
	vi.stubGlobal('AudioContext', class {state = 'running'; resume = vi.fn(async () => {}); close = vi.fn(async () => {this.state = 'closed';});});
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

function fixture() {
	const makeCall = (id: string, state: string) => ({
		id, state, hangup: vi.fn(async () => {}), muteAudio: vi.fn(), unmuteAudio: vi.fn(),
		peer: {instance: {getSenders: () => [{track: {kind: 'audio', enabled: true}}]}},
		remoteStream: {}, telnyxIDs: {telnyxLegId: 'leg', telnyxSessionId: 'session'}
	}) as unknown as ConsultationCall;
	const primary = makeCall('customer', 'active');
	const secondary = makeCall('added', 'trying');
	const dial = vi.fn((_to, _from, _audio, id) => {secondary.id = id; return secondary;});
	const changes: CallParticipantState[] = [];
	const controller = new TelnyxConsultation({primary: () => primary, canStart: () => true, outputDevice: () => 'default', dial, changed: state => changes.push(state)});
	const authorize = vi.fn(async () => ({to: '+15551234567', from: '+15557654321'}));
	const start = () => controller.start({to: '+15551234567', attemptId: 'added', authorize});
	return {controller, primary, secondary, dial, authorize, changes, start};
}

describe('consultation lifecycle', () => {
	it('holds before dialing, uses server caller ID, and keeps audio private until Merge', async () => {
		let held!: () => void;
		mocks.hold.mockImplementationOnce(() => new Promise<void>(resolve => {held = resolve;}));
		const f = fixture(); const pending = f.start(); await flush();
		expect(f.authorize).not.toHaveBeenCalled(); expect(f.dial).not.toHaveBeenCalled();
		held(); await pending;
		expect(f.dial).toHaveBeenCalledWith('+15551234567', '+15557654321', expect.anything(), 'added');
		f.secondary.state = 'active'; expect(f.controller.onCall(f.secondary)).toBe(true);
		expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled();
		expect(f.changes.at(-1)?.phase).toBe('private');
		await f.controller.merge();
		expect(mocks.connect).toHaveBeenCalledOnce(); expect(f.changes.at(-1)?.phase).toBe('merged');
		await f.controller.end();
		expect(f.secondary.hangup).toHaveBeenCalledOnce(); expect(f.primary.hangup).not.toHaveBeenCalled();
		expect(f.controller.busy).toBe(false);
	});
	it('cancel during authorization never dials and restores the held caller', async () => {
		let authorize!: (value: {to: string; from: string}) => void;
		const f = fixture(); f.authorize.mockImplementationOnce(() => new Promise(resolve => {authorize = resolve;}));
		const pending = f.start(); await flush(); const ending = f.controller.end();
		authorize({to: '+15551234567', from: '+15557654321'}); await pending; await ending;
		expect(f.dial).not.toHaveBeenCalled(); expect(mocks.resume).toHaveBeenCalledOnce();
		expect(f.changes.at(-1)?.phase).toBe('completed');
	});
	it('denied authorization never dials and restores the customer', async () => {
		const f = fixture(); f.authorize.mockRejectedValueOnce(new Error('Call not owned'));
		await expect(f.start()).rejects.toThrow('Call not owned');
		expect(f.dial).not.toHaveBeenCalled(); expect(mocks.resume).toHaveBeenCalledOnce();
		expect(f.controller.busy).toBe(false);
	});
	it('original hangup ends the added leg, without hanging up the original again', async () => {
		const f = fixture(); await f.start(); f.primary.state = 'hangup';
		f.controller.onCall(f.primary); await flush();
		expect(f.secondary.hangup).toHaveBeenCalledOnce(); expect(f.primary.hangup).not.toHaveBeenCalled();
		expect(f.controller.busy).toBe(false);
	});
	it('late auxiliary events cannot enter the normal incoming-call path', async () => {
		const f = fixture(); await f.start(); await f.controller.end();
		f.secondary.state = 'destroy'; expect(f.controller.onCall(f.secondary)).toBe(true);
	});
	it('blocks duplicate starts while an added call exists', async () => {
		const f = fixture(); await f.start(); await expect(f.start()).rejects.toThrow();
		expect(f.dial).toHaveBeenCalledOnce(); await f.controller.end();
	});
	it('a merge failure ends the added leg and returns to the original', async () => {
		const f = fixture(); await f.start(); f.secondary.state = 'active'; f.controller.onCall(f.secondary);
		mocks.connect.mockRejectedValueOnce(new Error('media failed'));
		await expect(f.controller.merge()).rejects.toThrow('media failed');
		expect(f.secondary.hangup).toHaveBeenCalledOnce(); expect(f.controller.busy).toBe(false);
	});
	it('hangup failure keeps the interaction busy and allows retry', async () => {
		const f = fixture(); await f.start(); vi.mocked(f.secondary.hangup).mockRejectedValueOnce(new Error('network'));
		await expect(f.controller.end()).rejects.toThrow('Could not finish');
		expect(f.controller.busy).toBe(true); expect(f.changes.at(-1)?.phase).toBe('ending');
		await f.controller.end(); expect(f.controller.busy).toBe(false);
	});
	it('no-answer timeout ends only the added call', async () => {
		const f = fixture(); await f.start(); await vi.advanceTimersByTimeAsync(45000);
		expect(f.secondary.hangup).toHaveBeenCalledOnce(); expect(f.primary.hangup).not.toHaveBeenCalled();
		expect(f.changes.at(-1)?.phase).toBe('completed');
	});
});
