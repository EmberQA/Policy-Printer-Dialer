import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {protectTerminalAudio, TelnyxPlaybackRecovery} from './telnyxPlayback';
import type {TelnyxPlaybackCall} from './telnyxPlayback';

class Track {
	kind = 'audio';
	readyState = 'live';
	enabled = true;
	muted = false;
	stop = vi.fn();
}
class Stream {
	constructor(readonly tracks: Track[] = []) {}
	getAudioTracks() {return this.tracks.filter(track => track.kind === 'audio');}
	getTracks() {return [...this.tracks];}
}
const mediaStream = (stream: Stream) => stream as unknown as MediaStream;
function fixture() {
	const track = new Track();
	const receivers = [{track}];
	const peer = {
		connectionState: 'connected',
		getReceivers: vi.fn(() => receivers),
		close: vi.fn(), restartIce: vi.fn(),
		getSenders: vi.fn(), setRemoteDescription: vi.fn()
	};
	const element = {
		srcObject: null as MediaProvider | null, currentSrc: '',
		getAttribute: vi.fn((): string | null => null),
		play: vi.fn(async () => {}), pause: vi.fn(),
		setSinkId: vi.fn(), sinkId: 'selected-headset', muted: false, volume: 0.7
	};
	const audio = element as unknown as HTMLAudioElement;
	const connection = peer as unknown as RTCPeerConnection;
	const options: TelnyxPlaybackCall['options'] = {remoteElement: audio};
	const call = {
		state: 'active', options,
		get remoteStream() {return options.remoteStream ?? null;},
		peer: {instance: connection},
		hangup: vi.fn(), deaf: vi.fn(), undeaf: vi.fn()
	};
	return {track, receivers, peer, connection, element, audio, options, call,
		current: vi.fn(() => true), recovery: new TelnyxPlaybackRecovery()};
}
type Fixture = ReturnType<typeof fixture>;
const recover = (f: Fixture) => f.recovery.recover(f.call, f.connection, f.audio, f.current);
function expectCallUntouched(f: Fixture) {
	expect(f.call.state).toBe('active');
	expect(f.peer.connectionState).toBe('connected');
	expect(f.call.hangup).not.toHaveBeenCalled();
	expect(f.call.deaf).not.toHaveBeenCalled();
	expect(f.call.undeaf).not.toHaveBeenCalled();
	expect(f.peer.close).not.toHaveBeenCalled();
	expect(f.peer.restartIce).not.toHaveBeenCalled();
	expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();
	expect(f.peer.getSenders).not.toHaveBeenCalled();
	expect(f.track.stop).not.toHaveBeenCalled();
	expect(f.element.setSinkId).not.toHaveBeenCalled();
	expect(f.element.pause).not.toHaveBeenCalled();
	expect(f.element.sinkId).toBe('selected-headset');
	expect(f.element.muted).toBe(false);
	expect(f.element.volume).toBe(0.7);
}
beforeEach(() => {vi.stubGlobal('MediaStream', Stream);});
afterEach(() => {vi.unstubAllGlobals();});

