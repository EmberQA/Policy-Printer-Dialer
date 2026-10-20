import type {PresenceResponse, PresenceStatus} from '@/lib/api';

/** Serialize Ready and automatic Pause so a late Ready response cannot undo audio loss. */
export function createAudioPresence(write: (status: PresenceStatus) => Promise<PresenceResponse>) {
	let version = 0;
	let writes: Promise<unknown> = Promise.resolve();
	return {
		async change(status: PresenceStatus, prepareAudio?: () => Promise<boolean>): Promise<PresenceResponse> {
			const request = ++version;
			if (status === 'ready' && (!prepareAudio || !await prepareAudio())) {
				throw new Error('Audio setup failed. Check your microphone and speaker in Audio Setup before going Ready.');
			}
			const checkCurrent = () => {
				if (request !== version) throw new Error('Readiness changed. Check your audio devices and try again.');
			};
			const result = writes.then(async () => {
				checkCurrent();
				const response = await write(status);
				if (response.statusCode !== 'SP100') throw new Error(response.statusMessage || 'Could not update presence');
				checkCurrent();
				return response;
			});
			writes = result.catch(() => undefined);
			return result;
		}
	};
}
