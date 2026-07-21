/**
 * useHeartbeat — the dialer's 5s presence heartbeat (Subplan 02).
 *
 * While enabled it POSTs /policyPrinter/dialer/heartbeat every
 * HEARTBEAT_INTERVAL_MS, which refreshes the agent's `last_heartbeat_at` so the
 * backend's `computeReady` keeps returning 1 (i.e. Retreaver keeps routing to
 * this buyer). It keeps beating even while the tab is BACKGROUNDED — the Twilio
 * Device stays registered and can still ring a hidden tab, so tab visibility is
 * the wrong proxy for "can take a call". Real availability is gated by the agent's
 * Ready toggle + `twilio_device_status: 'registered'` + `on_call`, not by focus.
 *
 * It returns the latest computed `available` (0|1) and the presence row the
 * backend echoes back, so the UI can mirror exactly what Retreaver sees. The
 * Twilio device status is reported as 'offline' until Subplan 03 wires the real
 * Device — which means `available` is correctly 0 until the softphone can
 * actually receive a call, even when the agent has toggled Ready.
 *
 * Multi-tab is intentionally last-writer-wins in V1: each tab heartbeats with its
 * own session id and overwrites `session_id`; both keep the agent fresh.
 */

import {useEffect, useRef, useState} from 'react';
import {
	postHeartbeat,
	type CreditNotification,
	type DialerPresence,
	type TwilioDeviceStatus
} from '@/lib/api';

const HEARTBEAT_INTERVAL_MS = 5_000;

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
	creditNotification: CreditNotification | null;
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
		creditNotification: null,
		connected: false
	});

	// Session id is stable for the life of this hook instance (this tab).
	const sessionIdRef = useRef<string>('');
	if (!sessionIdRef.current) sessionIdRef.current = newSessionId();

	// Keep the latest device status in a ref so the interval reads fresh values
	// without re-subscribing every time it changes.
	const deviceStatusRef = useRef<TwilioDeviceStatus>(deviceStatus);
	deviceStatusRef.current = deviceStatus;

	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		let timer: ReturnType<typeof setInterval> | null = null;

		const beat = async () => {
			try {
				const res = await postHeartbeat(
					sessionIdRef.current,
					deviceStatusRef.current
				);
				if (cancelled) return;
				setState({
					available: (res.available ?? 0) as 0 | 1,
					presence: res.presence ?? null,
					creditNotification: res.credit_notification ?? null,
					connected: true
				});
			} catch {
				if (cancelled) return;
				// A failed beat means we are not advertising availability right now.
				setState((prev) => ({...prev, available: 0, connected: false}));
			}
		};

		// Beat continuously while enabled — regardless of tab visibility. A
		// backgrounded tab keeps its Twilio Device registered and can still ring,
		// so it must keep advertising availability; focus is not a proxy for it.
		void beat(); // immediate beat so state is fresh on mount
		timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

		return () => {
			cancelled = true;
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		};
	}, [enabled]);

	return state;
}