describe('Telnyx missing playback recovery', () => {
	it('attaches a streamless live receiver and preserves SDK Hold/mixer bookkeeping', async () => {
		const f = fixture();
		expect(await recover(f)).toBe('attached');
		expect(f.call.remoteStream).toBe(f.element.srcObject);
		expect(f.call.remoteStream?.getAudioTracks()).toEqual([f.track]);
		expect(f.element.play).toHaveBeenCalledOnce();
		expectCallUntouched(f);
	});
	it('reattaches the original SDK stream after unrelated cleanup detached the element', async () => {
		const f = fixture(), stream = mediaStream(new Stream([f.track]));
		f.options.remoteStream = stream;
		expect(await recover(f)).toBe('attached');
		expect(f.element.srcObject).toBe(stream);
		expect(f.call.remoteStream).toBe(stream);
		expectCallUntouched(f);
	});
	it('leaves a working attachment untouched even when SDK bookkeeping is missing', async () => {
		const f = fixture(), stream = mediaStream(new Stream([f.track]));
		f.element.srcObject = stream;
		expect(await recover(f)).toBe('skipped');
		expect(f.element.srcObject).toBe(stream);
		expect(f.options.remoteStream).toBeUndefined();
		expect(f.element.play).not.toHaveBeenCalled();
		expectCallUntouched(f);
	});
	it.each(['currentSrc', 'src attribute'])('does not overwrite existing %s playback', async source => {
		const f = fixture();
		if (source === 'currentSrc') f.element.currentSrc = 'blob:existing';
		else f.element.getAttribute.mockReturnValue('existing-audio.mp3');
		expect(await recover(f)).toBe('skipped');
		expect(f.element.srcObject).toBeNull();
		expect(f.element.play).not.toHaveBeenCalled();
	});
	it.each(['held', 'ringing', 'recovering', 'hangup', 'destroy'])('does not repair a %s call', async state => {
		const f = fixture(); f.call.state = state;
		expect(await recover(f)).toBe('skipped');
		expect(f.call.state).toBe(state);
		expect(f.element.srcObject).toBeNull();
		expect(f.element.play).not.toHaveBeenCalled();
	});
	it('does not act on a replaced call, peer or output element', async () => {
		const f = fixture();
		f.current.mockReturnValue(false);
		expect(await recover(f)).toBe('skipped');
		f.current.mockReturnValue(true);
		f.call.peer.instance = {} as RTCPeerConnection;
		expect(await recover(f)).toBe('skipped');
		f.call.peer.instance = f.connection;
		f.options.remoteElement = {} as HTMLAudioElement;
		expect(await recover(f)).toBe('skipped');
		expect(f.element.srcObject).toBeNull();
		expect(f.element.play).not.toHaveBeenCalled();
	});
	it.each(['new', 'connecting', 'disconnected', 'failed', 'closed'])('does not repair a %s connection', async state => {
		const f = fixture(); f.peer.connectionState = state;
		expect(await recover(f)).toBe('skipped');
		expect(f.element.srcObject).toBeNull();
		expect(f.element.play).not.toHaveBeenCalled();
	});
	it.each(['disabled', 'ended', 'video', 'absent'])('does not attach an %s audio receiver', async condition => {
		const f = fixture();
		if (condition === 'disabled') f.track.enabled = false;
		if (condition === 'ended') f.track.readyState = 'ended';
		if (condition === 'video') f.track.kind = 'video';
		if (condition === 'absent') f.receivers.length = 0;
		expect(await recover(f)).toBe('skipped');
		expect(f.element.srcObject).toBeNull();
		expect(f.element.play).not.toHaveBeenCalled();
		if (condition === 'disabled') expect(f.track.enabled).toBe(false);
		expectCallUntouched(f);
	});
	it('can attach a live muted receiver without changing its mute or enabled state', async () => {
		const f = fixture(); f.track.muted = true;
		expect(await recover(f)).toBe('attached');
		expect(f.track.muted).toBe(true);
		expect(f.track.enabled).toBe(true);
		expectCallUntouched(f);
	});
	it('does not reuse stale SDK tracks from a replaced peer', async () => {
		const f = fixture(), stale = new Track();
		f.options.remoteStream = mediaStream(new Stream([stale]));
		expect(await recover(f)).toBe('attached');
		expect(f.call.remoteStream?.getAudioTracks()).toEqual([f.track]);
		expect(stale.stop).not.toHaveBeenCalled();
		expectCallUntouched(f);
	});
	it('rechecks ownership after receiver inspection and before changing playback', async () => {
		const f = fixture();
		f.peer.getReceivers.mockImplementation(() => {f.current.mockReturnValue(false); return f.receivers;});
		expect(await recover(f)).toBe('skipped');
		expect(f.element.srcObject).toBeNull();
		expect(f.options.remoteStream).toBeUndefined();
		expect(f.element.play).not.toHaveBeenCalled();
	});
	it('limits actual attachment attempts to two without consuming attempts for missing tracks', async () => {
		const f = fixture(); f.track.enabled = false;
		for (let i = 0; i < 5; i++) expect(await recover(f)).toBe('skipped');
		f.track.enabled = true;
		expect(await recover(f)).toBe('attached');
		f.element.srcObject = null;
		expect(await recover(f)).toBe('attached');
		f.element.srcObject = null;
		for (let i = 0; i < 5; i++) expect(await recover(f)).toBe('skipped');
		expect(f.element.play).toHaveBeenCalledTimes(2);
		expect(f.element.srcObject).toBeNull();
		expectCallUntouched(f);
	});
	it('contains playback rejection without stopping the call or repeatedly replaying', async () => {
		const f = fixture(); f.element.play.mockRejectedValue(new Error('Autoplay blocked'));
		expect(await recover(f)).toBe('play-rejected');
		expect(f.element.srcObject).toBe(f.call.remoteStream);
		expect(await recover(f)).toBe('skipped');
		expect(f.element.play).toHaveBeenCalledOnce();
		expectCallUntouched(f);
	});
	it('cannot overwrite a replacement stream when an earlier play promise resolves', async () => {
		const f = fixture();
		let finish!: () => void;
		f.element.play.mockImplementation(() => new Promise<void>(resolve => {finish = resolve;}));
		const pending = recover(f);
		const replacement = mediaStream(new Stream([new Track()]));
		f.current.mockReturnValue(false); f.element.srcObject = replacement;
		finish(); await pending;
		expect(f.element.srcObject).toBe(replacement);
		expectCallUntouched(f);
	});
	it('contains receiver inspection failures', async () => {
		const f = fixture(); f.peer.getReceivers.mockImplementation(() => {throw new Error('disposed peer');});
		await expect(recover(f)).resolves.toBe('failed');
		expect(f.element.srcObject).toBeNull();
		expectCallUntouched(f);
	});
});

