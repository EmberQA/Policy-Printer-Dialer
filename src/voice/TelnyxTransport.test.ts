import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TelnyxTransport} from './TelnyxTransport';
import type {IncomingLeg} from './VoiceTransport';
import {createAudioPresence} from '../presence/audioPresence';

const sdk = vi.hoisted(() => ({clients: [] as any[], consultationHost: null as any, consultation: null as any}));
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
	constructor(host: unknown) {sdk.consultationHost = host; sdk.consultation = this;}
	onCall = vi.fn(() => false);
	destroy() {}
}}));
vi.mock('./holdMusic', () => ({HoldMusicProcessor: class {
	createProcessedStream = async () => new Stream('hold-music');
	dispose() {}
}}));
class Track extends EventTarget {
	kind = 'audio'; readyState = 'live'; enabled = true; muted = false;
	constructor(readonly deviceId: string) {super();}
	getSettings() {return {deviceId: this.deviceId};}
	stop = vi.fn(() => {this.readyState = 'ended';});
}
class Stream {
	private tracks: Track[];
	constructor(source: string | Track[] = []) {this.tracks = typeof source === 'string' ? [new Track(source)] : source;}
	get track() {return this.tracks[0];}
	getAudioTracks() {return this.tracks;}
	getTracks() {return this.tracks;}
	clone() {return new Stream(this.tracks.map(track => new Track(track.deviceId)));}
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
		style: {}, setAttribute() {}, getAttribute: () => null, remove() {}, sinkId: '',
		srcObject: null, currentSrc: '', currentTime: 0, paused: true, muted: false, volume: 1, readyState: 0,
		play: vi.fn(async function(this: {paused: boolean}) {this.paused = false;}),
		setSinkId: vi.fn(async function(this: {sinkId: string}, id: string) {this.sinkId = id;})
	})});
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
async function fixture(outputDeviceId = 'default') {
	const error = vi.fn(); const microphoneUnavailable = vi.fn(); const speakerAvailability = vi.fn(); const incoming: IncomingLeg[] = [];
	const transport = new TelnyxTransport({inputDeviceId: 'maono', outputDeviceId, onError: error, onMicrophoneUnavailable: microphoneUnavailable, onSpeakerAvailabilityChange: speakerAvailability, refreshToken: async () => 'token'});
	transport.onIncoming(leg => incoming.push(leg));
	await transport.register('token');
	const notify = (call: unknown) => sdk.clients.at(-1).handlers.get('telnyx.notification')({type: 'callUpdate', call});
	const call = (id = 'call', headers: Array<{name: string; value: string}> = [], remoteElement = sdk.clients.at(-1).remoteElement) => {
		const receivers: Array<{track: Track}> = [];
		const sender = {track: null as Track | null, replaceTrack: vi.fn(async (track: Track) => {sender.track = track;})};
		const c = {
			id, state: 'ringing', options: {customHeaders: headers, localStream: undefined as Stream | undefined, micId: '', remoteElement, remoteStream: null as Stream | null},
			get localStream() {return c.options.localStream;},
			get remoteStream() {return c.options.remoteStream;},
			get isAudioMuted() {return c.options.localStream?.track.enabled === false;},
			peer: {instance: {getSenders: () => [sender], getReceivers: () => receivers, connectionState: 'connected'}},
			answer: vi.fn(() => {
				if (!c.localStream) throw new Error('SDK would acquire its own microphone');
				sender.track = c.localStream.track; c.state = 'active'; notify(c);
			}),
			hangup: vi.fn(async () => {c.state = 'hangup'; notify(c); c.destroy();}),
			destroy: () => {
				c.state = 'destroy'; notify(c);
				// Match SDK 2.27.9: destroy is announced synchronously before conditional detach.
				const element = c.options.remoteElement;
				if (element && (!c.remoteStream || element.srcObject === c.remoteStream)) element.srcObject = null;
				c.localStream?.getTracks().forEach(track => track.stop());
				c.peer.instance.connectionState = 'closed';
			},
			muteAudio: vi.fn(() => {if (c.localStream) c.localStream.track.enabled = false;}),
			unmuteAudio: vi.fn(() => {if (c.localStream) c.localStream.track.enabled = true;}),
			deaf: vi.fn(() => c.remoteStream?.getAudioTracks().forEach(track => {track.enabled = false;})),
			undeaf: vi.fn(() => c.remoteStream?.getAudioTracks().forEach(track => {track.enabled = true;})), setAudioOutDevice: vi.fn(async () => true), sender, receivers
		};
		notify(c); return c;
	};
	return {transport, incoming, call, notify, error, microphoneUnavailable, speakerAvailability};
}

