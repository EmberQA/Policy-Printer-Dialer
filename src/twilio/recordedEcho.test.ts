import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	ECHO_RECORDING_DURATION_MS,
	RecordedEcho,
	type RecordedEchoPhase,
	type RecordedEchoProgress
} from './recordedEcho';

const stopTrack = vi.fn();
const mediaStream = {
	getTracks: () => [{stop: stopTrack}]
} as unknown as MediaStream;

class FakeMediaRecorder extends EventTarget {
	static instances: FakeMediaRecorder[] = [];
	state: RecordingState = 'inactive';
	mimeType = 'audio/webm';

	constructor(readonly stream: MediaStream) {
		super();
		FakeMediaRecorder.instances.push(this);
	}

	start() {
		this.state = 'recording';
	}

	stop() {
		if (this.state === 'inactive') return;
		this.state = 'inactive';
		this.dispatchEvent(
			new MessageEvent('dataavailable', {
				data: new Blob(['voice sample'], {type: this.mimeType})
			})
		);
		this.dispatchEvent(new Event('stop'));
	}
}

class FakeAudio extends EventTarget {
	static instances: FakeAudio[] = [];
	src = '';
	currentTime = 0;
	duration = 3;
	play = vi.fn(async () => undefined);
	pause = vi.fn();
	load = vi.fn();
	removeAttribute = vi.fn((name: string) => {
		if (name === 'src') this.src = '';
	});
	setSinkId = vi.fn(async () => undefined);

	constructor() {
		super();
		FakeAudio.instances.push(this);
	}
}

describe('RecordedEcho', () => {
	const getUserMedia = vi.fn(async () => mediaStream);
	const createObjectURL = vi.fn(() => 'blob:echo-recording');
	const revokeObjectURL = vi.fn();

	beforeEach(() => {
		vi.useFakeTimers();
		stopTrack.mockClear();
		getUserMedia.mockClear();
		createObjectURL.mockClear();
		revokeObjectURL.mockClear();
		FakeMediaRecorder.instances.length = 0;
		FakeAudio.instances.length = 0;
		vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
		vi.stubGlobal('Audio', FakeAudio);
		vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
		vi.stubGlobal('URL', {createObjectURL, revokeObjectURL});
		vi.stubGlobal('window', {
			setTimeout: globalThis.setTimeout,
			clearTimeout: globalThis.clearTimeout,
			setInterval: globalThis.setInterval,
			clearInterval: globalThis.clearInterval
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('records first, then plays the sample through the selected speaker', async () => {
		const phases: RecordedEchoPhase[] = [];
		const progress: RecordedEchoProgress[] = [];
		const echo = new RecordedEcho(
			'microphone-1',
			'speaker-1',
			(phase) => phases.push(phase),
			(update) => progress.push(update)
		);
		const result = echo.start();

		await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
		expect(getUserMedia).toHaveBeenCalledWith({
			audio: {deviceId: {exact: 'microphone-1'}}
		});
		expect(phases).toEqual(['recording']);
		expect(progress.at(-1)).toEqual({
			phase: 'recording',
			elapsedMs: 0,
			durationMs: ECHO_RECORDING_DURATION_MS
		});

		await vi.advanceTimersByTimeAsync(ECHO_RECORDING_DURATION_MS);
		await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));

		const audio = FakeAudio.instances[0];
		expect(stopTrack).toHaveBeenCalledTimes(1);
		expect(audio.setSinkId).toHaveBeenCalledWith('speaker-1');
		expect(audio.src).toBe('blob:echo-recording');
		expect(audio.play).toHaveBeenCalledTimes(1);
		expect(phases).toEqual(['recording', 'playing']);
		expect(progress.at(-1)).toEqual({
			phase: 'playing',
			elapsedMs: 0,
			durationMs: 3_000
		});

		audio.currentTime = 1.4;
		await vi.advanceTimersByTimeAsync(100);
		expect(progress.at(-1)).toEqual({
			phase: 'playing',
			elapsedMs: 1_400,
			durationMs: 3_000
		});
		audio.dispatchEvent(new Event('ended'));
		await result;

		expect(phases).toEqual(['recording', 'playing', 'complete']);
		expect(progress.at(-1)).toEqual({
			phase: 'playing',
			elapsedMs: 3_000,
			durationMs: 3_000
		});
		expect(audio.pause).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:echo-recording');
	});

	it('uses browser-default devices without calling setSinkId', async () => {
		const echo = new RecordedEcho('default', 'default', vi.fn());
		const result = echo.start();

		await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
		expect(getUserMedia).toHaveBeenCalledWith({audio: true});
		await vi.advanceTimersByTimeAsync(ECHO_RECORDING_DURATION_MS);
		await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));

		const audio = FakeAudio.instances[0];
		expect(audio.setSinkId).not.toHaveBeenCalled();
		audio.dispatchEvent(new Event('ended'));
		await result;
	});

	it('stops an in-progress recording and releases the microphone', async () => {
		const phases: RecordedEchoPhase[] = [];
		const echo = new RecordedEcho('default', 'default', (phase) =>
			phases.push(phase)
		);
		const result = echo.start();

		await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
		echo.stop();
		await result;

		expect(stopTrack).toHaveBeenCalledTimes(1);
		expect(FakeAudio.instances).toHaveLength(0);
		expect(phases).toEqual(['recording']);
	});

	it('stops playback without leaving the echo session pending', async () => {
		const phases: RecordedEchoPhase[] = [];
		const echo = new RecordedEcho('default', 'default', (phase) =>
			phases.push(phase)
		);
		const result = echo.start();

		await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
		await vi.advanceTimersByTimeAsync(ECHO_RECORDING_DURATION_MS);
		await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));

		const audio = FakeAudio.instances[0];
		echo.stop();
		await result;

		expect(audio.pause).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:echo-recording');
		expect(phases).toEqual(['recording', 'playing']);
	});
});
