import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TelnyxMicrophone} from './TelnyxMicrophone';

class Track extends EventTarget {
	kind = 'audio'; readyState = 'live'; enabled = true;
	constructor(readonly deviceId: string) { super(); }
	stop = vi.fn(() => {this.readyState = 'ended';});
	getSettings() { return {deviceId: this.deviceId}; }
}
class Stream {
	track: Track;
	constructor(deviceId: string) {this.track = new Track(deviceId);}
	getTracks() {return [this.track];}
	getAudioTracks() {return [this.track];}
	clone() {return new Stream(this.track.deviceId);}
}
const media = (s: Stream) => s as unknown as MediaStream;
const getUserMedia = vi.fn();
beforeEach(() => {
	getUserMedia.mockReset().mockImplementation(async ({audio}) => media(new Stream(audio.deviceId?.exact ?? 'windows-default')));
	vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
});
afterEach(() => vi.unstubAllGlobals());

describe('retained Telnyx microphone', () => {
	it('opens the exact selected device once and survives call clone teardown and mute', async () => {
		const mic = new TelnyxMicrophone('maono', vi.fn());
		await mic.ensure();
		const first = mic.clone();
		first.getAudioTracks()[0].enabled = false;
		first.getTracks().forEach(track => track.stop());
		await mic.ensure();
		const second = mic.clone();
		expect(second.getAudioTracks()[0].getSettings().deviceId).toBe('maono');
		expect(second.getAudioTracks()[0].readyState).toBe('live');
		expect(second.getAudioTracks()[0].enabled).toBe(true);
		expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({audio: {deviceId: {exact: 'maono'}}});
		mic.destroy();
	});
	it('preserves the previous selection when capture or live replacement fails', async () => {
		const mic = new TelnyxMicrophone('maono', vi.fn());
		await mic.ensure();
		getUserMedia.mockRejectedValueOnce(new Error('device busy'));
		await expect(mic.select('other')).rejects.toThrow('device busy');
		const next = new Stream('other');
		getUserMedia.mockResolvedValueOnce(media(next));
		await expect(mic.select('other', async () => {throw new Error('replace failed');})).rejects.toThrow('replace failed');
		expect(next.track.stop).toHaveBeenCalled();
		expect(mic.clone().getAudioTracks()[0].getSettings().deviceId).toBe('maono');
		mic.destroy();
	});
	it('rejects a browser returning a different device or no live audio', async () => {
		const mic = new TelnyxMicrophone('maono', vi.fn());
		const wrong = new Stream('windows-default');
		getUserMedia.mockResolvedValueOnce(media(wrong));
		await expect(mic.ensure()).rejects.toThrow('unavailable');
		expect(wrong.track.stop).toHaveBeenCalled();
		const ended = new Stream('maono'); ended.track.stop();
		getUserMedia.mockResolvedValueOnce(media(ended));
		await expect(mic.ensure()).rejects.toThrow('unavailable');
		expect(() => mic.clone()).toThrow('unavailable');
	});
	it('reports device removal and reacquires only the selected device when armed again', async () => {
		const ended = vi.fn(); const source = new Stream('maono');
		getUserMedia.mockResolvedValueOnce(media(source));
		const mic = new TelnyxMicrophone('maono', ended); await mic.ensure();
		source.track.readyState = 'ended'; source.track.dispatchEvent(new Event('ended'));
		expect(ended).toHaveBeenCalledOnce();
		expect(() => mic.clone()).toThrow('unavailable');
		await mic.ensure();
		expect(getUserMedia).toHaveBeenLastCalledWith({audio: {deviceId: {exact: 'maono'}}});
		mic.destroy();
	});
	it('serializes switches and releases captures that finish after destruction', async () => {
		let resolve!: (s: MediaStream) => void;
		getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>(r => {resolve = r;}));
		const mic = new TelnyxMicrophone('first', vi.fn());
		const first = mic.select('first'); const second = mic.select('second');
		await Promise.resolve();
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		const source = new Stream('first'); resolve(media(source));
		await first; await second;
		expect(source.track.stop).toHaveBeenCalled();
		expect(mic.clone().getAudioTracks()[0].getSettings().deviceId).toBe('second');
		getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>(r => {resolve = r;}));
		const late = mic.select('third'); await Promise.resolve(); mic.destroy();
		const third = new Stream('third'); resolve(media(third));
		await expect(late).rejects.toThrow('unavailable');
		expect(third.track.stop).toHaveBeenCalled();
	});
	it('allows the Windows communications alias to resolve to its actual input', async () => {
		getUserMedia.mockResolvedValueOnce(media(new Stream('maono')));
		const mic = new TelnyxMicrophone('communications', vi.fn());
		await mic.ensure();
		expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({audio: {deviceId: {exact: 'communications'}}});
		expect(mic.clone().getAudioTracks()[0].getSettings().deviceId).toBe('maono');
		mic.destroy();
	});

});
