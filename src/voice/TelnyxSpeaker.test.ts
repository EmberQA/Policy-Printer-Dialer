import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TelnyxSpeaker} from './TelnyxSpeaker';

const output = (deviceId: string, groupId = deviceId, label = deviceId) =>
	({kind: 'audiooutput', deviceId, groupId, label} as MediaDeviceInfo);
let inventory: MediaDeviceInfo[];
let devices: EventTarget & {enumerateDevices: ReturnType<typeof vi.fn>};
let monitor: TelnyxSpeaker;
let changed: ReturnType<typeof vi.fn<(available: boolean) => void>>;
let restore: ReturnType<typeof vi.fn<(deviceId: string) => Promise<void>>>;
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
	changed = vi.fn<(available: boolean) => void>(); restore = vi.fn<(deviceId: string) => Promise<void>>(async () => {});
	monitor = new TelnyxSpeaker(restore, changed);
});
afterEach(() => {monitor.stop(); vi.useRealTimers(); vi.unstubAllGlobals();});

describe('Telnyx speaker availability', () => {
	it('confirms loss after two seconds, reports once, and restores only after routing succeeds', async () => {
		monitor.start('airpods'); await flush(); changed.mockClear();
		inventory = [output('internal'), output('default', 'internal')];
		devices.dispatchEvent(new Event('devicechange'));
		await vi.advanceTimersByTimeAsync(1999);
		expect(changed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(changed).toHaveBeenCalledExactlyOnceWith(false);
		await change();
		expect(changed).toHaveBeenCalledTimes(1);
		inventory.push(output('airpods'));
		restore.mockRejectedValueOnce(new Error('routing failed'));
		await change();
		expect(changed).toHaveBeenCalledTimes(1);
		await change();
		expect(restore).toHaveBeenLastCalledWith('airpods');
		expect(changed).toHaveBeenLastCalledWith(true);
	});
	it('ignores a transient disconnect and unrelated device removal', async () => {
		monitor.start('airpods'); await flush(); changed.mockClear();
		inventory = [output('internal')];
		devices.dispatchEvent(new Event('devicechange'));
		await vi.advanceTimersByTimeAsync(1000);
		inventory = [output('airpods')];
		await change();
		expect(changed).not.toHaveBeenCalled();
		expect(restore).not.toHaveBeenCalled();
	});
	it.each(['default', 'communications'])('detects removal of the physical %s speaker even when the alias remains', async alias => {
		inventory.push(output('communications', 'airpods'));
		monitor.start(alias); await flush(); changed.mockClear();
		inventory = [output('internal'), output(alias, 'internal')];
		await change();
		expect(changed).toHaveBeenCalledExactlyOnceWith(false);
		// An explicit selection accepts the new default and clears the warning.
		monitor.select(alias); await flush();
		expect(changed).toHaveBeenLastCalledWith(true);
	});
	it('follows an OS default change while the previous device is still present', async () => {
		monitor.start('default'); await flush(); changed.mockClear();
		inventory = [output('airpods'), output('internal'), output('default', 'internal')];
		await change();
		expect(changed).not.toHaveBeenCalled();
		inventory = [output('airpods'), output('default', 'airpods')];
		await change();
		expect(changed).toHaveBeenCalledExactlyOnceWith(false);
	});
	it('ignores empty, redacted and ambiguous inventories', async () => {
		monitor.start('airpods'); await flush(); changed.mockClear();
		for (const next of [[], [output('internal', 'internal', '')], [output('default')]]) {
			inventory = next; await change();
		}
		devices.enumerateDevices.mockRejectedValueOnce(new Error('unavailable'));
		await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it('does not guess the device behind an ambiguous default alias', async () => {
		inventory = [output('a', 'shared'), output('b', 'shared'), output('default', 'shared')];
		monitor.start('default'); await flush(); changed.mockClear();
		inventory = [output('internal')]; await change();
		expect(changed).not.toHaveBeenCalled();
	});
	it('rejects reselection of a missing explicit output even if setSinkId would be a no-op', async () => {
		inventory = [output('internal')];
		await expect(monitor.assertAvailable('airpods')).rejects.toThrow('unavailable');
	});
	it('discards a pending scan after a new output selection', async () => {
		monitor.start('airpods'); await flush(); changed.mockClear();
		let resolve!: (devices: MediaDeviceInfo[]) => void;
		devices.enumerateDevices.mockImplementationOnce(() => new Promise(done => {resolve = done;}));
		await change();
		monitor.select('internal'); await flush(); changed.mockClear();
		resolve([output('internal')]); await flush();
		expect(changed).not.toHaveBeenCalled();
	});
	it('does not clear a newer loss when an earlier restoration finishes', async () => {
		monitor.start('airpods'); await flush();
		inventory = [output('internal')]; await change();
		let resolve!: () => void;
		restore.mockImplementationOnce(() => new Promise<void>(done => {resolve = done;}));
		inventory.push(output('airpods')); await change();
		inventory = [output('internal')]; await change();
		changed.mockClear(); resolve(); await flush();
		expect(changed).not.toHaveBeenCalled();
	});
	it('cleans up pending scans and listeners when the transport is destroyed', async () => {
		monitor.start('airpods'); await flush(); changed.mockClear();
		inventory = [output('internal')];
		devices.dispatchEvent(new Event('devicechange'));
		monitor.stop(); await vi.advanceTimersByTimeAsync(2000);
		await change();
		expect(changed).not.toHaveBeenCalled();
		expect(restore).not.toHaveBeenCalled();
	});
});
