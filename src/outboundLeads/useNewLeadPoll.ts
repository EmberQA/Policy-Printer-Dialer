/**
 * useNewLeadPoll — the dialer's new-lead poll (ENG-234 Subplan 05).
 *
 * Same self-rescheduling-setTimeout shape as `useCreditNotification`: the next
 * poll is scheduled only AFTER the current one settles, ±2s jitter so tabs
 * de-correlate, exponential backoff to 120s on repeated failure, and the timer
 * is parked while the tab is hidden (a hidden tab cannot show a banner). Hits
 * the pre-RBAC liveness route, which never answers with an error envelope.
 *
 * `refresh()` polls immediately — the Leads page calls `requestNewLeadRefresh`
 * after acknowledging so the banner clears without waiting for the next tick.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {fetchPendingPurchasedLeads, type PendingLeadSummary} from '@/lib/api';

export const NEW_LEAD_POLL_INTERVAL_MS = 30_000;
const NEW_LEAD_POLL_MAX_BACKOFF_MS = 120_000;

export interface NewLeadPollState {
	/** Total unacknowledged leads (not just the ones returned). */
	count: number;
	/** The newest pending lead, for the banner line. */
	latest: PendingLeadSummary | null;
	refresh: () => void;
}

/* A tiny module-level channel so any screen (the Leads page after it
 * acknowledges) can nudge the single mounted poll without prop drilling. */
const refreshListeners = new Set<() => void>();
export const requestNewLeadRefresh = (): void => {
	refreshListeners.forEach((fn) => fn());
};

export function useNewLeadPoll(enabled: boolean): NewLeadPollState {
	const [state, setState] = useState<{
		count: number;
		latest: PendingLeadSummary | null;
	}>({count: 0, latest: null});
	const pollRef = useRef<() => void>(() => undefined);

	useEffect(() => {
		if (!enabled) {
			setState({count: 0, latest: null});
			pollRef.current = () => undefined;
			return;
		}

		let cancelled = false;
		let inFlight = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let failureStreak = 0;

		function clearTimer() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		}

		function scheduleNext() {
			if (cancelled) return;
			clearTimer();
			if (document.hidden) return; // resumed by the visibility listener
			const base =
				failureStreak > 0
					? Math.min(
							NEW_LEAD_POLL_INTERVAL_MS * 2 ** failureStreak,
							NEW_LEAD_POLL_MAX_BACKOFF_MS
						)
					: NEW_LEAD_POLL_INTERVAL_MS;
			const jitter = Math.floor(Math.random() * 4_000) - 2_000; // [-2s, +2s)
			timer = setTimeout(poll, Math.max(5_000, base + jitter));
		}

		async function poll() {
			if (cancelled || inFlight) return;
			inFlight = true;
			clearTimer();
			try {
				const res = await fetchPendingPurchasedLeads();
				if (cancelled) return;
				failureStreak = 0;
				const leads = res.leads ?? [];
				setState({count: res.count ?? leads.length, latest: leads[0] ?? null});
			} catch {
				if (cancelled) return;
				// Keep the last known value on a transient failure; just back off.
				failureStreak += 1;
			} finally {
				inFlight = false;
				scheduleNext();
			}
		}

		function onVisibility() {
			if (!document.hidden) void poll();
			else clearTimer();
		}

		pollRef.current = () => void poll();
		refreshListeners.add(pollRef.current);
		document.addEventListener('visibilitychange', onVisibility);
		void poll(); // immediate poll so a lead that landed while away shows soon

		return () => {
			cancelled = true;
			clearTimer();
			refreshListeners.delete(pollRef.current);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [enabled]);

	const refresh = useCallback(() => pollRef.current(), []);

	return {count: state.count, latest: state.latest, refresh};
}
