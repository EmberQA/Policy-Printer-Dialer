/** Watch the selected output without changing devices or touching a live call. */
export class TelnyxSpeaker {
	private deviceId = 'default';
	private physicalId: string | null = null;
	private blocked = false;
	private stopped = false;
	private revision = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly devices = navigator.mediaDevices;

	constructor(
		private readonly restore: (deviceId: string) => Promise<void>,
		private readonly changed: (available: boolean) => void
	) {}

	start(deviceId: string): void {
		this.devices?.addEventListener?.('devicechange', this.deviceChanged);
		this.select(deviceId);
	}

	/** Called only after output routing succeeds, including explicit reselection. */
	select(deviceId: string): void {
		this.deviceId = deviceId;
		this.physicalId = null;
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
			if (!isAlias(this.deviceId)) this.physicalId = this.deviceId;
			else if (!this.physicalId || (!this.blocked && outputs.some(d => d.deviceId === this.physicalId))) {
				// Follow an intentional OS default change while the previous output is
				// still present. Preserve its identity if it disappeared in this scan.
				const alias = outputs.find(d => d.deviceId === (this.deviceId || 'default'));
				const matches = outputs.filter(d => alias?.groupId && d.groupId === alias.groupId && !isAlias(d.deviceId));
				if (matches.length === 1) this.physicalId = matches[0].deviceId;
			}
			if (!this.physicalId) return;
			if (!outputs.some(d => d.deviceId === this.physicalId)) {
				this.setBlocked(true);
			} else if (this.blocked) {
				// A reappearing device alone does not prove the old element can use it.
				await this.restore(this.deviceId);
				if (current()) this.setBlocked(false);
			}
		} catch {
			// Enumeration failures are inconclusive; failed restoration stays blocked.
		}
	}
}

const isAlias = (id: string) => !id || id === 'default' || id === 'communications';
const usable = (outputs: MediaDeviceInfo[]) =>
	outputs.some(d => !isAlias(d.deviceId)) && outputs.every(d => d.deviceId && d.label);
