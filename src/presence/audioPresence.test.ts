import {describe, expect, it, vi} from 'vitest';
import {createAudioPresence} from './audioPresence';
import type {PresenceResponse} from '@/lib/api';
const ok = {statusCode: 'SP100', statusMessage: 'OK'};
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {resolve = done;});
	return {promise, resolve};
}

describe('audio readiness and pause ordering', () => {
	it('starts audio in the click gesture and does not advertise Ready until it succeeds', async () => {
		const audio = deferred<boolean>(); const write = vi.fn(async () => ok);
		const prepare = vi.fn(() => audio.promise);
		const ready = createAudioPresence(write).change('ready', prepare);
		expect(prepare).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
		audio.resolve(true); await ready;
		expect(write).toHaveBeenCalledExactlyOnceWith('ready');
	});
	it('keeps the agent paused if microphone or speaker setup fails', async () => {
		const write = vi.fn(async () => ok);
		await expect(createAudioPresence(write).change('ready', async () => false)).rejects.toThrow('Audio setup failed');
		expect(write).not.toHaveBeenCalled();
	});
	it('cancels pending audio preparation when the microphone disconnects', async () => {
		const audio = deferred<boolean>(); const write = vi.fn(async () => ok);
		const controller = createAudioPresence(write);
		const ready = controller.change('ready', () => audio.promise);
		const rejected = expect(ready).rejects.toThrow('Readiness changed');
		await controller.change('paused'); audio.resolve(true); await rejected;
		expect(write.mock.calls).toEqual([['paused']]);
	});
	it('sends Pause after an in-flight Ready finishes and never returns its stale success', async () => {
		const response = deferred<PresenceResponse>();
		const write = vi.fn().mockImplementationOnce(() => response.promise).mockResolvedValue(ok);
		const controller = createAudioPresence(write);
		const ready = controller.change('ready', async () => true);
		const rejected = expect(ready).rejects.toThrow('Readiness changed');
		await vi.waitFor(() => expect(write).toHaveBeenCalledWith('ready'));
		const paused = controller.change('paused');
		expect(write).toHaveBeenCalledTimes(1);
		response.resolve(ok); await rejected; await paused;
		expect(write.mock.calls).toEqual([['ready'], ['paused']]);
	});
	it('can retry a failed server pause and only resumes on an explicit successful Ready', async () => {
		const write = vi.fn().mockResolvedValueOnce({statusCode: 'ERROR', statusMessage: 'Offline'}).mockResolvedValue(ok);
		const controller = createAudioPresence(write);
		await expect(controller.change('paused')).rejects.toThrow('Offline');
		await controller.change('paused');
		expect(write.mock.calls).toEqual([['paused'], ['paused']]);
		await controller.change('ready', async () => true);
		expect(write).toHaveBeenLastCalledWith('ready');
	});
	it('shares simultaneous microphone and speaker pauses without a stale failure or retry', async () => {
		const response = deferred<PresenceResponse>();
		const write = vi.fn().mockImplementationOnce(() => response.promise).mockResolvedValue(ok);
		const controller = createAudioPresence(write);
		const microphone = controller.change('paused');
		const speaker = controller.change('paused');
		response.resolve(ok);
		await expect(microphone).resolves.toEqual(ok);
		await expect(speaker).resolves.toEqual(ok);
		expect(write.mock.calls).toEqual([['paused']]);
		await controller.change('ready', async () => true);
		expect(write.mock.calls).toEqual([['paused'], ['ready']]);
	});
	it('does not cancel a required pause when an attempted Ready fails audio validation', async () => {
		const response = deferred<PresenceResponse>();
		const controller = createAudioPresence(() => response.promise);
		const paused = controller.change('paused');
		await expect(controller.change('ready', async () => false)).rejects.toThrow('Audio setup failed');
		response.resolve(ok);
		await expect(paused).resolves.toEqual(ok);
	});
	it('a new loss still overrides Ready when an earlier pause is in flight', async () => {
		const response = deferred<PresenceResponse>();
		const write = vi.fn().mockImplementationOnce(() => response.promise).mockResolvedValue(ok);
		const controller = createAudioPresence(write);
		const firstPause = controller.change('paused');
		const firstRejected = expect(firstPause).rejects.toThrow('Readiness changed');
		await vi.waitFor(() => expect(write).toHaveBeenCalledWith('paused'));
		const ready = controller.change('ready', async () => true);
		const readyRejected = expect(ready).rejects.toThrow('Readiness changed');
		await Promise.resolve();
		const newLoss = controller.change('paused');
		response.resolve(ok);
		await firstRejected; await readyRejected; await newLoss;
		expect(write.mock.calls).toEqual([['paused'], ['paused']]);
	});
	it('a shared pause also cancels Ready while audio is still preparing', async () => {
		const response = deferred<PresenceResponse>(); const audio = deferred<boolean>();
		const write = vi.fn(() => response.promise);
		const controller = createAudioPresence(write);
		const firstPause = controller.change('paused');
		const ready = controller.change('ready', () => audio.promise);
		const rejected = expect(ready).rejects.toThrow('Readiness changed');
		const secondPause = controller.change('paused');
		audio.resolve(true); response.resolve(ok);
		await rejected; await firstPause; await secondPause;
		expect(write.mock.calls).toEqual([['paused']]);
	});
});
