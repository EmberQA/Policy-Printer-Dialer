/**
 * ENG-201: poll the org-wide calls-per-state summary.
 *
 * Low frequency and idempotent, so this uses the plain `setInterval` shape that
 * ranking uses rather than the self-rescheduling backoff loop in useHeartbeat —
 * overlapping requests are harmless here and there is no beat to keep. Polls only
 * while the tab is visible, and refetches immediately on focus so an agent coming
 * back to the dialer never reads a stale board.
 */

import {useCallback, useEffect, useState} from 'react';
import {fetchHotStates, type HotStateCount} from '@/lib/api';

const HOT_STATES_POLL_MS = 10 * 60_000;

export function useHotStates() {
	const [states, setStates] = useState<HotStateCount[]>([]);
	const [windowHours, setWindowHours] = useState<number | null>(null);

	const refresh = useCallback(async () => {
		try {
			const response = await fetchHotStates();
			if (response.statusCode !== 'SP100') return;
			setStates(response.states ?? []);
			setWindowHours(response.window_hours ?? null);
		} catch {
			// Hot states are decoration, never a blocker on taking calls. Keep the last
			// successful value while the backend or network is temporarily unavailable.
		}
	}, []);

	useEffect(() => {
		void refresh();
		const interval = window.setInterval(() => {
			if (document.visibilityState === 'visible') void refresh();
		}, HOT_STATES_POLL_MS);
		const onFocus = () => void refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('focus', onFocus);
		};
	}, [refresh]);

	return {states, windowHours};
}
