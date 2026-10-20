import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TelnyxSpeaker} from './TelnyxSpeaker';

const output = (deviceId: string, groupId = deviceId, label = deviceId) =>
	({kind: 'audiooutput', deviceId, groupId, label} as MediaDeviceInfo);
let inventory: MediaDeviceInfo[];
let devices: EventTarget & {enumerateDevices: ReturnType<typeof vi.fn>};
let monitor: TelnyxSpeaker;
let changed: ReturnType<typeof vi.fn<(available: boolean) => void>>;
let sinkId: string | null;
const select = (id: string) => { sinkId = id; monitor.select(); };
const start = (id: string) => { sinkId = id; monitor.start(); };
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
const change = async () => {
	devices.dispatchEvent(new Event('devicechange'));
	await vi.advanceTimersByTimeAsync(2000);
};
beforeEach(() => {
	vi.useFakeTimers();
	inventory = [output('airpods'), output('internal'), output('default', 'airpods')];
	devices = Object.assign(new EventTarget(), {enumerateDevices: vi.fn(async () => inventory)});
	vi.stubGlobal('navigator', {mediaDevices: devices});
	changed = vi.fn<(available: boolean) => void>(); sinkId = 'airpods';
	monitor = new TelnyxSpeaker(() => sinkId, changed);
});
afterEach(() => {monitor.stop(); vi.useRealTimers(); vi.unstubAllGlobals();});

describe('Telnyx speaker availability', () => {
	it('confirms loss after two seconds, reports once, and observes the same sink returning', async () => {
		start('airpods'); await flush(); changed.mockClear();
		inventory = [output('internal'), output('default', 'internal')];
		devices.dispatchEvent(new Event('devicechange'));
		await vi.advanceTimersByTimeAsync(1999);
		expect(changed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(changed).toHaveBeenCalledExactlyOnceWith(false);
		await change();
		expect(changed).toHaveBeenCalledTimes(1);
		inventory.push(output('airpods'));
		await change();
		expect(changed).toHaveBeenLastCalledWith(true);
	});
	it('ignores a transient disconnect and unrelated device removal', async () => {
		start('airpods'); await flush(); changed.mockClear();
		inventory = [output('internal')];
		devices.dispatchEvent(new Event('devicechange'));
		await vi.advanceTimersByTimeAsync(1000);
		inventory = [output('airpods')];
		await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it.each(['', 'default', 'communications'])('does not pause when %s falls back to a working output', async alias => {
		inventory.push(output('communications', 'airpods'));
		start(alias); await flush(); changed.mockClear();
		inventory = [output('internal'), output(alias || 'default', 'internal')];
		await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it('follows an OS default change while the previous device is still present', async () => {
		start('default'); await flush(); changed.mockClear();
		inventory = [output('airpods'), output('internal'), output('default', 'internal')];
		await change();
		expect(changed).not.toHaveBeenCalled();
		inventory = [output('airpods'), output('default', 'airpods')];
		await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it('ignores empty, redacted and ambiguous inventories', async () => {
		start('airpods'); await flush(); changed.mockClear();
		for (const next of [[], [output('internal', 'internal', '')], [output('default')]]) {
			inventory = next; await change();
		}
		devices.enumerateDevices.mockRejectedValueOnce(new Error('unavailable'));
		await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it('does not guess the device behind an ambiguous default alias', async () => {
		inventory = [output('a', 'shared'), output('b', 'shared'), output('default', 'shared')];
		start('default'); await flush(); changed.mockClear();
		inventory = [output('internal')]; await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it('rejects reselection of a missing explicit output even if setSinkId would be a no-op', async () => {
		inventory = [output('internal')];
		await expect(monitor.assertAvailable('airpods')).rejects.toThrow('unavailable');
	});
	it('discards a pending scan after a new output selection', async () => {
		start('airpods'); await flush(); changed.mockClear();
		let resolve!: (devices: MediaDeviceInfo[]) => void;
		devices.enumerateDevices.mockImplementationOnce(() => new Promise(done => {resolve = done;}));
		await change();
		select('internal'); await flush(); changed.mockClear();
		resolve([output('internal')]); await flush();
		expect(changed).not.toHaveBeenCalled();
	});
	it('uses a recovered actual route instead of the original selection', async () => {
		start('airpods'); await flush(); changed.mockClear();
		inventory = [output('internal')];
		sinkId = 'internal'; // e.g. the SDK recovered before the debounced scan.
		await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it('ignores unavailable sink information', async () => {
		start('airpods'); await flush(); changed.mockClear();
		inventory = [output('internal')]; sinkId = null;
		await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it('reads the current route after an asynchronous inventory read', async () => {
		start('airpods'); await flush(); changed.mockClear();
		let resolve!: (devices: MediaDeviceInfo[]) => void;
		devices.enumerateDevices.mockImplementationOnce(() => new Promise(done => {resolve = done;}));
		await change(); sinkId = 'internal';
		resolve([output('internal')]); await flush();
		expect(changed).not.toHaveBeenCalled();
	});
	it('cleans up pending scans and listeners when the transport is destroyed', async () => {
		start('airpods'); await flush(); changed.mockClear();
		inventory = [output('internal')];
		devices.dispatchEvent(new Event('devicechange'));
		monitor.stop(); await vi.advanceTimersByTimeAsync(2000);
		await change();
		expect(changed).not.toHaveBeenCalled();
	});
});