describe('Telnyx terminal cleanup ownership', () => {
	function cleanupFixture() {
		const f = fixture(), stream = mediaStream(new Stream([f.track]));
		f.options.remoteStream = stream; f.element.srcObject = stream;
		const ending: TelnyxPlaybackCall = {
			state: 'destroy', options: {remoteElement: f.audio}, remoteStream: null
		};
		return {...f, stream, ending};
	}
	it('prevents an unanswered sibling from clearing another live call stream', () => {
		const f = cleanupFixture();
		expect(protectTerminalAudio(f.ending, f.audio, [f.call])).toBe(true);
		expect(f.ending.options.remoteElement).toBeNull();
		expect(f.element.srcObject).toBe(f.stream);
		expect(f.options.remoteElement).toBe(f.audio);
		expect(f.call.remoteStream).toBe(f.stream);
		expectCallUntouched(f);
	});
	it('protects an intentionally disabled live track without resuming Hold', () => {
		const f = cleanupFixture(); f.call.state = 'held'; f.track.enabled = false;
		expect(protectTerminalAudio(f.ending, f.audio, [f.call])).toBe(true);
		expect(f.track.enabled).toBe(false);
		expect(f.element.srcObject).toBe(f.stream);
		expect(f.element.play).not.toHaveBeenCalled();
		expect(f.call.undeaf).not.toHaveBeenCalled();
	});
	it('waits until destroy and still catches attachment during pending hangup', () => {
		const f = cleanupFixture(); f.ending.state = 'hangup'; f.element.srcObject = null;
		expect(protectTerminalAudio(f.ending, f.audio, [f.call])).toBe(false);
		f.element.srcObject = f.stream; f.ending.state = 'destroy';
		expect(protectTerminalAudio(f.ending, f.audio, [f.call])).toBe(true);
		expect(f.element.srcObject).toBe(f.stream);
	});
	it('preserves ordinary cleanup when the ending call has its own stream', () => {
		const f = cleanupFixture();
		Object.defineProperty(f.ending, 'remoteStream', {value: mediaStream(new Stream([new Track()]))});
		expect(protectTerminalAudio(f.ending, f.audio, [f.call])).toBe(false);
		expect(f.ending.options.remoteElement).toBe(f.audio);
	});
	it.each(['hangup', 'destroy', 'recovering'])('does not claim a %s call as a live owner', state => {
		const f = cleanupFixture(); f.call.state = state;
		expect(protectTerminalAudio(f.ending, f.audio, [f.call])).toBe(false);
		expect(f.ending.options.remoteElement).toBe(f.audio);
	});
	it.each(['different element', 'different stream', 'closed peer', 'stale receiver', 'ended track', 'no tracks'])('requires matching live ownership: %s', condition => {
		const f = cleanupFixture();
		if (condition === 'different element') f.options.remoteElement = {} as HTMLAudioElement;
		if (condition === 'different stream') f.element.srcObject = mediaStream(new Stream([new Track()]));
		if (condition === 'closed peer') f.peer.connectionState = 'closed';
		if (condition === 'stale receiver') f.receivers[0] = {track: new Track()};
		if (condition === 'ended track') f.track.readyState = 'ended';
		if (condition === 'no tracks') {const empty = mediaStream(new Stream()); f.options.remoteStream = empty; f.element.srcObject = empty;}
		expect(protectTerminalAudio(f.ending, f.audio, [f.call])).toBe(false);
		expect(f.ending.options.remoteElement).toBe(f.audio);
	});
	it('does not infer ownership from the ending call itself or an absent element', () => {
		const f = cleanupFixture();
		expect(protectTerminalAudio(f.ending, f.audio, [f.ending])).toBe(false);
		expect(protectTerminalAudio(f.ending, null, [f.call])).toBe(false);
		f.ending.options.remoteElement = {} as HTMLAudioElement;
		expect(protectTerminalAudio(f.ending, f.audio, [f.call])).toBe(false);
	});
	it('contains introspection failures during terminal notifications', () => {
		const f = cleanupFixture(); f.peer.getReceivers.mockImplementation(() => {throw new Error('disposed peer');});
		expect(() => protectTerminalAudio(f.ending, f.audio, [f.call])).not.toThrow();
		expect(f.ending.options.remoteElement).toBe(f.audio);
		expect(f.element.srcObject).toBe(f.stream);
	});
});
