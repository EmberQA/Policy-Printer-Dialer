/**
 * useHeartbeat — the dialer's presence heartbeat (Subplan 02).
 *
 * While enabled it POSTs /policyPrinter/dialer/heartbeat on a self-rescheduling timer,
 * which refreshes the agent's `last_heartbeat_at` so the backend's `computeReady` keeps
 * returning 1 (i.e. Retreaver keeps routing to this buyer). It keeps beating even while
 * the tab is BACKGROUNDED — the Twilio Device stays registered and can still ring a
 * hidden tab, so tab visibility is the wrong proxy for "can take a call". Real
 * availability is gated by the agent's Ready toggle + `twilio_device_status: 'registered'`
 * + `on_call`, not by focus.
 *
 * DB load reduction (Step 1): the loop is a recursive setTimeout, NOT setInterval, so the
 * next beat is scheduled only AFTER the current request settles — a structural in-flight
 * guard that makes overlapping heartbeats impossible even when the backend/network is
 * slow (exactly when the DB is already under pressure). Each delay carries ±jitter so many
 * tabs de-correlate instead of stampeding on the same tick, and consecutive failures back
 * off exponentially (then reset on the next success).
 *
 * It returns the latest computed `available` (0|1) and the presence row the backend echoes
 * back, so the UI can mirror exactly what Retreaver sees. Credit-notification delivery is
 * NOT part of the heartbeat anymore — it moved to a slower dedicated poll
 * (useCreditNotification) so the pending-credit JSONB scan runs far less often.
 *
 * Multi-tab is intentionally last-writer-wins in V1: each tab heartbeats with its own
 * session id and overwrites `session_id`; both keep the agent fresh.
 */

import {useEffect, useRef, useState} from 'react';
import {
	postHeartbeat,
	type DialerPresence,
	type TwilioDeviceStatus
} from '@/lib/api';

const HEARTBEAT_INTERVAL_MS = 5_000;
/** Cap for the exponential backoff applied after consecutive failed beats. */
const HEARTBEAT_MAX_BACKOFF_MS = 30_000;

/** Stable-per-tab session id (a backend `session_id` value). */
const newSessionId = (): string => {
	const c = globalThis.crypto;
	if (c && 'randomUUID' in c) return c.randomUUID();
	// Fallback for older browsers — uniqueness across tabs is all we need.
	return `s_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
};

export interface HeartbeatState {
	/** Numeric availability from the last heartbeat (what Retreaver would see). */
	available: 0 | 1 | null;
	presence: DialerPresence | null;
	/** True once at least one heartbeat round-tripped (UI can show "connected"). */
	connected: boolean;
}

export interface UseHeartbeatOptions {
	/** Pause heartbeating entirely (e.g. before a session exists). */
	enabled?: boolean;
	/** The Twilio device status to report. Defaults to 'offline' (pre-Subplan 03). */
	deviceStatus?: TwilioDeviceStatus;
}

export function useHeartbeat({
	enabled = true,
	deviceStatus = 'offline'
}: UseHeartbeatOptions = {}): HeartbeatState {
	const [state, setState] = useState<HeartbeatState>({
		available: null,
		presence: null,
		connected: false
	});

	// Session id is stable for the life of this hook instance (this tab).
	const sessionIdRef = useRef<string>('');
	if (!sessionIdRef.current) sessionIdRef.current = newSessionId();

	// Keep the latest device status in a ref so the loop reads fresh values
	// without re-subscribing every time it changes.
	const deviceStatusRef = useRef<TwilioDeviceStatus>(deviceStatus);
	deviceStatusRef.current = deviceStatus;

	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let failureStreak = 0;

		// Base interval + jitter, or exponential backoff while failing. Scheduled only
		// after a beat settles, so two beats can never be in flight at once.
		function scheduleNext() {
			if (cancelled) return;
			const base =
				failureStreak > 0
					? Math.min(
							HEARTBEAT_INTERVAL_MS * 2 ** failureStreak,
							HEARTBEAT_MAX_BACKOFF_MS
						)
					: HEARTBEAT_INTERVAL_MS;
			const jitter = Math.floor(Math.random() * 1000) - 500; // [-500, +500)
			timer = setTimeout(beat, Math.max(1_000, base + jitter));
		}

		async function beat() {
			try {
				const res = await postHeartbeat(
					sessionIdRef.current,
					deviceStatusRef.current
				);
				if (cancelled) return;
				failureStreak = 0;
				setState({
					available: (res.available ?? 0) as 0 | 1,
					presence: res.presence ?? null,
					connected: true
				});
			} catch {
				if (cancelled) return;
				// A failed beat means we are not advertising availability right now; back off.
				failureStreak += 1;
				setState((prev) => ({...prev, available: 0, connected: false}));
			} finally {
				scheduleNext();
			}
		}

		// Beat continuously while enabled — regardless of tab visibility. A backgrounded
		// tab keeps its Twilio Device registered and can still ring, so it must keep
		// advertising availability; focus is not a proxy for it.
		void beat(); // immediate beat so state is fresh on mount

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
