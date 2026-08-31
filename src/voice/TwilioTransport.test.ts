import {beforeEach, describe, expect, it, vi} from 'vitest';

const sdk = vi.hoisted(() => {
	type Listener = (...args: unknown[]) => void;

	class FakeAudio {
		inputDevice: {deviceId: string} | null = {deviceId: 'default'};
		selectedSpeakers = new Set([{deviceId: 'default'}]);
		speakerDevices = {get: () => this.selectedSpeakers};
		private listeners = new Map<string, Listener[]>();

		incoming = vi.fn();
		disconnect = vi.fn();

		on(event: string, cb: Listener): void {
			const listeners = this.listeners.get(event) ?? [];
			listeners.push(cb);
			this.listeners.set(event, listeners);
		}

		emit(event: string): void {
			for (const listener of this.listeners.get(event) ?? []) listener();
		}
	}

	class FakeDevice {
		static latest: FakeDevice | null = null;
		audio = new FakeAudio();
		private listeners = new Map<string, Listener[]>();

		constructor() {
			FakeDevice.latest = this;
		}

		on(event: string, cb: Listener): void {
			const listeners = this.listeners.get(event) ?? [];
			listeners.push(cb);
			this.listeners.set(event, listeners);
		}

		async register(): Promise<void> {
			// Bluetooth devices commonly resolve from `default` to their concrete ids
			// during SDK registration. This is the transition the regression dropped.
			this.audio.inputDevice = {deviceId: 'bluetooth-mic'};
			this.audio.selectedSpeakers = new Set([
				{deviceId: 'bluetooth-speaker'}
			]);
			this.audio.emit('deviceChange');
		}

		destroy(): void {}
	}

	return {FakeDevice};
});

vi.mock('@twilio/voice-sdk', () => ({
	Call: {Codec: {Opus: 'opus', PCMU: 'pcmu'}},
	Device: sdk.FakeDevice
}));

import {TwilioTransport} from './TwilioTransport';

describe('TwilioTransport device selection', () => {
	beforeEach(() => {
		sdk.FakeDevice.latest = null;
	});

	it('captures a Bluetooth device change that occurs during registration', async () => {
		const selections: Array<[string, string]> = [];
		const transport = new TwilioTransport({refreshToken: async () => 'fresh'});
		transport.onDeviceChange((input, output) => {
			selections.push([input, output]);
		});

		await transport.register('token');

		expect(selections).toContainEqual([
			'bluetooth-mic',
			'bluetooth-speaker'
		]);
	});

	it('immediately reports the current devices to a late subscriber', async () => {
		const transport = new TwilioTransport({refreshToken: async () => 'fresh'});
		await transport.register('token');

		const selection = vi.fn();
		transport.onDeviceChange(selection);

		expect(selection).toHaveBeenCalledWith(
			'bluetooth-mic',
			'bluetooth-speaker'
		);
	});

	it('disables Twilio sounds replaced by carrier-neutral local tones', async () => {
		const transport = new TwilioTransport({refreshToken: async () => 'fresh'});
		await transport.register('token');

		expect(sdk.FakeDevice.latest?.audio.incoming).toHaveBeenCalledWith(false);
		expect(sdk.FakeDevice.latest?.audio.disconnect).toHaveBeenCalledWith(false);
	});
});
