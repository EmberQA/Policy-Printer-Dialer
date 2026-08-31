/** Agent-only call notification tones.
 *
 * The tone has its own Web Audio graph and HTMLAudioElement. It never touches the
 * Twilio call, microphone, remote speaker stream, mute state, or audio processors,
 * so accepted call audio continues streaming in both directions underneath it.
 *
 * arm() is called from the Ready-button gesture. The audio element then remains
 * silently active, allowing call events to raise local tones without depending on a
 * second browser gesture.
 */
export class InboundAnswerTone {
	private context: AudioContext | null = null;
	private destination: MediaStreamAudioDestinationNode | null = null;
	private silenceSource: ConstantSourceNode | null = null;
	private audio: HTMLAudioElement | null = null;
	private toneOscillators: OscillatorNode[] = [];
	private toneGains: GainNode[] = [];
	private stopTimer: number | null = null;

	arm(outputDeviceId: string): void {
		if (this.context && this.audio) {
			void this.context.resume().catch(() => undefined);
			void this.audio.play().catch(() => undefined);
			this.setOutputDevice(outputDeviceId);
			return;
		}

		try {
			const AudioContextCtor =
				window.AudioContext ||
				(
					window as typeof window & {
						webkitAudioContext?: typeof AudioContext;
					}
				).webkitAudioContext;
			if (!AudioContextCtor) return;

			const context = new AudioContextCtor();
			const destination = context.createMediaStreamDestination();
			const silenceSource = context.createConstantSource();
			const silenceGain = context.createGain();
			const audio = new Audio() as HTMLAudioElement & {
				setSinkId?: (sinkId: string) => Promise<void>;
			};

			silenceGain.gain.value = 0;
			silenceSource.connect(silenceGain);
			silenceGain.connect(destination);
			silenceSource.start();
			audio.srcObject = destination.stream;

			this.context = context;
			this.destination = destination;
			this.silenceSource = silenceSource;
			this.audio = audio;

			// Keep this synchronous with the Ready gesture. The graph remains silent
			// until play() is called after Twilio has accepted an inbound call.
			void context.resume().catch(() => undefined);
			void audio.play().catch(() => undefined);
			this.setOutputDevice(outputDeviceId);
		} catch {
			this.dispose();
		}
	}

	play(durationMs = ANSWER_TONE_DURATION_MS): void {
		this.playChime({
			durationMs,
			notes: ANSWER_CHIME_NOTES,
			noteDuration: ANSWER_CHIME_NOTE_DURATION,
			fundamentalLevel: ANSWER_CHIME_FUNDAMENTAL_LEVEL,
			harmonicLevel: ANSWER_CHIME_HARMONIC_LEVEL
		});
	}

	/** Play a short descending chime after a connected call ends. */
	playDisconnect(durationMs = DISCONNECT_TONE_DURATION_MS): void {
		this.playChime({
			durationMs,
			notes: DISCONNECT_CHIME_NOTES,
			noteDuration: DISCONNECT_CHIME_NOTE_DURATION,
			fundamentalLevel: DISCONNECT_CHIME_FUNDAMENTAL_LEVEL,
			harmonicLevel: DISCONNECT_CHIME_HARMONIC_LEVEL
		});
	}

