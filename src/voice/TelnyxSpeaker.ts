/** Watch the selected output without changing devices or touching a live call. */
export class TelnyxSpeaker {
	private blocked = false;
	private stopped = false;
	private revision = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly devices = navigator.mediaDevices;

	constructor(
		private readonly getSinkId: () => string | null,
		private readonly changed: (available: boolean) => void
	) {}

	start(): void {
		this.devices?.addEventListener?.('devicechange', this.deviceChanged);
		this.select();
	}

	/** Called only after output routing succeeds, including explicit reselection. */
	select(): void {
		this.cancelScan();
		this.blocked = false;
		// A rebuilt transport may replace an earlier blocked monitor.
		this.changed(true);
		void this.scan(this.revision);
	}

	async assertAvailable(deviceId: string): Promise<void> {
		if (!this.devices?.enumerateDevices || isAlias(deviceId)) return;
		const outputs = (await this.devices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
		if (usable(outputs) && !outputs.some(d => d.deviceId === deviceId)) {
			throw new Error('Your selected speaker is unavailable. Reconnect it or choose another speaker.');
		}
	}

	stop(): void {
		this.stopped = true;
		this.cancelScan();
		this.devices?.removeEventListener?.('devicechange', this.deviceChanged);
	}

	private cancelScan(): void {
		this.revision++;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	private deviceChanged = (): void => {
		this.cancelScan();
		const revision = this.revision;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.scan(revision);
		}, 2000);
	};

	private setBlocked(blocked: boolean): void {
		if (this.blocked === blocked) return;
		this.blocked = blocked;
		this.changed(!blocked);
	}

	private async scan(revision: number): Promise<void> {
		const current = () => !this.stopped && this.revision === revision;
		if (!current() || !this.devices?.enumerateDevices) return;
		try {
			const outputs = (await this.devices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
			if (!current()) return;
			// An empty/redacted list is not proof of a disconnected speaker.
			if (!usable(outputs)) return;
			// Read the actual element route, not a saved preference or the device that
			// used to back System Default. The OS/SDK may already have recovered.
			const sinkId = this.getSinkId();
			if (sinkId === null) return; // Output routing is not observable here.
			if (isAlias(sinkId)) {
				// Default routes follow the OS. An old physical device disappearing
				// does not prove the current default is silent.
				this.setBlocked(false);
				return;
			}
			// Observe only. Reappearing sinks resume through the browser; rerouting
			// here could race with the agent choosing a different working speaker.
			this.setBlocked(!outputs.some(d => d.deviceId === sinkId));
		} catch {
			// Enumeration failures are inconclusive.
		}
	}
}

const isAlias = (id: string) => !id || id === 'default' || id === 'communications';
const usable = (outputs: MediaDeviceInfo[]) =>
	outputs.some(d => !isAlias(d.deviceId)) && outputs.every(d => d.deviceId && d.label);