describe('Telnyx speaker loss during live calls', () => {
	it.each(['default', 'internal'])('does not pause a live call recovered onto %s', async actualSink => {
		let outputs = ['airpods', 'internal', 'default'];
		const devices = Object.assign(new EventTarget(), {
			getUserMedia: capture,
			enumerateDevices: vi.fn(async () => outputs.map(deviceId => ({kind: 'audiooutput', deviceId, label: deviceId})))
		});
		vi.stubGlobal('navigator', {mediaDevices: devices});
		const f = await fixture('airpods');
		const c = f.call(); f.incoming[0].accept();
		f.speakerAvailability.mockClear();
		// Saved preference still says AirPods, but the OS/SDK has a working route.
		sdk.clients[0].remoteElement.sinkId = actualSink;
		outputs = ['internal', 'default'];
		devices.dispatchEvent(new Event('devicechange'));
		await vi.advanceTimersByTimeAsync(2000);
		expect(f.speakerAvailability).not.toHaveBeenCalled();
		expect(c.hangup).not.toHaveBeenCalled();
		expect(c.sender.replaceTrack).not.toHaveBeenCalled();
		expect(sdk.clients[0].disconnect).not.toHaveBeenCalled();
		f.transport.destroy();
	});
	it('reports confirmed output loss and restoration without ending or replacing the call', async () => {
		let outputs = ['airpods', 'internal'];
		const devices = Object.assign(new EventTarget(), {
			getUserMedia: capture,
			enumerateDevices: vi.fn(async () => outputs.map(deviceId => ({kind: 'audiooutput', deviceId, label: deviceId})))
		});
		vi.stubGlobal('navigator', {mediaDevices: devices});
		const f = await fixture('airpods');
		const c = f.call(); f.incoming[0].accept();
		const stream = c.localStream;
		f.speakerAvailability.mockClear();
		const writePresence = vi.fn(async () => ({statusCode: 'SP100', statusMessage: 'OK'}));
		const presence = createAudioPresence(writePresence);
		f.speakerAvailability.mockImplementation(available => {
			if (!available) void presence.change('paused');
		});
		const element = sdk.clients[0].remoteElement;
		element.setSinkId.mockClear(); element.play.mockClear();
		outputs = ['internal']; devices.dispatchEvent(new Event('devicechange'));
		await vi.advanceTimersByTimeAsync(2000);
		expect(f.speakerAvailability).toHaveBeenCalledExactlyOnceWith(false);
		expect(writePresence).toHaveBeenCalledExactlyOnceWith('paused');
		expect(c.hangup).not.toHaveBeenCalled();
		expect(c.localStream).toBe(stream);
		expect(c.sender.replaceTrack).not.toHaveBeenCalled();
		outputs = ['airpods', 'internal']; devices.dispatchEvent(new Event('devicechange'));
		await vi.advanceTimersByTimeAsync(2000);
		expect(f.speakerAvailability).toHaveBeenLastCalledWith(true);
		expect(element.setSinkId).not.toHaveBeenCalled();
		expect(element.play).not.toHaveBeenCalled();
		expect(c.setAudioOutDevice).not.toHaveBeenCalled();
		expect(sdk.clients[0].disconnect).not.toHaveBeenCalled();
		expect(stream?.track.readyState).toBe('live');
		expect(writePresence).toHaveBeenCalledTimes(1); // Reconnection does not auto-Ready.
		expect(c.hangup).not.toHaveBeenCalled();
		f.transport.destroy();
	});
	it('surfaces routing failures and does not confirm a failed output selection', async () => {
		const f = await fixture();
		const c = f.call(); f.incoming[0].accept();
		f.speakerAvailability.mockClear();
		sdk.clients[0].remoteElement.setSinkId.mockRejectedValueOnce(new Error('speaker missing'));
		await expect(f.transport.setOutputDevice('airpods')).rejects.toThrow('speaker missing');
		expect(sdk.clients[0].speaker).toBe('default');
		c.setAudioOutDevice.mockResolvedValueOnce(false);
		await expect(f.transport.setOutputDevice('airpods')).rejects.toThrow('Could not switch the call speaker');
		expect(f.speakerAvailability).not.toHaveBeenCalled();
		expect(sdk.clients[0].speaker).toBe('default');
		expect(c.hangup).not.toHaveBeenCalled();
		await f.transport.setOutputDevice('internal');
		expect(sdk.clients[0].speaker).toBe('internal');
		expect(f.speakerAvailability).toHaveBeenLastCalledWith(true);
		f.transport.destroy();
	});
});

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
	expect(leg.endDiagnostics?.()).toMatchObject({provider: 'telnyx', sip_code: 480, hangup_cause: 'NO_ANSWER', hangup_cause_code: 19});
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

