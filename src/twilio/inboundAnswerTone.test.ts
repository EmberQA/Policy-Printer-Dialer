import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	ANSWER_TONE_DURATION_MS,
	DISCONNECT_TONE_DURATION_MS,
	InboundAnswerTone
} from './inboundAnswerTone';

const tracks = [{stop: vi.fn()}];
const destination = {
	stream: {
		getTracks: () => tracks
	}
};
const silenceSource = {
	connect: vi.fn(),
	start: vi.fn(),
	stop: vi.fn()
};
const makeGain = () => ({
	gain: {
		value: 0,
		setValueAtTime: vi.fn(),
		exponentialRampToValueAtTime: vi.fn(),
		linearRampToValueAtTime: vi.fn()
	},
	connect: vi.fn(),
	disconnect: vi.fn()
});
const gains: ReturnType<typeof makeGain>[] = [];
const oscillators: Array<{
	type: OscillatorType;
	frequency: {setValueAtTime: ReturnType<typeof vi.fn>};
	connect: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}> = [];

class FakeAudioContext {
	currentTime = 4;
	createMediaStreamDestination = vi.fn(() => destination);
	createConstantSource = vi.fn(() => silenceSource);
	createGain = vi.fn(() => {
		const gain = makeGain();
		gains.push(gain);
		return gain;
	});
	createOscillator = vi.fn(() => {
		const oscillator = {
			type: 'sine' as OscillatorType,
			frequency: {setValueAtTime: vi.fn()},
			connect: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			disconnect: vi.fn()
		};
		oscillators.push(oscillator);
		return oscillator;
	});
	resume = vi.fn(async () => undefined);
	close = vi.fn(async () => undefined);
}

const audioInstances: FakeAudio[] = [];

class FakeAudio {
	srcObject: MediaProvider | null = null;
	play = vi.fn(async () => undefined);
	pause = vi.fn();
	setSinkId = vi.fn(async () => undefined);

	constructor() {
		audioInstances.push(this);
	}
}

describe('InboundAnswerTone', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		tracks[0].stop.mockClear();
		silenceSource.connect.mockClear();
		silenceSource.start.mockClear();
		silenceSource.stop.mockClear();
		gains.length = 0;
		oscillators.length = 0;
		audioInstances.length = 0;
		vi.stubGlobal('Audio', FakeAudio);
		vi.stubGlobal('window', {
			AudioContext: FakeAudioContext,
			setTimeout: globalThis.setTimeout,
			clearTimeout: globalThis.clearTimeout
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('arms silently, then overlays exactly one second on the local output', () => {
		const tone = new InboundAnswerTone();
		tone.arm('speaker-1');

		expect(audioInstances).toHaveLength(1);
		expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
		expect(audioInstances[0].setSinkId).toHaveBeenCalledWith('speaker-1');
		expect(silenceSource.start).toHaveBeenCalledTimes(1);

		tone.play();

		expect(oscillators).toHaveLength(6);
		expect(oscillators[0].frequency.setValueAtTime).toHaveBeenNthCalledWith(
			1,
			659.25,
			4
		);
		expect(oscillators[2].frequency.setValueAtTime).toHaveBeenCalledWith(
			783.99,
			4.18
		);
		expect(oscillators[4].frequency.setValueAtTime).toHaveBeenCalledWith(
			1046.5,
			4.36
		);
		expect(oscillators[0].start).toHaveBeenCalledWith(4);
		expect(oscillators[0].stop).toHaveBeenCalledWith(
			4 + (ANSWER_TONE_DURATION_MS / 1000) * 0.64 + 0.02
		);
		expect(oscillators[4].stop).toHaveBeenCalledWith(
			4 + (ANSWER_TONE_DURATION_MS / 1000) * (0.36 + 0.64) + 0.02
		);
		expect(gains[5].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
			0,
			5
		);
	});

	it('stops only the local tone when the call ends', () => {
		const tone = new InboundAnswerTone();
		tone.arm('default');
		tone.play();
		tone.stopTone();

		for (const oscillator of oscillators) {
			expect(oscillator.stop).toHaveBeenCalled();
			expect(oscillator.disconnect).toHaveBeenCalled();
		}
		// The silently armed output remains available for the next accepted call.
		expect(audioInstances[0].pause).not.toHaveBeenCalled();
		expect(silenceSource.stop).not.toHaveBeenCalled();
	});

	it('plays a short descending chime when a connected call ends', () => {
		const tone = new InboundAnswerTone();
		tone.arm('speaker-1');

		tone.playDisconnect();

		expect(oscillators).toHaveLength(4);
		expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
			1046.5,
			4
		);
		expect(oscillators[2].frequency.setValueAtTime).toHaveBeenCalledWith(
			783.99,
			4 + (DISCONNECT_TONE_DURATION_MS / 1000) * 0.42
		);
		expect(gains[3].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
			0,
			4 + DISCONNECT_TONE_DURATION_MS / 1000
		);
	});

	it('disposes the local graph without any Twilio media dependency', () => {
		const tone = new InboundAnswerTone();
		tone.arm('default');
		tone.dispose();

		expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
		expect(silenceSource.stop).toHaveBeenCalledTimes(1);
		expect(tracks[0].stop).toHaveBeenCalledTimes(1);
	});
});
