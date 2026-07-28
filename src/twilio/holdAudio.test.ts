import {describe, expect, it, vi} from 'vitest';
import type {AudioHelper, AudioProcessor} from '@twilio/voice-sdk';
import {HoldAudioController} from './holdAudio';

const processor = (): AudioProcessor => ({
	createProcessedStream: vi.fn(),
	destroyProcessedStream: vi.fn()
});

describe('HoldAudioController', () => {
	it('adds music and remote silence, then restores both sides', async () => {
		const calls: string[] = [];
		const audio = {
			addProcessor: vi.fn(async (_processor: AudioProcessor, remote = false) => {
				calls.push(`add:${remote ? 'remote' : 'local'}`);
			}),
			removeProcessor: vi.fn(
				async (_processor: AudioProcessor, remote = false) => {
					calls.push(`remove:${remote ? 'remote' : 'local'}`);
				}
			)
		} as unknown as Pick<AudioHelper, 'addProcessor' | 'removeProcessor'>;
		const controller = new HoldAudioController(
			audio,
			processor(),
			processor()
		);

		await controller.start();
		await controller.stop();

		expect(calls).toEqual([
			'add:local',
			'add:remote',
			'remove:remote',
			'remove:local'
		]);
	});

	it('rolls back the music processor when remote silence cannot start', async () => {
		const local = processor();
		const remote = processor();
		const audio = {
			addProcessor: vi.fn(
				async (candidate: AudioProcessor, isRemote = false) => {
					if (candidate === remote && isRemote) {
						throw new Error('remote processor failed');
					}
				}
			),
			removeProcessor: vi.fn(async () => undefined)
		} as unknown as Pick<AudioHelper, 'addProcessor' | 'removeProcessor'>;
		const controller = new HoldAudioController(audio, local, remote);

		await expect(controller.start()).rejects.toThrow('remote processor failed');
		expect(audio.removeProcessor).toHaveBeenCalledWith(remote, true);
		expect(audio.removeProcessor).toHaveBeenCalledWith(local, false);
	});

	it('removes a local processor whose audio startup rejected', async () => {
		const local = processor();
		const audio = {
			addProcessor: vi.fn(
				(candidate: AudioProcessor) =>
					candidate === local
						? Promise.reject(new Error('music startup failed'))
						: Promise.resolve()
			),
			removeProcessor: vi.fn(async () => undefined)
		} as unknown as Pick<AudioHelper, 'addProcessor' | 'removeProcessor'>;
		const controller = new HoldAudioController(audio, local, processor());

		await expect(controller.start()).rejects.toThrow('music startup failed');
		expect(audio.removeProcessor).toHaveBeenCalledWith(local, false);
	});

	it('keeps caller music active when speaker restoration fails', async () => {
		const local = processor();
		const remote = processor();
		let failRemoteRemoval = true;
		const audio = {
			addProcessor: vi.fn(async () => undefined),
			removeProcessor: vi.fn(
				async (candidate: AudioProcessor, isRemote = false) => {
					if (candidate === remote && isRemote && failRemoteRemoval) {
						throw new Error('speaker restore failed');
					}
				}
			)
		} as unknown as Pick<AudioHelper, 'addProcessor' | 'removeProcessor'>;
		const controller = new HoldAudioController(audio, local, remote);
		await controller.start();

		await expect(controller.stop()).rejects.toThrow('speaker restore failed');
		expect(audio.removeProcessor).not.toHaveBeenCalledWith(local, false);

		failRemoteRemoval = false;
		await controller.stop();
		expect(audio.removeProcessor).toHaveBeenCalledWith(local, false);
	});

	it('can be stopped repeatedly without removing absent processors', async () => {
		const audio = {
			addProcessor: vi.fn(async () => undefined),
			removeProcessor: vi.fn(async () => undefined)
		} as unknown as Pick<AudioHelper, 'addProcessor' | 'removeProcessor'>;
		const controller = new HoldAudioController(
			audio,
			processor(),
			processor()
		);

		await controller.start();
		await controller.stop();
		await controller.stop();

		expect(audio.removeProcessor).toHaveBeenCalledTimes(2);
	});
});
