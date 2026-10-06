import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TelnyxTransport} from './TelnyxTransport';
import type {IncomingLeg} from './VoiceTransport';
import {createAudioPresence} from '../presence/audioPresence';

const sdk = vi.hoisted(() => ({clients: [] as any[], consultationHost: null as any}));
vi.mock('@telnyx/webrtc', () => ({TelnyxRTC: class {
	handlers = new Map<string, (event?: unknown) => void>();
	micId = ''; speaker = ''; remoteElement = null;
	connect = vi.fn(async () => {this.handlers.get('telnyx.ready')?.();});
	disconnect = vi.fn(async () => {});
	enableMicrophone = vi.fn();
	setAudioSettings = vi.fn(() => {throw new Error('SDK microphone probing must not run');});
	newCall = vi.fn((options: unknown) => ({options}));
	constructor() {sdk.clients.push(this);}
	on(event: string, handler: (event?: unknown) => void) {this.handlers.set(event, handler);}
}}));
vi.mock('./TelnyxConsultation', () => ({TelnyxConsultation: class {
	busy = false;
	constructor(host: unknown) {sdk.consultationHost = host;}
	onCall() {return false;}
	destroy() {}
}}));
vi.mock('./holdMusic', () => ({HoldMusicProcessor: class {
	createProcessedStream = async () => new Stream('hold-music');
	dispose() {}
}}));
class Track extends EventTarget {
	kind = 'audio'; readyState = 'live'; enabled = true;
	constructor(readonly deviceId: string) {super();}
	getSettings() {return {deviceId: this.deviceId};}
	stop = vi.fn(() => {this.readyState = 'ended';});
}
class Stream {
	track: Track;
	constructor(deviceId: string) {this.track = new Track(deviceId);}
	getAudioTracks() {return [this.track];}
	getTracks() {return [this.track];}
	clone() {return new Stream(this.track.deviceId);}
}
const capture = vi.fn();
let sources: Stream[];
beforeEach(() => {
	vi.useFakeTimers(); sdk.clients.length = 0; sources = [];
	capture.mockReset().mockImplementation(async ({audio}) => {
		const source = new Stream(audio.deviceId?.exact ?? 'windows-default'); sources.push(source); return source;
	});
	vi.stubGlobal('MediaStream', Stream);
	vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: capture}});
	vi.stubGlobal('window', {setInterval, clearInterval, setTimeout, clearTimeout});
	vi.stubGlobal('document', {body: {appendChild() {}}, createElement: () => ({
		style: {}, setAttribute() {}, play: vi.fn(async () => {}), remove() {}, setSinkId: vi.fn(async () => {})
	})});
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
async function fixture() {
	const error = vi.fn(); const microphoneUnavailable = vi.fn(); const incoming: IncomingLeg[] = [];
	const transport = new TelnyxTransport({inputDeviceId: 'maono', onError: error, onMicrophoneUnavailable: microphoneUnavailable, refreshToken: async () => 'token'});
	transport.onIncoming(leg => incoming.push(leg));
	await transport.register('token');
	const notify = (call: unknown) => sdk.clients.at(-1).handlers.get('telnyx.notification')({type: 'callUpdate', call});
	const call = (id = 'call', headers: Array<{name: string; value: string}> = []) => {
		const sender = {track: null as Track | null, replaceTrack: vi.fn(async (track: Track) => {sender.track = track;})};
		const c = {
			id, state: 'ringing', options: {customHeaders: headers, localStream: undefined as Stream | undefined, micId: ''},
			get localStream() {return c.options.localStream;},
			get isAudioMuted() {return c.options.localStream?.track.enabled === false;},
			peer: {instance: {getSenders: () => [sender]}},
			answer: vi.fn(() => {
				if (!c.localStream) throw new Error('SDK would acquire its own microphone');
				sender.track = c.localStream.track; c.state = 'active'; notify(c);
			}),
			hangup: vi.fn(async () => {c.state = 'hangup'; notify(c); c.localStream?.getTracks().forEach(track => track.stop());}),
			muteAudio: vi.fn(() => {if (c.localStream) c.localStream.track.enabled = false;}),
			unmuteAudio: vi.fn(() => {if (c.localStream) c.localStream.track.enabled = true;}),
			deaf: vi.fn(), undeaf: vi.fn(), sender
		};
		notify(c); return c;
	};
	return {transport, incoming, call, notify, error, microphoneUnavailable};
}

