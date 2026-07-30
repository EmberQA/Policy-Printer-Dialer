const DEFAULT_DEVICE_ID = 'default';

export const ECHO_RECORDING_DURATION_MS = 3_000;
const ECHO_PROGRESS_UPDATE_MS = 100;

export type RecordedEchoPhase = 'recording' | 'playing' | 'complete';

export interface RecordedEchoProgress {
	phase: 'recording' | 'playing';
	elapsedMs: number;
	durationMs: number;
}

type OutputAudio = HTMLAudioElement & {
	setSinkId?: (sinkId: string) => Promise<void>;
};

/**
 * Records a short microphone sample and then plays it through the selected
 * speaker. Capture and playback never share a live audio graph, so the test
 * does not depend on Web Audio clock synchronization or AudioContext routing.
 */
export class RecordedEcho {
	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private audio: OutputAudio | null = null;
	private objectUrl: string | null = null;
	private recordingTimer: number | null = null;
	private recordingProgressTimer: number | null = null;
	private playbackProgressTimer: number | null = null;
	private cancelPlayback: (() => void) | null = null;
	private stopped = false;

	constructor(
		private readonly inputDeviceId: string,
		private readonly outputDeviceId: string,
		private readonly onPhaseChange: (phase: RecordedEchoPhase) => void,
		private readonly onProgressChange: (
			progress: RecordedEchoProgress
		) => void = () => undefined
	) {}

	async start(): Promise<void> {
		if (typeof MediaRecorder === 'undefined') {
			throw new Error('Audio recording is not supported in this browser.');
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio:
					this.inputDeviceId === DEFAULT_DEVICE_ID
						? true
						: {deviceId: {exact: this.inputDeviceId}}
			});
			if (this.stopped) {
				stopTracks(stream);
				return;
			}
			this.stream = stream;

			const recording = await this.recordSample(stream);
			this.stopCapture();
			if (this.stopped) return;
			if (recording.size === 0) {
				throw new Error('The microphone recording was empty.');
			}

			await this.playRecording(recording);
		} catch (error) {
			this.stop();
			throw error;
		}
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;

		if (this.recordingTimer !== null) {
			window.clearTimeout(this.recordingTimer);
			this.recordingTimer = null;
		}
		this.clearRecordingProgress();
		this.clearPlaybackProgress();
		if (this.recorder?.state === 'recording') {
			this.recorder.stop();
		}
		this.stopCapture();
		this.cancelPlayback?.();
		this.releasePlayback();
	}

	private recordSample(stream: MediaStream): Promise<Blob> {
		return new Promise((resolve, reject) => {
			const chunks: Blob[] = [];
			const recorder = new MediaRecorder(stream);
			this.recorder = recorder;

			recorder.addEventListener('dataavailable', (event) => {
				if (event.data.size > 0) chunks.push(event.data);
			});
			recorder.addEventListener(
				'error',
				(event) => reject(event.error || new Error('Audio recording failed.')),
				{once: true}
			);
			recorder.addEventListener(
				'stop',
				() => {
					const type = chunks.find((chunk) => chunk.type)?.type;
					resolve(new Blob(chunks, type ? {type} : undefined));
				},
				{once: true}
			);

			recorder.start();
			this.onPhaseChange('recording');
			const recordingStartedAt = Date.now();
			this.reportProgress('recording', 0, ECHO_RECORDING_DURATION_MS);
			this.recordingProgressTimer = window.setInterval(() => {
				this.reportProgress(
					'recording',
					Date.now() - recordingStartedAt,
					ECHO_RECORDING_DURATION_MS
				);
			}, ECHO_PROGRESS_UPDATE_MS);
			this.recordingTimer = window.setTimeout(() => {
				this.recordingTimer = null;
				this.reportProgress(
					'recording',
					ECHO_RECORDING_DURATION_MS,
					ECHO_RECORDING_DURATION_MS
				);
				this.clearRecordingProgress();
				if (recorder.state === 'recording') recorder.stop();
			}, ECHO_RECORDING_DURATION_MS);
		});
	}

	private async playRecording(recording: Blob): Promise<void> {
		const audio = new Audio() as OutputAudio;
		this.audio = audio;

		if (this.outputDeviceId !== DEFAULT_DEVICE_ID) {
			if (!audio.setSinkId) {
				throw new Error('This browser cannot test a selected speaker.');
			}
			await audio.setSinkId(this.outputDeviceId);
		}
		if (this.stopped) return;

		const objectUrl = URL.createObjectURL(recording);
		this.objectUrl = objectUrl;
		audio.src = objectUrl;

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				this.cancelPlayback = null;
				audio.removeEventListener('ended', handleEnded);
				audio.removeEventListener('error', handleError);
				if (error) reject(error);
				else resolve();
			};
			const handleEnded = () => {
				this.reportPlaybackProgress(audio, true);
				this.clearPlaybackProgress();
				if (!this.stopped) this.onPhaseChange('complete');
				finish();
				this.releasePlayback();
			};
			const handleError = () =>
				finish(new Error('Could not play the microphone recording.'));
			this.cancelPlayback = () => finish();
			audio.addEventListener('ended', handleEnded, {once: true});
			audio.addEventListener('error', handleError, {once: true});

			void audio
				.play()
				.then(() => {
					if (this.stopped) return;
					this.onPhaseChange('playing');
					this.reportPlaybackProgress(audio);
					this.playbackProgressTimer = window.setInterval(
						() => this.reportPlaybackProgress(audio),
						ECHO_PROGRESS_UPDATE_MS
					);
				})
				.catch((error: unknown) =>
					finish(
						error instanceof Error
							? error
							: new Error('Could not play the microphone recording.')
					)
				);
		});
	}

	private stopCapture(): void {
		this.clearRecordingProgress();
		stopTracks(this.stream);
		this.stream = null;
		this.recorder = null;
	}

	private releasePlayback(): void {
		this.clearPlaybackProgress();
		if (this.audio) {
			this.audio.pause();
			this.audio.removeAttribute('src');
			this.audio.load();
			this.audio = null;
		}
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
	}

	private reportPlaybackProgress(audio: HTMLAudioElement, complete = false) {
		const durationMs =
			Number.isFinite(audio.duration) && audio.duration > 0
				? audio.duration * 1_000
				: ECHO_RECORDING_DURATION_MS;
		this.reportProgress(
			'playing',
			complete ? durationMs : audio.currentTime * 1_000,
			durationMs
		);
	}

	private reportProgress(
		phase: RecordedEchoProgress['phase'],
		elapsedMs: number,
		durationMs: number
	) {
		this.onProgressChange({
			phase,
			elapsedMs: Math.max(0, Math.min(elapsedMs, durationMs)),
			durationMs
		});
	}

	private clearRecordingProgress() {
		if (this.recordingProgressTimer === null) return;
		window.clearInterval(this.recordingProgressTimer);
		this.recordingProgressTimer = null;
	}

	private clearPlaybackProgress() {
		if (this.playbackProgressTimer === null) return;
		window.clearInterval(this.playbackProgressTimer);
		this.playbackProgressTimer = null;
	}
}

function stopTracks(stream: MediaStream | null) {
	stream?.getTracks().forEach((track) => track.stop());
}
