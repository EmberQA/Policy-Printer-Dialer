import type {AudioHelper, AudioProcessor} from '@twilio/voice-sdk';

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

/**
 * An original, generated hold loop. Keeping the music in Web Audio avoids a
 * licensed binary asset, a public CDN, and another production dependency.
 */
export class HoldMusicProcessor implements AudioProcessor {
	private context: AudioContext | null = null;
	private destination: MediaStreamAudioDestinationNode | null = null;
	private compressor: DynamicsCompressorNode | null = null;
	private sources = new Set<OscillatorNode>();
	private scheduleTimer: number | null = null;
	private nextLoopAt = 0;

	constructor() {
		this.context = createAudioContext('This browser does not support hold music.');
		// Constructed synchronously from the Hold click so Chrome grants this context
		// playback even though Twilio reacquires the input stream asynchronously.
		void this.context.resume().catch(() => undefined);
	}

	async createProcessedStream(stream: MediaStream): Promise<MediaStream> {
		void stream;
		this.teardownGraph();
		const context =
			this.context ??
			createAudioContext('This browser does not support hold music.');
		this.context = context;
		const destination = context.createMediaStreamDestination();
		const compressor = context.createDynamicsCompressor();
		compressor.threshold.value = -24;
		compressor.knee.value = 18;
		compressor.ratio.value = 5;
		compressor.attack.value = 0.02;
		compressor.release.value = 0.3;
		compressor.connect(destination);
		this.context = context;
		this.destination = destination;
		this.compressor = compressor;
		await context.resume();

		this.nextLoopAt = context.currentTime + 0.08;
		this.scheduleAhead();
		this.scheduleTimer = window.setInterval(() => this.scheduleAhead(), 3_000);
		return destination.stream;
	}

	async destroyProcessedStream(stream: MediaStream): Promise<void> {
		void stream;
		this.teardownGraph();
	}

	private scheduleAhead(): void {
		const context = this.context;
		const compressor = this.compressor;
		if (!context || !compressor) return;

		while (this.nextLoopAt < context.currentTime + HOLD_LOOP_SECONDS * 1.5) {
			scheduleLoop(context, compressor, this.nextLoopAt, this.sources);
			this.nextLoopAt += HOLD_LOOP_SECONDS;
		}
	}

	dispose(): void {
		this.teardownGraph();
		if (this.context) void this.context.close().catch(() => undefined);
		this.context = null;
	}

	private teardownGraph(): void {
		if (this.scheduleTimer !== null) {
			window.clearInterval(this.scheduleTimer);
			this.scheduleTimer = null;
		}
		for (const source of this.sources) {
			try {
				source.stop();
			} catch {
				// A scheduled source may already have ended.
			}
		}
		this.sources.clear();
		this.compressor?.disconnect();
		this.destination?.stream.getTracks().forEach((track) => track.stop());
		this.destination = null;
		this.compressor = null;
		this.nextLoopAt = 0;
	}
}

/** Produces an active but silent audio track for the agent's speaker side. */
export class SilentAudioProcessor implements AudioProcessor {
	private context: AudioContext | null = null;
	private destination: MediaStreamAudioDestinationNode | null = null;
	private source: ConstantSourceNode | null = null;

	constructor() {
		this.context = createAudioContext('This browser does not support hold audio.');
		void this.context.resume().catch(() => undefined);
	}

	async createProcessedStream(stream: MediaStream): Promise<MediaStream> {
		void stream;
		this.teardownGraph();
		const context =
			this.context ??
			createAudioContext('This browser does not support hold audio.');
		this.context = context;
		const destination = context.createMediaStreamDestination();
		const source = context.createConstantSource();
		const gain = context.createGain();
		gain.gain.value = 0;
		source.connect(gain);
		gain.connect(destination);
		source.start();

		this.context = context;
		this.destination = destination;
		this.source = source;
		await context.resume();
		return destination.stream;
	}

	async destroyProcessedStream(stream: MediaStream): Promise<void> {
		void stream;
		this.teardownGraph();
	}

	dispose(): void {
		this.teardownGraph();
		if (this.context) void this.context.close().catch(() => undefined);
		this.context = null;
	}

	private teardownGraph(): void {
		try {
			this.source?.stop();
		} catch {
			// Already stopped.
		}
		this.source = null;
		this.destination?.stream.getTracks().forEach((track) => track.stop());
		this.destination = null;
	}
}

function createAudioContext(message: string): AudioContext {
	const AudioContextCtor =
		window.AudioContext ||
		(
			window as typeof window & {
				webkitAudioContext?: typeof AudioContext;
			}
		).webkitAudioContext;
	if (!AudioContextCtor) throw new Error(message);
	return new AudioContextCtor();
}

const HOLD_LOOP_SECONDS = 9.6;

const CHORDS = [
	[130.81, 164.81, 196.0, 246.94], // Cmaj7
	[110.0, 130.81, 164.81, 196.0], // Am7
	[87.31, 130.81, 164.81, 196.0], // Fmaj7
	[98.0, 123.47, 146.83, 164.81] // G6
] as const;

const MELODY = [
	659.25, 783.99, 880.0, 783.99,
	659.25, 523.25, 587.33, 659.25,
	698.46, 659.25, 523.25, 440.0,
	493.88, 587.33, 659.25, 587.33
] as const;

function scheduleLoop(
	context: AudioContext,
	target: AudioNode,
	startAt: number,
	sources: Set<OscillatorNode>
): void {
	CHORDS.forEach((chord, chordIndex) => {
		const chordStart = startAt + chordIndex * 2.4;
		for (const frequency of chord) {
			scheduleNote({
				context,
				target,
				frequency,
				startAt: chordStart,
				duration: 2.35,
				level: 0.018,
				type: 'triangle',
				sources
			});
		}
	});

	MELODY.forEach((frequency, noteIndex) => {
		scheduleNote({
			context,
			target,
			frequency,
			startAt: startAt + noteIndex * 0.6,
			duration: 0.52,
			level: 0.035,
			type: 'sine',
			sources
		});
	});
}

function scheduleNote({
	context,
	target,
	frequency,
	startAt,
	duration,
	level,
	type,
	sources
}: {
	context: AudioContext;
	target: AudioNode;
	frequency: number;
	startAt: number;
	duration: number;
	level: number;
	type: OscillatorType;
	sources: Set<OscillatorNode>;
}): void {
	const oscillator = context.createOscillator();
	const gain = context.createGain();
	oscillator.type = type;
	oscillator.frequency.setValueAtTime(frequency, startAt);
	gain.gain.setValueAtTime(0.0001, startAt);
	gain.gain.exponentialRampToValueAtTime(level, startAt + 0.08);
	gain.gain.setValueAtTime(level, startAt + Math.max(0.1, duration - 0.15));
	gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
	oscillator.connect(gain);
	gain.connect(target);
	oscillator.start(startAt);
	oscillator.stop(startAt + duration + 0.02);
	sources.add(oscillator);
	oscillator.onended = () => {
		sources.delete(oscillator);
		oscillator.disconnect();
		gain.disconnect();
	};
}
