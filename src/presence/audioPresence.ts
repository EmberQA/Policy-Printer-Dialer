import type {PresenceResponse, PresenceStatus} from '@/lib/api';

/** Serialize Ready and automatic Pause so a late Ready response cannot undo audio loss. */
export function createAudioPresence(write: (status: PresenceStatus) => Promise<PresenceResponse>) {
	let version = 0;
	let preparationVersion = 0;
	let writes: Promise<unknown> = Promise.resolve();
	let pendingPause: Promise<PresenceResponse> | null = null;
	return {
		async change(status: PresenceStatus, prepareAudio?: () => Promise<boolean>): Promise<PresenceResponse> {
			const beforeAudio = ++preparationVersion;
			if (status === 'ready') {
				if (!prepareAudio || !await prepareAudio()) {
					throw new Error('Audio setup failed. Check your microphone and speaker in Audio Setup before going Ready.');
				}
				if (beforeAudio !== preparationVersion) throw new Error('Readiness changed. Check your audio devices and try again.');
			}
			// A headset can lose both input and output together. Share the pause
			// rather than making one successful request look stale and retry it.
			if (status === 'paused' && pendingPause) return pendingPause;
			const request = ++version;
			pendingPause = null;
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
			if (status === 'paused') {
				pendingPause = result;
				const clear = () => { if (pendingPause === result) pendingPause = null; };
				void result.then(clear, clear);
			}
			return result;
		}
	};
}
