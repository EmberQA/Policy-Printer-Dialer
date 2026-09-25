import type {DialerPresence} from '@/lib/api';

/**
 * Allow normal registration and heartbeat transitions to settle before telling an
 * agent to restart their session. At the current five-second heartbeat cadence this
 * requires twelve consecutive unavailable responses.
 */
export const READY_UNAVAILABLE_ALERT_DELAY_MS = 60_000;

export interface ReadyUnavailableState {
	available: 0 | 1 | null;
	connected: boolean;
	onCall: boolean;
	presence: Pick<DialerPresence, 'status'> | null;
}

/** Matches the two statuses the agent can see: Ready and Unavailable. */
export function isReadyUnavailable({
	available,
	connected,
	onCall,
	presence
}: ReadyUnavailableState): boolean {
	return (
		connected &&
		available === 0 &&
		presence?.status === 'ready' &&
		!onCall
	);
}

/**
 * Tracks one continuous Ready + Unavailable interval. Recovering, pausing, or
 * entering a call clears the warning and a future interval must earn the full delay.
 */
export function createReadyUnavailableAlertTimer(
	onVisibilityChange: (visible: boolean) => void,
	delayMs = READY_UNAVAILABLE_ALERT_DELAY_MS
) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let visible = false;

	const clearPendingTimer = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};

	return {
		update(active: boolean) {
			if (!active) {
				clearPendingTimer();
				if (visible) {
					visible = false;
					onVisibilityChange(false);
				}
				return;
			}

			if (visible || timer !== null) return;
			timer = setTimeout(() => {
				timer = null;
				visible = true;
				onVisibilityChange(true);
			}, delayMs);
		},
		dispose() {
			clearPendingTimer();
		}
	};
}
