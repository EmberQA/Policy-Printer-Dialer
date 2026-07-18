/** A local US-style ringback generator. It never touches Twilio media: two quiet
 * oscillators are routed through an HTMLAudioElement so Chrome can send the tone
 * to the same selected speaker as the softphone. All failures are non-fatal. */
export class OutboundRingback {
	private context: AudioContext | null = null;
	private destination: MediaStreamAudioDestinationNode | null = null;
	private oscillators: OscillatorNode[] = [];
	private gain: GainNode | null = null;
	private audio: HTMLAudioElement | null = null;
	private cadenceTimer: number | null = null;
	private cadenceOn = false;

	start(outputDeviceId: string): void {
		this.stop();
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
			const gain = context.createGain();
			const audio = new Audio() as HTMLAudioElement & {
				setSinkId?: (sinkId: string) => Promise<void>;
			};

			gain.gain.value = 0.0001;
			gain.connect(destination);
			const oscillators = [440, 480].map((frequency) => {
				const oscillator = context.createOscillator();
				oscillator.type = 'sine';
				oscillator.frequency.value = frequency;
				oscillator.connect(gain);
				oscillator.start();
				return oscillator;
			});
			audio.srcObject = destination.stream;

			this.context = context;
			this.destination = destination;
			this.oscillators = oscillators;
			this.gain = gain;
			this.audio = audio;

			// Invoke play synchronously from the dial gesture. Speaker routing can settle
			// asynchronously without delaying the autoplay-unlock call.
			void context.resume().catch(() => undefined);
			void audio.play().catch(() => undefined);
			this.setOutputDevice(outputDeviceId);
			this.beginCadence();
		} catch {
			this.stop();
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

	stop(): void {
		if (this.cadenceTimer !== null) {
			window.clearTimeout(this.cadenceTimer);
			this.cadenceTimer = null;
		}
		this.audio?.pause();
		this.oscillators.forEach((oscillator) => {
			try {
				oscillator.stop();
			} catch {
				/* already stopped */
			}
		});
		this.destination?.stream.getTracks().forEach((track) => track.stop());
		if (this.context) void this.context.close().catch(() => undefined);
		this.context = null;
		this.destination = null;
		this.oscillators = [];
		this.gain = null;
		this.audio = null;
		this.cadenceOn = false;
	}

	private beginCadence(): void {
		const toggle = () => {
			if (!this.context || !this.gain) return;
			this.cadenceOn = !this.cadenceOn;
			const now = this.context.currentTime;
			this.gain.gain.cancelScheduledValues(now);
			this.gain.gain.setValueAtTime(Math.max(this.gain.gain.value, 0.0001), now);
			this.gain.gain.exponentialRampToValueAtTime(
				this.cadenceOn ? 0.055 : 0.0001,
				now + 0.04
			);
			this.cadenceTimer = window.setTimeout(toggle, this.cadenceOn ? 2_000 : 4_000);
		};
		toggle();
	}
}
