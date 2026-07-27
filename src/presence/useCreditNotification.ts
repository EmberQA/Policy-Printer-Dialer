/**
 * useCreditNotification — the dialer's credit-popup poll (DB load reduction, Step 1).
 *
 * Credit delivery used to ride the 5s heartbeat, which meant a pending-credit JSONB scan
 * over dialer_calls on EVERY beat. It now runs here on its own much slower timer, so that
 * scan happens ~6x less often. Same self-rescheduling-setTimeout shape as useHeartbeat:
 * the next poll is scheduled only AFTER the current one settles (structural in-flight
 * guard), with ±jitter so tabs de-correlate and exponential backoff on repeated failure.
 *
 * Returns the oldest unacknowledged credit notification (or null). Acknowledgement is
 * unchanged — the consumer calls acknowledgeCreditNotification and hides it locally.
 */

import {useEffect, useState} from 'react';
import {
	postCreditNotificationPending,
	type CreditNotification
} from '@/lib/api';

/** Deliberately slow — a credit popup is not time-critical to the second. */
const CREDIT_POLL_INTERVAL_MS = 30_000;
const CREDIT_POLL_MAX_BACKOFF_MS = 120_000;

export interface CreditNotificationState {
	creditNotification: CreditNotification | null;
}

export interface UseCreditNotificationOptions {
	/** Pause polling entirely (e.g. before a session exists). */
	enabled?: boolean;
}

export function useCreditNotification({
	enabled = true
}: UseCreditNotificationOptions = {}): CreditNotificationState {
	const [state, setState] = useState<CreditNotificationState>({
		creditNotification: null
	});

	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let failureStreak = 0;

		function scheduleNext() {
			if (cancelled) return;
			const base =
				failureStreak > 0
					? Math.min(
							CREDIT_POLL_INTERVAL_MS * 2 ** failureStreak,
							CREDIT_POLL_MAX_BACKOFF_MS
						)
					: CREDIT_POLL_INTERVAL_MS;
			const jitter = Math.floor(Math.random() * 4_000) - 2_000; // [-2s, +2s)
			timer = setTimeout(poll, Math.max(5_000, base + jitter));
		}

		async function poll() {
			try {
				const res = await postCreditNotificationPending();
				if (cancelled) return;
				failureStreak = 0;
				setState({creditNotification: res.credit_notification ?? null});
			} catch {
				if (cancelled) return;
				// Keep the last known value on a transient failure; just back off.
				failureStreak += 1;
			} finally {
				scheduleNext();
			}
		}

		void poll(); // immediate poll so a pending credit shows soon after mount

		return () => {
			cancelled = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		};
	}, [enabled]);

	return state;
}