describe('Telnyx retained input integration', () => {
	it('answers consecutive calls with independent clones without reopening the Windows default', async () => {
		const f = await fixture(); const first = f.call('first'); f.incoming[0].accept();
		expect(first.localStream?.track.deviceId).toBe('maono');
		first.muteAudio(); await first.hangup();
		const second = f.call('second'); f.incoming[1].accept();
		expect(second.localStream?.track).not.toBe(first.localStream?.track);
		expect(second.localStream?.track.enabled).toBe(true);
		expect(second.localStream?.track.readyState).toBe('live');
		expect(sources[0].track.readyState).toBe('live');
		expect(capture).toHaveBeenCalledExactlyOnceWith({audio: {deviceId: {exact: 'maono'}}});
		f.transport.destroy(); expect(sources[0].track.readyState).toBe('ended');
	});
	it('switches the live sender and future calls, preserving mute and cleaning the old call stream', async () => {
		const f = await fixture(); const c = f.call(); f.incoming[0].accept(); c.muteAudio();
		const previous = c.localStream!;
		await f.transport.setInputDevice('usb-2');
		expect(c.sender.track?.deviceId).toBe('usb-2'); expect(c.sender.track?.enabled).toBe(false);
		expect(c.localStream?.track).toBe(c.sender.track);
		expect(previous.track.readyState).toBe('ended'); expect(sources[0].track.readyState).toBe('ended');
		await c.hangup(); const next = f.call('next'); f.incoming[1].accept();
		expect(next.localStream?.track.deviceId).toBe('usb-2'); expect(next.localStream?.track.enabled).toBe(true);
		f.transport.destroy();
	});
	it('leaves live and future calls on the old input if replaceTrack fails', async () => {
		const f = await fixture(); const c = f.call(); f.incoming[0].accept(); const previous = c.localStream!;
		c.sender.replaceTrack.mockRejectedValueOnce(new Error('replace failed'));
		await expect(f.transport.setInputDevice('bad')).rejects.toThrow('replace failed');
		expect(c.localStream).toBe(previous); expect(previous.track.readyState).toBe('live');
		expect(sources[1].track.readyState).toBe('ended');
		await c.hangup(); const next = f.call('next'); f.incoming[1].accept();
		expect(next.localStream?.track.deviceId).toBe('maono'); f.transport.destroy();
	});
	it('changes the held microphone without replacing music, then resumes and cleans up the new clone', async () => {
		const f = await fixture(); const c = f.call(); f.incoming[0].accept();
		await f.transport.startHold(); const music = c.sender.track;
		await f.transport.setInputDevice('usb-2');
		expect(c.sender.track).toBe(music); expect(c.localStream?.track.deviceId).toBe('usb-2');
		await f.transport.stopHold(); expect(c.sender.track).toBe(c.localStream?.track);
		await c.hangup(); expect(c.localStream?.track.readyState).toBe('ended');
		expect(sources[1].track.readyState).toBe('live'); f.transport.destroy();
	});
	it('rejects an answer after device removal without letting the SDK fall back', async () => {
		const f = await fixture(); sources[0].track.readyState = 'ended'; sources[0].track.dispatchEvent(new Event('ended'));
		expect(f.microphoneUnavailable).toHaveBeenCalledWith('disconnected');
		const c = f.call();
		const ended = vi.fn(); f.incoming[0].on('error', ended); f.incoming[0].on('cancel', ended);
		f.incoming[0].accept();
		expect(ended).toHaveBeenCalledTimes(1);
		expect(ended.mock.calls[0][0]).toBeInstanceOf(Error);
		expect(ended.mock.calls[0][0].message).toContain('selected microphone is unavailable');
		expect(c.answer).not.toHaveBeenCalled(); expect(c.hangup).toHaveBeenCalled(); expect(f.error).toHaveBeenCalled();
		await f.transport.armAudio();
		expect(capture).toHaveBeenLastCalledWith({audio: {deviceId: {exact: 'maono'}}}); f.transport.destroy();
	});
	it('supplies independent selected-input clones to added and supervision legs', async () => {
		const f = await fixture();
		const added = sdk.consultationHost.dial('to', 'from', {}, 'added');
		expect(added.options.localStream.track.deviceId).toBe('maono');
		added.options.localStream.track.stop();
		f.transport.expectSupervision({sessionId: 'session', role: 'monitor'});
		const supervised = f.call('supervisor', [{name: 'X-Supervision-Session', value: 'session'}]);
		expect(supervised.answer).toHaveBeenCalledOnce();
		expect(supervised.localStream?.track.deviceId).toBe('maono'); expect(supervised.localStream?.track.enabled).toBe(false);
		expect(sources[0].track.enabled).toBe(true); expect(sources[0].track.readyState).toBe('live');
		await f.transport.endSupervision();
		const normal = f.call('normal'); f.incoming[0].accept();
		expect(normal.localStream?.track.enabled).toBe(true); f.transport.destroy();
	});
	it('retains the source through token refresh', async () => {
		const f = await fixture(); await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
		expect(sdk.clients.length).toBeGreaterThan(1); expect(capture).toHaveBeenCalledTimes(1);
		const c = f.call(); f.incoming[0].accept(); expect(c.localStream?.track.deviceId).toBe('maono'); f.transport.destroy();
	});
	it('seeds SDK-driven recovery before answer and keeps mute controls on the replacement call', async () => {
		const f = await fixture(); const original = f.call(); f.incoming[0].accept();
		const old = original.localStream!; old.track.stop();
		const recovered = {...original, state: 'recovering', options: {...original.options, localStream: undefined as Stream | undefined}};
		recovered.muteAudio = vi.fn();
		f.notify(recovered);
		expect(recovered.options.localStream?.track.deviceId).toBe('maono');
		expect(recovered.options.localStream?.track.readyState).toBe('live');
		expect(capture).toHaveBeenCalledTimes(1);
		f.incoming[0].mute(true); expect(recovered.muteAudio).toHaveBeenCalled();
		f.transport.destroy();
	});
	it('disables SDK capture on recovery when the retained device has disappeared', async () => {
		const f = await fixture(); sources[0].track.stop();
		const recovered = {id: 'recovered', state: 'recovering', options: {} as {audio?: boolean; receiveOnlyAudio?: boolean; localStream?: Stream}};
		f.notify(recovered);
		expect(recovered.options.localStream).toBeUndefined();
		expect(recovered.options.audio).toBe(false); expect(recovered.options.receiveOnlyAudio).toBe(false);
		expect(f.error).toHaveBeenCalled(); f.transport.destroy();
	});
	it('does not replace a call stream on duplicate accept', async () => {
		const f = await fixture(); const c = f.call(); f.incoming[0].accept(); const stream = c.localStream;
		f.incoming[0].accept(); expect(c.answer).toHaveBeenCalledOnce(); expect(c.localStream).toBe(stream);
		f.transport.destroy();
	});
	it('cancels a switch cleanly if the call ends while replaceTrack is pending', async () => {
		const f = await fixture(); const c = f.call(); f.incoming[0].accept();
		let replace!: () => void; let replacement!: Track;
		c.sender.replaceTrack.mockImplementationOnce(track => new Promise<void>(resolve => {replacement = track; replace = resolve;}));
		const changing = f.transport.setInputDevice('other');
		for (let i = 0; i < 10; i++) await Promise.resolve();
		await expect(f.transport.startHold()).rejects.toThrow('microphone change');
		await c.hangup(); replace();
		await expect(changing).rejects.toThrow('call has ended');
		expect(replacement.readyState).toBe('ended'); expect(sources[1].track.readyState).toBe('ended');
		const next = f.call('next'); f.incoming[1].accept(); expect(next.localStream?.track.deviceId).toBe('maono');
		f.transport.destroy();
	});

});

