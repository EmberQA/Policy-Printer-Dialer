import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TelnyxHoldController, type TelnyxHoldTarget} from './telnyxHold';

const track = (label: string) => ({kind: 'audio', label, stop: vi.fn()}) as unknown as MediaStreamTrack;
const makeCall = (micTrack: MediaStreamTrack) => {
	const sender = {track: micTrack, replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => {sender.track = next!;})};
	const call: TelnyxHoldTarget & {sender: typeof sender} = {
		deaf: vi.fn(), undeaf: vi.fn(), localStream: null,
		peer: {instance: {getSenders: () => [sender]} as unknown as RTCPeerConnection}, sender
	};
	return call;
};
const musicFactory = () => ({
	createProcessedStream: async () => ({getAudioTracks: () => [track('music')]}), dispose: vi.fn()
}) as never;
beforeEach(() => vi.stubGlobal('MediaStream', class {}));
afterEach(() => vi.unstubAllGlobals());

describe('TelnyxHoldController.setHeldInputTrack', () => {
	it('keeps music on the live sender and restores the selected track on Resume', async () => {
		const mic = track('old');
		const call = makeCall(mic);
		const controller = new TelnyxHoldController(call, musicFactory);
		await controller.start();
		const music = call.sender.track;
		call.sender.replaceTrack.mockClear();
		const next = track('Maono');
		controller.setHeldInputTrack(next);
		expect(call.sender.track).toBe(music);
		expect(call.sender.replaceTrack).not.toHaveBeenCalled();
		// Stream disposal belongs to the transport after the replacement is committed.
		expect(mic.stop).not.toHaveBeenCalled();
		await controller.stop();
		expect(call.sender.replaceTrack).toHaveBeenLastCalledWith(next);
	});
	it('rejects a replacement when not held', () => {
		const controller = new TelnyxHoldController(makeCall(track('old')), musicFactory);
		expect(() => controller.setHeldInputTrack(track('new'))).toThrow('hold change');
	});
	it('rejects a replacement while hold is still being prepared', async () => {
		let resolve!: (stream: MediaStream) => void;
		const controller = new TelnyxHoldController(makeCall(track('old')), () => ({
			createProcessedStream: () => new Promise<MediaStream>(r => {resolve = r;}), dispose: vi.fn()
		}) as never);
		const pending = controller.start();
		expect(() => controller.setHeldInputTrack(track('new'))).toThrow('hold change');
		resolve({getAudioTracks: () => [track('music')]} as unknown as MediaStream);
		await pending;
		await controller.stop();
	});
});
