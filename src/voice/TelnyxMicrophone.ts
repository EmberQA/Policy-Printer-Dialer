const unavailable = () => new Error('The selected microphone is unavailable. Reconnect it or select another microphone in Audio Setup.');

export const stopMicrophoneStream = (stream: MediaStream | null | undefined): void => {
	stream?.getTracks().forEach(track => track.stop());
};

/** Retains the selected input like Twilio's AudioHelper. Calls own only clones. */
export class TelnyxMicrophone {
	private stream: MediaStream | null = null;
	private pending: Promise<void> = Promise.resolve();
	private destroyed = false;

	constructor(private deviceId: string, private readonly onEnded: () => void) {}

	/** Serialize selection so a slower earlier capture cannot overwrite a later one. */
	select(deviceId: string, apply?: (source: MediaStream) => Promise<void>): Promise<void> {
		const operation = this.pending.then(async () => {
			if (this.destroyed) throw unavailable();
			const next = await navigator.mediaDevices.getUserMedia({
				audio: deviceId === 'default' ? true : {deviceId: {exact: deviceId}}
			});
			try {
				const track = next.getAudioTracks()[0];
				if (this.destroyed || !track || track.readyState !== 'live') throw unavailable();
				const actualId = track.getSettings().deviceId;
				// Windows exposes a communications alias as well as the default alias.
				if (deviceId !== 'default' && deviceId !== 'communications' && actualId && actualId !== deviceId) throw unavailable();
				await apply?.(next);
				if (this.destroyed || track.readyState !== 'live') throw unavailable();
				const previous = this.stream;
				this.stream = next;
				this.deviceId = deviceId;
				track.addEventListener('ended', () => {
					if (!this.destroyed && this.stream === next) this.onEnded();
				});
				stopMicrophoneStream(previous);
			} catch (error) {
				stopMicrophoneStream(next);
				throw error;
			}
		});
		this.pending = operation.catch(() => undefined);
		return operation;
	}

	async ensure(): Promise<void> {
		await this.pending;
		if (this.destroyed) throw unavailable();
		if (!this.stream?.getAudioTracks().some(track => track.readyState === 'live')) {
			await this.select(this.deviceId);
		}
	}

	clone(): MediaStream {
		if (this.destroyed || !this.stream?.getAudioTracks().some(track => track.readyState === 'live')) {
			throw unavailable();
		}
		return this.stream.clone();
	}

	destroy(): void {
		this.destroyed = true;
		stopMicrophoneStream(this.stream);
		this.stream = null;
	}
}
