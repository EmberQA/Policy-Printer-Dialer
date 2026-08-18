import type {AudioHelper, AudioProcessor} from '@twilio/voice-sdk';
import {HoldMusicProcessor, SilentAudioProcessor} from '@/voice/holdMusic';

/**
 * The generators moved to `voice/holdMusic.ts` in Subplan 05 so the Telnyx hold host
 * can reuse them — they are pure Web Audio and were never Twilio-specific. Re-exported
 * here so existing imports and `holdAudio.test.ts` are untouched.
 */
export {HoldMusicProcessor, SilentAudioProcessor} from '@/voice/holdMusic';

type ProcessorHost = Pick<AudioHelper, 'addProcessor' | 'removeProcessor'>;
type ManagedAudioProcessor = AudioProcessor & {dispose?: () => void};

/**
 * Owns the two processors that turn the existing direct Client call into a
 * browser-side hold:
 *   - local: replace the microphone with a quiet original music loop;
 *   - remote: replace caller playback with silence while the agent is away.
 *
 * The Twilio call itself never disconnects or changes legs. Removing both
 * processors restores the selected microphone and speaker streams.
 *
 * TWILIO ONLY — this is built on the SDK's `AudioProcessor` plugin API, which Telnyx
 * has no equivalent for. The Telnyx host (`voice/telnyxHold.ts`) reaches the same two
 * outcomes through `call.deaf()` and `RTCRtpSender.replaceTrack`.
 */
export class HoldAudioController {
	private localAdded = false;
	private remoteAdded = false;
	private stopping = false;

	constructor(
		private readonly audio: ProcessorHost,
		private readonly localProcessor: ManagedAudioProcessor = new HoldMusicProcessor(),
		private readonly remoteProcessor: ManagedAudioProcessor = new SilentAudioProcessor()
	) {}

	async start(): Promise<void> {
		this.stopping = false;
		try {
			const localAdd = this.audio.addProcessor(this.localProcessor, false);
			this.localAdded = true;
			await localAdd;
			if (this.stopping) {
				await this.stop();
				return;
			}

			const remoteAdd = this.audio.addProcessor(this.remoteProcessor, true);
			this.remoteAdded = true;
			await remoteAdd;
			if (this.stopping) await this.stop();
		} catch (error) {
			try {
				await this.stop();
			} catch {
				// Preserve the original add failure; stop remains best-effort here.
			}
			if (!this.localAdded) this.localProcessor.dispose?.();
			if (!this.remoteAdded) this.remoteProcessor.dispose?.();
			throw error;
		}
	}

	async stop(): Promise<void> {
		this.stopping = true;

		if (this.remoteAdded) {
			// Restore caller playback first. If that fails, keep the local music
			// processor in place so the caller never unexpectedly hears the agent.
			await this.audio.removeProcessor(this.remoteProcessor, true);
			this.remoteAdded = false;
			this.remoteProcessor.dispose?.();
		}

		if (this.localAdded) {
			await this.audio.removeProcessor(this.localProcessor, false);
			this.localAdded = false;
			this.localProcessor.dispose?.();
		}
	}
}