it('preserves available SIP disconnect details on the ended leg', async () => {
	const f = await fixture(); const c = f.call(); const leg = f.incoming[0];
	Object.assign(c, {state: 'hangup', sipCode: 480, cause: 'NO_ANSWER', causeCode: 19});
	f.notify(c);
	expect(leg.endDiagnostics?.()).toEqual({provider: 'telnyx', sip_code: 480, hangup_cause: 'NO_ANSWER', hangup_cause_code: 19});
	f.transport.destroy();
});

it('does not report deliberate stream cleanup as a microphone disconnect', async () => {
	const f = await fixture(); await f.transport.setInputDevice('usb-2'); f.transport.destroy();
	expect(f.microphoneUnavailable).not.toHaveBeenCalled();
});

it('signals microphone failure at registration while allowing Audio Setup recovery', async () => {
	capture.mockRejectedValueOnce(new Error('Permission denied'));
	const f = await fixture();
	expect(f.microphoneUnavailable).toHaveBeenCalledWith('unavailable');
	await f.transport.armAudio();
	const c = f.call(); f.incoming[0].accept(); expect(c.answer).toHaveBeenCalledOnce();
	f.transport.destroy();
});

it('allows Ready while remote playback waits for an incoming call', async () => {
	const f = await fixture();
	sdk.clients.at(-1).remoteElement.play.mockImplementation(() => new Promise<void>(() => {}));
	const write = vi.fn(async () => ({statusCode: 'SP100', statusMessage: 'OK'}));
	const presence = createAudioPresence(write);
	const ready = presence.change('ready', async () => {await f.transport.armAudio(); return true;});
	await expect(ready).resolves.toBeDefined();
	expect(write).toHaveBeenCalledWith('ready');
	expect(capture).toHaveBeenCalledTimes(1);
	f.transport.destroy();
});

it('still blocks Ready when the selected microphone cannot be acquired', async () => {
	const f = await fixture();
	sources[0].track.stop();
	capture.mockRejectedValueOnce(new Error('Microphone disconnected'));
	const write = vi.fn(async () => ({statusCode: 'SP100', statusMessage: 'OK'}));
	const presence = createAudioPresence(write);
	await expect(presence.change('ready', async () => {await f.transport.armAudio(); return true;})).rejects.toThrow('Microphone disconnected');
	expect(write).not.toHaveBeenCalled();
	f.transport.destroy();
});