	private playChime({
		durationMs,
		notes,
		noteDuration,
		fundamentalLevel,
		harmonicLevel
	}: {
		durationMs: number;
		notes: ReadonlyArray<{frequency: number; offset: number}>;
		noteDuration: number;
		fundamentalLevel: number;
		harmonicLevel: number;
	}): void {
		const context = this.context;
		const destination = this.destination;
		if (!context || !destination) return;

		this.stopTone();
		try {
			const startAt = context.currentTime;
			const durationSeconds = durationMs / 1000;
			const oscillators: OscillatorNode[] = [];
			const gains: GainNode[] = [];

			for (const note of notes) {
				const noteStart = startAt + durationSeconds * note.offset;
				const noteEnd = noteStart + durationSeconds * noteDuration;
				const layers = [
					{
						frequency: note.frequency,
						level: fundamentalLevel,
						type: 'triangle' as OscillatorType
					},
					{
						frequency: note.frequency * 2,
						level: harmonicLevel,
						type: 'sine' as OscillatorType
					}
				];

				for (const layer of layers) {
					const gain = context.createGain();
					gain.gain.setValueAtTime(0.0001, noteStart);
					gain.gain.exponentialRampToValueAtTime(
						layer.level,
						noteStart + ANSWER_CHIME_ATTACK_SECONDS
					);
					// Exponential ramps cannot reach zero. Finish with a short linear
					// release to true silence before stopping both oscillator layers;
					// otherwise each stop can produce a tiny end click.
					gain.gain.exponentialRampToValueAtTime(
						0.0001,
						noteEnd - ANSWER_CHIME_ZERO_RELEASE_SECONDS
					);
					gain.gain.linearRampToValueAtTime(0, noteEnd);
					gain.connect(destination);

					const oscillator = context.createOscillator();
					oscillator.type = layer.type;
					oscillator.frequency.setValueAtTime(layer.frequency, noteStart);
					oscillator.connect(gain);
					oscillator.start(noteStart);
					oscillator.stop(noteEnd + 0.02);

					gains.push(gain);
					oscillators.push(oscillator);
				}
			}

			this.toneGains = gains;
			this.toneOscillators = oscillators;
			void context.resume().catch(() => undefined);
			void this.audio?.play().catch(() => undefined);
			this.stopTimer = window.setTimeout(
				() => this.stopTone(),
				durationMs + 50
			);
		} catch {
			this.stopTone();
		}
	}

	setOutputDevice(outputDeviceId: string): void {
		const audio = this.audio as
			| (HTMLAudioElement & {
					setSinkId?: (sinkId: string) => Promise<void>;
			  })
			| null;
		if (!audio?.setSinkId) return;
		void audio
			.setSinkId(outputDeviceId === 'default' ? '' : outputDeviceId)
			.catch(() => undefined);
	}

	stopTone(): void {
		if (this.stopTimer !== null) {
			window.clearTimeout(this.stopTimer);
			this.stopTimer = null;
		}
		for (const oscillator of this.toneOscillators) {
			try {
				oscillator.stop();
			} catch {
				/* already stopped */
			}
			oscillator.disconnect();
		}
		this.toneOscillators = [];
		for (const gain of this.toneGains) gain.disconnect();
		this.toneGains = [];
	}

	dispose(): void {
		this.stopTone();
		this.audio?.pause();
		try {
			this.silenceSource?.stop();
		} catch {
			/* already stopped */
		}
		this.destination?.stream.getTracks().forEach((track) => track.stop());
		if (this.context) void this.context.close().catch(() => undefined);
		this.context = null;
		this.destination = null;
		this.silenceSource = null;
		this.audio = null;
	}
}

export const ANSWER_TONE_DURATION_MS = 1_000;
export const DISCONNECT_TONE_DURATION_MS = 500;

// A warm E5-G5-C6 major arpeggio, using the same musical character as hold audio.
const ANSWER_CHIME_NOTES = [
	{frequency: 659.25, offset: 0},
	{frequency: 783.99, offset: 0.18},
	{frequency: 1046.5, offset: 0.36}
] as const;
const ANSWER_CHIME_NOTE_DURATION = 0.64;
const ANSWER_CHIME_ATTACK_SECONDS = 0.025;
const ANSWER_CHIME_ZERO_RELEASE_SECONDS = 0.025;
const ANSWER_CHIME_FUNDAMENTAL_LEVEL = 0.22;
const ANSWER_CHIME_HARMONIC_LEVEL = 0.06;

// A concise C6-G5 descent: audibly distinct from the rising answer arpeggio without
// sounding like an alarm. It uses the already-armed output graph on both carriers.
const DISCONNECT_CHIME_NOTES = [
	{frequency: 1046.5, offset: 0},
	{frequency: 783.99, offset: 0.42}
] as const;
const DISCONNECT_CHIME_NOTE_DURATION = 0.58;
const DISCONNECT_CHIME_FUNDAMENTAL_LEVEL = 0.18;
const DISCONNECT_CHIME_HARMONIC_LEVEL = 0.04;