describe('passive call audio diagnostics', () => {
	it('reuses the existing stats read and keeps playback observations after call teardown', async () => {
		const f = await fixture('airpods'); const c = f.call(); const leg = f.incoming[0]; leg.accept();
		const report = new Map([['audio', {type: 'inbound-rtp', kind: 'audio', packetsReceived: 120,
			bytesReceived: 8000, totalAudioEnergy: 0.7, audioLevel: 0.2}]]);
		const getStats = vi.fn(async () => report);
		Object.assign(c.peer.instance, {getStats, connectionState: 'connected', iceConnectionState: 'connected'});
		const element = sdk.clients[0].remoteElement;
		Object.assign(element, {paused: false, muted: false, volume: 1, readyState: 4, currentTime: 1, srcObject: new Stream('remote')});
		element.play.mockClear(); element.setSinkId.mockClear();
		const rtt = vi.fn(); leg.onRtt(rtt);
		await vi.advanceTimersByTimeAsync(6000);
		expect(getStats).toHaveBeenCalledTimes(6);
		const audio = leg.endDiagnostics?.().audio;
		expect(audio?.samples).toHaveLength(2);
		expect(audio?.first).toMatchObject({inbound: {packetsReceived: 120, bytesReceived: 8000, totalAudioEnergy: 0.7},
			audio_level: 0.2, playback: {sink_id: 'airpods', paused: false, muted: false, has_stream: true}});
		expect(element.play).not.toHaveBeenCalled(); expect(element.setSinkId).not.toHaveBeenCalled();
		expect(c.hangup).not.toHaveBeenCalled(); expect(c.sender.replaceTrack).not.toHaveBeenCalled();
		await c.hangup(); element.srcObject = null;
		await vi.advanceTimersByTimeAsync(6000);
		expect(getStats).toHaveBeenCalledTimes(6);
		expect(leg.endDiagnostics?.().audio?.samples).toEqual(audio?.samples);
		f.transport.destroy();
	});
	it('never overlaps stats reads, ignores late results, and tolerates failures without touching the call', async () => {
		const f = await fixture(); const c = f.call(); const leg = f.incoming[0]; leg.accept();
		let resolve!: (value: Map<string, unknown>) => void;
		const getStats = vi.fn().mockRejectedValueOnce(new Error('stats unavailable'))
			.mockImplementation(() => new Promise(done => {resolve = done;}));
		Object.assign(c.peer.instance, {getStats});
		const rtt = vi.fn(); leg.onRtt(rtt);
		await vi.advanceTimersByTimeAsync(6000);
		expect(getStats).toHaveBeenCalledTimes(2);
		expect(leg.endDiagnostics?.().audio?.stats_errors).toBe(1);
		expect(c.hangup).not.toHaveBeenCalled(); expect(c.sender.track?.readyState).toBe('live');
		await c.hangup(); const diagnostics = leg.endDiagnostics?.().audio;
		resolve(new Map()); await vi.advanceTimersByTimeAsync(0);
		expect(rtt).toHaveBeenCalledTimes(1);
		expect(leg.endDiagnostics?.().audio?.samples).toEqual(diagnostics?.samples);
		f.transport.destroy();
	});
});

