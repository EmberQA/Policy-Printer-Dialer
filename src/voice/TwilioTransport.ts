/**
 * The Twilio implementation of `VoiceTransport` (ENG-159 — Subplan 05).
 *
 * Every SDK call in here was lifted from `useDevice.ts` UNCHANGED, including the
 * private-field AudioContext resume and the `tokenWillExpire` refresh. That is
 * deliberate: this carrier is in production today, so 05 must be provably a no-op for
 * it. Behaviour differences belong in `TelnyxTransport`, not here.
 */

import {Call, Device, type RTCSample} from '@twilio/voice-sdk';
import {HoldAudioController} from '@/twilio/holdAudio';
import {normalizeTwilioParameters} from './legParameters';
import type {
	IncomingLeg,
	LegEvent,
	TransportStatus,
	VoiceTransport,
	VoiceTransportOptions
} from './VoiceTransport';

export class TwilioTransport implements VoiceTransport {
	readonly provider = 'twilio' as const;

	private device: Device | null = null;
	private holdController: HoldAudioController | null = null;
	private incomingCb: ((leg: IncomingLeg) => void) | null = null;
	private statusCb: ((s: TransportStatus, e?: string) => void) | null = null;
	private deviceChangeCb: ((input: string, output: string) => void) | null = null;
	private destroyed = false;

	constructor(private readonly options: VoiceTransportOptions) {}

	async register(token: string): Promise<void> {
		const device = new Device(token, {
			codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
			allowIncomingWhileBusy: false
		});
		// We accept inbound calls immediately and provide our own post-answer
		// agent-only chime. Prevent Twilio's pre-answer ringtone from racing it.
		device.audio?.incoming(false);
		this.device = device;
		// Keep this listener ahead of register(), as it was in the direct Twilio
		// implementation. Bluetooth devices can settle on a concrete input/output while
		// registration is in flight; subscribing afterward loses that transition and
		// leaves the dialer pointing at `default` or a stale headset profile.
		device.audio?.on('deviceChange', this.emitDeviceSelection);
		this.emitDeviceSelection();

		device.on('registered', () => {
			device.audio?.incoming(false);
			this.emitDeviceSelection();
			this.statusCb?.('registered');
		});
		device.on('unregistered', () => this.statusCb?.('offline'));
		device.on('error', (e: {message?: string}) => {
			this.statusCb?.('error', e?.message || 'Device error');
		});
		device.on('incoming', (call: Call) => {
			this.incomingCb?.(new TwilioLeg(call));
		});

		// Refresh the (short-lived, 1h) Twilio token before it expires. The SDK owns the
		// schedule here — the Telnyx transport has to invent one.
		device.on('tokenWillExpire', async () => {
			try {
				const fresh = await this.options.refreshToken();
				if (!this.destroyed) await this.device?.updateToken(fresh);
			} catch {
				// `onError` lands in `device.error`, which renders on the Dial page — so
				// this is agent-facing copy and must not name a carrier. See the identical
				// string in TelnyxTransport.
				this.options.onError?.('Reconnecting to the call network…');
			}
		});

		this.statusCb?.('connecting');
		await device.register();
	}

	destroy(): void {
		this.destroyed = true;
		void this.stopHold().catch(() => undefined);
		try {
			this.device?.destroy();
		} catch {
			/* ignore */
		}
		this.device = null;
	}

	onIncoming(cb: (leg: IncomingLeg) => void): void {
		this.incomingCb = cb;
	}

	onStatus(cb: (status: TransportStatus, error?: string) => void): void {
		this.statusCb = cb;
	}

	/**
	 * Resume the SDK's AudioContext so playback isn't blocked. The Voice SDK exposes it
	 * on `device.audio`; resuming it inside the Ready-button gesture is what unblocks
	 * the auto-answered call's audio.
	 *
	 * Reaching into `_audioContext` is a private-field hack we are stuck with on this
	 * carrier — Telnyx plays through an HTMLMediaElement, so its transport calls
	 * `element.play()` instead and carries no equivalent.
	 */
	async armAudio(): Promise<void> {
		try {
			const audio = this.device?.audio as
				{_audioContext?: AudioContext} | undefined;
			const ctx = audio?._audioContext;
			if (ctx && ctx.state === 'suspended') await ctx.resume();
		} catch {
			/* non-fatal: mic is granted; playback may still resume on accept */
		}
	}

	async setInputDevice(deviceId: string): Promise<void> {
		const audio = this.device?.audio;
		if (!audio) throw new Error('Softphone audio is not ready yet.');
		await audio.setInputDevice(deviceId);
	}

	async setOutputDevice(deviceId: string): Promise<void> {
		const audio = this.device?.audio;
		if (!audio) throw new Error('Softphone audio is not ready yet.');
		if (!audio.isOutputSelectionSupported) {
			if (deviceId === 'default') return;
			throw new Error(
				'This browser cannot choose a speaker. Use Chrome or your system output settings.'
			);
		}
		await Promise.all([
			audio.speakerDevices.set(deviceId),
			audio.ringtoneDevices.set(deviceId)
		]);
	}

	async startHold(): Promise<void> {
		const audio = this.device?.audio;
		if (!audio) throw new Error('There is no active call to place on hold.');
		if (this.holdController) return;
		const controller = new HoldAudioController(audio);
		this.holdController = controller;
		try {
			await controller.start();
		} catch (error) {
			if (this.holdController === controller) this.holdController = null;
			await controller.stop().catch(() => undefined);
			throw error;
		}
	}

	async stopHold(): Promise<void> {
		const controller = this.holdController;
		if (!controller) return;
		await controller.stop();
		this.holdController = null;
	}

	/** Exposed so the hook can report which device selection the SDK settled on. */
	onDeviceChange(cb: (input: string, output: string) => void): void {
		// `useDevice` installs this before register(). Store it until the SDK Device is
		// constructed, then emit immediately as well as on subsequent hardware changes.
		this.deviceChangeCb = cb;
		this.emitDeviceSelection();
	}

	private readonly emitDeviceSelection = (): void => {
		if (!this.device || !this.deviceChangeCb) return;
		const input = this.device.audio?.inputDevice?.deviceId ?? 'default';
		const output =
			Array.from(this.device.audio?.speakerDevices.get() ?? [])[0]?.deviceId ??
			'default';
		this.deviceChangeCb(input, output);
	};
}

/** One Twilio Client leg behind the carrier-neutral interface. */
class TwilioLeg implements IncomingLeg {
	readonly legId: string;
	readonly from: string | null;
	readonly params: Record<string, string>;

	constructor(private readonly call: Call) {
		this.legId = call.parameters.CallSid || '';
		this.from = call.parameters.From || null;
		this.params = normalizeTwilioParameters(call.customParameters);
	}

	accept(): void {
		this.call.accept();
	}

	reject(): void {
		this.call.reject();
	}

	ignore(): void {
		this.call.ignore();
	}

	disconnect(): void {
		this.call.disconnect();
	}

	mute(muted: boolean): void {
		this.call.mute(muted);
	}

	isMuted(): boolean {
		return this.call.isMuted();
	}

	on(event: LegEvent, cb: (payload?: unknown) => void): void {
		this.call.on(event, cb);
	}

	/** Twilio publishes a WebRTC quality sample every second during a call. Its RTT is
	 *  the closest possible browser-side ping to the actual media path. */
	onRtt(cb: (ms: number | null) => void): void {
		this.call.on('sample', (sample: RTCSample) => {
			cb(Number.isFinite(sample.rtt) ? Math.max(0, Math.round(sample.rtt)) : null);
		});
	}
}
