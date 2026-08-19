import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TelnyxHoldController, type TelnyxHoldTarget} from './telnyxHold';

/**
 * Hold on Telnyx works by replacing the call's outgoing audio track with generated music.
 * `setAudioInDevice` replaces the track on that SAME sender — so the dangerous case is a
 * mic change made while the caller is on hold: done naively it puts the agent's live
 * microphone on the line to someone who was told they were on hold, while the agent (still
 * deafened) hears nothing and never learns it happened.
 */

const track = (label: string) =>
	({kind: 'audio', label, stop: vi.fn()}) as unknown as MediaStreamTrack & {
		stop: ReturnType<typeof vi.fn>;
	};

const makeCall = (micTrack: MediaStreamTrack) => {
	const sender = {
		track: micTrack,
		replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => {
			sender.track = next as MediaStreamTrack;
		})
	};
	const call: TelnyxHoldTarget & {sender: typeof sender} = {
		deaf: vi.fn(),
		undeaf: vi.fn(),
		localStream: null,
		peer: {instance: {getSenders: () => [sender]} as unknown as RTCPeerConnection},
		sender
	};
	return call;
};

/** The music generator is injectable, so no Web Audio is needed here. */
const musicFactory = () => {
	const musicTrack = track('hold-music');
	return {
		createProcessedStream: async () =>
			({getAudioTracks: () => [musicTrack]}) as unknown as MediaStream,
		dispose: vi.fn(),
		musicTrack
	} as never;
};

const stubGetUserMedia = (produced: MediaStreamTrack) => {
	const getUserMedia = vi.fn(async () => ({
		getAudioTracks: () => [produced]
	}));
	vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
	return getUserMedia;
};

// vitest runs in the node environment here, so the browser globals the controller
// touches have to be supplied.
beforeEach(() => vi.stubGlobal('MediaStream', class {}));
afterEach(() => vi.unstubAllGlobals());

describe('TelnyxHoldController.setHeldInputDevice', () => {
	it('never touches the live sender — the caller keeps hearing music, not the room', async () => {
		const mic = track('laptop-mic');
		const call = makeCall(mic);
		const controller = new TelnyxHoldController(call, musicFactory);
		await controller.start();

		const onHoldTrack = call.sender.track;
		call.sender.replaceTrack.mockClear();
		stubGetUserMedia(track('headset-mic'));

		await controller.setHeldInputDevice('headset-id');

		// The sender is exactly as hold left it. This is the whole point.
		expect(call.sender.replaceTrack).not.toHaveBeenCalled();
		expect(call.sender.track).toBe(onHoldTrack);
	});

	it('makes Resume restore the microphone the agent chose while held', async () => {
		const mic = track('laptop-mic');
		const call = makeCall(mic);
		const controller = new TelnyxHoldController(call, musicFactory);
		await controller.start();

		const headset = track('headset-mic');
		stubGetUserMedia(headset);
		await controller.setHeldInputDevice('headset-id');
		await controller.stop();

		expect(call.sender.replaceTrack).toHaveBeenLastCalledWith(headset);
		// And the device we were holding for the resume is released rather than left open.
		expect((mic as unknown as {stop: ReturnType<typeof vi.fn>}).stop).toHaveBeenCalled();
	});

	it('leaves the saved microphone alone when the device cannot be opened', async () => {
		const mic = track('laptop-mic');
		const call = makeCall(mic);
		const controller = new TelnyxHoldController(call, musicFactory);
		await controller.start();

		// No audio track came back (a revoked permission, a device pulled mid-call).
		vi.stubGlobal('navigator', {
			mediaDevices: {getUserMedia: async () => ({getAudioTracks: () => []})}
		});
		await controller.setHeldInputDevice('ghost-id');
		await controller.stop();

		// Resume still restores something real rather than silence.
		expect(call.sender.replaceTrack).toHaveBeenLastCalledWith(mic);
	});

	it('does nothing when the call is not actually held', async () => {
		const call = makeCall(track('laptop-mic'));
		const controller = new TelnyxHoldController(call, musicFactory);
		const getUserMedia = stubGetUserMedia(track('headset-mic'));

		await controller.setHeldInputDevice('headset-id');

		// Not held ⇒ the ordinary per-call device switch owns this, and grabbing the mic
		// here would open a device nothing is going to use.
		expect(getUserMedia).not.toHaveBeenCalled();
	});
});