// These integration cases drive the public notification and RTT paths. They model
// the SDK's detach timing so a guard in the wrong lifecycle phase cannot pass.
describe('Telnyx remote playback lifecycle', () => {
	type TestCall = ReturnType<Awaited<ReturnType<typeof fixture>>['call']>;
	function attach(call: TestCall, label = 'caller') {
		const stream = new Stream(label);
		call.receivers.push({track: stream.track});
		call.options.remoteStream = stream;
		Object.assign(call.options.remoteElement, {srcObject: stream, paused: false, currentTime: 3, readyState: 4});
		return stream;
	}
	function missingPlayback(call: TestCall, label = 'receiver') {
		const track = new Track(label);
		call.receivers.push({track});
		Object.assign(call.options.remoteElement, {srcObject: null, paused: true, currentTime: 0, readyState: 0});
		return track;
	}
	function expectLive(call: TestCall, f: Awaited<ReturnType<typeof fixture>>) {
		expect(call.hangup).not.toHaveBeenCalled();
		expect(call.sender.track?.readyState).toBe('live');
		expect(sdk.clients[0].disconnect).not.toHaveBeenCalled();
		expect(f.microphoneUnavailable).not.toHaveBeenCalled();
		expect(f.speakerAvailability).not.toHaveBeenCalled();
	}

	it('rejecting a streamless sibling cannot detach a working primary call', async () => {
		const f = await fixture(); const primary = f.call('primary'); f.incoming[0].accept();
		const stream = attach(primary); const element = primary.options.remoteElement;
		f.speakerAvailability.mockClear(); element.play.mockClear();
		const sibling = f.call('rejected'); f.incoming[1].reject();
		expect(sibling.hangup).toHaveBeenCalledOnce();
		expect(sibling.state).toBe('destroy');
		expect(element.srcObject).toBe(stream); expect(stream.track.readyState).toBe('live');
		expect(element.play).not.toHaveBeenCalled();
		expectLive(primary, f);
		f.transport.destroy();
	});

	it('protects audio attached after sibling hangup but before delayed SDK destroy', async () => {
		const f = await fixture(); const primary = f.call('primary'); f.incoming[0].accept();
		const sibling = f.call('rejected');
		sibling.hangup.mockImplementationOnce(async () => {sibling.state = 'hangup'; f.notify(sibling);});
		f.incoming[1].reject();
		const stream = attach(primary);
		sibling.destroy();
		expect(primary.options.remoteElement.srcObject).toBe(stream);
		expect(primary.hangup).not.toHaveBeenCalled();
		f.transport.destroy();
	});

	it.each(['echo', 'supervision'] as const)('protects a working %s stream when a stale tagged leg is refused', async mode => {
		const f = await fixture();
		const header = mode === 'echo' ? 'X-Echo-Test-Id' : 'X-Supervision-Session';
		if (mode === 'echo') await f.transport.expectEchoTest('current', vi.fn());
		else f.transport.expectSupervision({sessionId: 'current', role: 'monitor'});
		const live = f.call('live-auxiliary', [{name: header, value: 'current'}]);
		expect(live.answer).toHaveBeenCalledOnce();
		const stream = attach(live);
		const stale = f.call('stale-auxiliary', [{name: header, value: 'stale'}]);
		expect(stale.hangup).toHaveBeenCalledOnce();
		expect(live.options.remoteElement.srcObject).toBe(stream);
		expect(live.hangup).not.toHaveBeenCalled();
		expect(f.incoming).toHaveLength(0);
		f.transport.destroy();
	});

	it('lets consultation teardown clear its own element without affecting primary playback', async () => {
		const f = await fixture(); const primary = f.call('primary'); f.incoming[0].accept();
		const primaryStream = attach(primary);
		const separate = document.createElement('audio');
		sdk.consultation.onCall.mockImplementation((call: TestCall) => call.id === 'consultation');
		const added = f.call('consultation', [], separate);
		added.state = 'active'; f.notify(added);
		const addedStream = attach(added, 'added');
		await added.hangup();
		expect(separate.srcObject).toBeNull();
		expect(added.options.remoteElement).toBe(separate);
		expect(primary.options.remoteElement.srcObject).toBe(primaryStream);
		expect(addedStream).not.toBe(primaryStream);
		f.transport.destroy();
	});

	it('repairs a missing primary attachment even while the stats request is pending', async () => {
		const f = await fixture(); const primary = f.call('primary'); const leg = f.incoming[0]; leg.accept();
		const element = primary.options.remoteElement;
		const getStats = vi.fn(() => new Promise<Map<string, unknown>>(() => {}));
		Object.assign(primary.peer.instance, {getStats});
		leg.onRtt(vi.fn());
		await vi.advanceTimersByTimeAsync(1000); // No receiver yet; getStats stays pending.
		const receiver = missingPlayback(primary);
		f.speakerAvailability.mockClear(); element.play.mockClear();
		await vi.advanceTimersByTimeAsync(1000);
		expect(getStats).toHaveBeenCalledOnce();
		expect(element.srcObject).toBe(primary.remoteStream);
		expect(primary.remoteStream?.getAudioTracks()).toEqual([receiver]);
		expect(element.play).toHaveBeenCalledOnce();
		expect(primary.sender.replaceTrack).not.toHaveBeenCalled();
		expectLive(primary, f);
		f.transport.destroy();
	});

	it('does not touch working playback, the sender, or availability during repeated polls', async () => {
		const f = await fixture(); const primary = f.call('primary'); const leg = f.incoming[0]; leg.accept();
		const stream = attach(primary); const element = primary.options.remoteElement;
		f.speakerAvailability.mockClear(); element.play.mockClear();
		leg.onRtt(vi.fn()); await vi.advanceTimersByTimeAsync(5000);
		expect(element.srcObject).toBe(stream); expect(primary.remoteStream).toBe(stream);
		expect(element.play).not.toHaveBeenCalled();
		expect(primary.sender.replaceTrack).not.toHaveBeenCalled();
		expectLive(primary, f);
		f.transport.destroy();
	});

	it('skips recovery during Hold and resumes repair only after Hold has ended', async () => {
		const f = await fixture(); const primary = f.call('primary'); const leg = f.incoming[0]; leg.accept();
		const receiver = missingPlayback(primary); const element = primary.options.remoteElement;
		await f.transport.startHold(); const music = primary.sender.track;
		leg.onRtt(vi.fn()); await vi.advanceTimersByTimeAsync(2000);
		expect(element.srcObject).toBeNull(); expect(primary.remoteStream).toBeNull();
		expect(primary.sender.track).toBe(music);
		await f.transport.stopHold(); await vi.advanceTimersByTimeAsync(1000);
		expect(primary.remoteStream?.getAudioTracks()).toEqual([receiver]);
		expect(primary.sender.track).toBe(primary.localStream?.track);
		expect(primary.hangup).not.toHaveBeenCalled();
		f.transport.destroy();
	});

	it('SDK Hold and resume control the receiver after attachment repair', async () => {
		const f = await fixture(); const primary = f.call('primary'); const leg = f.incoming[0]; leg.accept();
		const receiver = missingPlayback(primary);
		leg.onRtt(vi.fn()); await vi.advanceTimersByTimeAsync(1000);
		expect(primary.remoteStream?.getAudioTracks()).toEqual([receiver]);
		const repaired = primary.remoteStream;
		await f.transport.startHold();
		expect(receiver.enabled).toBe(false);
		await vi.advanceTimersByTimeAsync(2000);
		expect(receiver.enabled).toBe(false); expect(primary.remoteStream).toBe(repaired);
		await f.transport.stopHold();
		expect(receiver.enabled).toBe(true);
		expect(primary.options.remoteElement.srcObject).toBe(repaired);
		f.transport.destroy();
	});

	it('waits for an in-flight microphone switch before repairing playback', async () => {
		const f = await fixture(); const primary = f.call('primary'); const leg = f.incoming[0]; leg.accept();
		missingPlayback(primary);
		let acquired!: (stream: Stream) => void;
		capture.mockImplementationOnce(() => new Promise<Stream>(resolve => {acquired = resolve;}));
		const switching = f.transport.setInputDevice('replacement');
		leg.onRtt(vi.fn()); await vi.advanceTimersByTimeAsync(2000);
		expect(primary.remoteStream).toBeNull();
		acquired(new Stream('replacement')); await switching;
		await vi.advanceTimersByTimeAsync(1000);
		expect(primary.remoteStream).not.toBeNull();
		expect(primary.sender.track?.deviceId).toBe('replacement');
		expect(primary.hangup).not.toHaveBeenCalled();
		f.transport.destroy();
	});

	it('does not recover while consultation owns the audio workflow', async () => {
		const f = await fixture(); const primary = f.call('primary'); const leg = f.incoming[0]; leg.accept();
		missingPlayback(primary); sdk.consultation.busy = true;
		leg.onRtt(vi.fn()); await vi.advanceTimersByTimeAsync(2000);
		expect(primary.options.remoteElement.srcObject).toBeNull();
		expect(primary.remoteStream).toBeNull();
		sdk.consultation.busy = false; await vi.advanceTimersByTimeAsync(1000);
		expect(primary.remoteStream).not.toBeNull();
		f.transport.destroy();
	});

	it('does not recover a ringing sibling or change an auxiliary call on normal stats polls', async () => {
		const f = await fixture(); const ringing = f.call('unanswered'); const leg = f.incoming[0];
		missingPlayback(ringing);
		leg.onRtt(vi.fn()); await vi.advanceTimersByTimeAsync(1000);
		expect(ringing.remoteStream).toBeNull();
		await ringing.hangup();
		f.transport.expectSupervision({sessionId: 'session', role: 'monitor'});
		const auxiliary = f.call('auxiliary', [{name: 'X-Supervision-Session', value: 'session'}]);
		missingPlayback(auxiliary);
		await vi.advanceTimersByTimeAsync(2000);
		expect(auxiliary.remoteStream).toBeNull();
		expect(auxiliary.hangup).not.toHaveBeenCalled();
		f.transport.destroy();
	});

	it('uses the replacement call peer and never attaches an obsolete receiver', async () => {
		const f = await fixture(); const original = f.call('same-id'); const leg = f.incoming[0]; leg.accept();
		const obsolete = missingPlayback(original, 'obsolete');
		const fresh = new Track('fresh');
		const recovered = {...original, state: 'active', options: {...original.options},
			peer: {instance: {getSenders: () => [original.sender], getReceivers: () => [{track: fresh}], connectionState: 'connected'}}};
		Object.defineProperty(recovered, 'remoteStream', {get: () => recovered.options.remoteStream});
		f.notify(recovered);
		leg.onRtt(vi.fn()); await vi.advanceTimersByTimeAsync(1000);
		expect(recovered.options.remoteStream?.getAudioTracks()).toEqual([fresh]);
		expect(recovered.options.remoteStream?.getAudioTracks()).not.toContain(obsolete);
		expect(original.remoteStream).toBeNull();
		f.transport.destroy();
	});

	it('never attaches an ended call after its stats callback was registered', async () => {
		const f = await fixture(); const primary = f.call('ended'); const leg = f.incoming[0]; leg.accept();
		missingPlayback(primary); leg.onRtt(vi.fn());
		await primary.hangup(); await vi.advanceTimersByTimeAsync(2000);
		expect(primary.options.remoteElement.srcObject).toBeNull();
		expect(primary.remoteStream).toBeNull();
		f.transport.destroy();
	});

	it('leaves the call running when playback rejects and does not report a device outage', async () => {
		const f = await fixture(); const primary = f.call('primary'); const leg = f.incoming[0]; leg.accept();
		missingPlayback(primary); const element = primary.options.remoteElement;
		element.play.mockRejectedValueOnce(new Error('Autoplay rejected'));
		f.speakerAvailability.mockClear(); f.error.mockClear();
		leg.onRtt(vi.fn()); await vi.advanceTimersByTimeAsync(1000);
		expect(primary.remoteStream).not.toBeNull();
		expect(element.srcObject).toBe(primary.remoteStream);
		expect(f.error).not.toHaveBeenCalled();
		expectLive(primary, f);
		f.transport.destroy();
	});
});
