import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ThreeWayAudio} from './threeWayAudio';

const track = (name: string) => ({name, kind: 'audio', readyState: 'live', stop: vi.fn()}) as unknown as MediaStreamTrack;
class Stream {
	constructor(private tracks: MediaStreamTrack[]) {}
	getAudioTracks() { return this.tracks; }
}
const stream = (audio: MediaStreamTrack) => new Stream([audio]) as unknown as MediaStream;
const sender = (audio: MediaStreamTrack) => {
	const result = {track: audio, replaceTrack: vi.fn(async (next: MediaStreamTrack) => { result.track = next; })};
	return result;
};

function fixture() {
	const sources: Array<{stream: MediaStream; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}> = [];
	const outputs: Array<{stream: MediaStream; disconnect: ReturnType<typeof vi.fn>}> = [];
	const context = {
		createMediaStreamSource: (stream: MediaStream) => {
			const source = {stream, connect: vi.fn(), disconnect: vi.fn()}; sources.push(source); return source;
		},
		createMediaStreamDestination: () => {
			const output = {stream: stream(track('mix')), disconnect: vi.fn()}; outputs.push(output); return output;
		}
	};
	const mic = track('agent');
	const secondMic = track('second-call-mic');
	const customer = track('customer');
	const callee = track('callee');
	const a = sender(mic), b = sender(secondMic);
	const mixer = new ThreeWayAudio(context as unknown as AudioContext);
	const connect = () => mixer.connect(a as unknown as RTCRtpSender, b as unknown as RTCRtpSender, stream(customer), stream(callee));
	return {sources, outputs, mic, secondMic, customer, callee, a, b, mixer, connect};
}

beforeEach(() => vi.stubGlobal('MediaStream', Stream));
afterEach(() => vi.unstubAllGlobals());

describe('three-way audio routing', () => {
	it('sends each remote party agent + opposite party, never their own voice', async () => {
		const f = fixture();
		await f.connect();
		const inputsTo = (output: unknown) => f.sources.filter(source => source.connect.mock.calls.some(([target]) => target === output)).flatMap(source => source.stream.getAudioTracks());
		expect(inputsTo(f.outputs[0])).toEqual([f.mic, f.callee]);
		expect(inputsTo(f.outputs[1])).toEqual([f.mic, f.customer]);
		expect(f.a.track).toBe(f.outputs[0].stream.getAudioTracks()[0]);
		expect(f.b.track).toBe(f.outputs[1].stream.getAudioTracks()[0]);
		await f.mixer.disconnect();
		expect(f.a.track).toBe(f.mic);
		expect(f.b.track).toBe(f.secondMic);
		for (const audio of [f.mic, f.secondMic, f.customer, f.callee]) expect(audio.stop).not.toHaveBeenCalled();
		for (const output of f.outputs) expect(output.stream.getAudioTracks()[0].stop).toHaveBeenCalledOnce();
	});

	it('restores the first sender if installing the second mix fails', async () => {
		const f = fixture();
		f.b.replaceTrack.mockRejectedValueOnce(new Error('replace failed'));
		await expect(f.connect()).rejects.toThrow('replace failed');
		expect(f.a.track).toBe(f.mic);
		expect(f.b.track).toBe(f.secondMic);
		expect(f.sources.every(source => source.disconnect.mock.calls.length === 1)).toBe(true);
	});

	it('restores the customer after the callee has already disconnected', async () => {
		const f = fixture();
		await f.connect();
		f.b.replaceTrack.mockClear();
		await f.mixer.disconnect(true, false);
		expect(f.a.track).toBe(f.mic);
		expect(f.b.replaceTrack).not.toHaveBeenCalled();
	});
});
