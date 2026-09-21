import {useCallback, useEffect, useState} from 'react';
import {fetchCoachingStatus, type CoachingStatus} from '@/lib/api';
import {bookingCookie, bookingCookieName, coachingRequired, DAY_MS, hasBookingCookie} from './coaching';

export function useCoachingBooking({orgId, userId, enabled, onCall}: {
	orgId: string;
	userId: string;
	enabled: boolean;
	onCall: boolean;
}) {
	const key = bookingCookieName(orgId, userId);
	const [bookedKey, setBookedKey] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<{
		key: string; status: CoachingStatus; offset: number;
	} | null>(null);
	const [now, setNow] = useState(Date.now);
	let cookieBooked = false;
	try { cookieBooked = hasBookingCookie(document.cookie, key); } catch { /* in-memory fallback */ }
	const booked = bookedKey === key || cookieBooked;
	const current = snapshot?.key === key ? snapshot : null;
	const serverNow = now + (current?.offset ?? 0);
	const expired = Boolean(current?.status.purchased_at &&
		serverNow - Date.parse(current.status.purchased_at) > 14 * DAY_MS);

	useEffect(() => {
		if (!enabled || booked || expired) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const response = await fetchCoachingStatus();
				if (cancelled) return;
				if (response.statusCode === 'SP100' && response.coaching) {
					const receivedAt = Date.now();
					const serverTime = Date.parse(response.coaching.server_time);
					if (Number.isFinite(serverTime)) {
						setSnapshot({key, status: response.coaching, offset: serverTime - receivedAt});
						setNow(receivedAt);
					}
				}
			} catch { /* Retry without blocking the dialer on an eligibility read failure. */ }
			if (!cancelled) timer = setTimeout(poll, 30_000);
		};
		void poll();
		return () => { cancelled = true; clearTimeout(timer); };
		// Re-check as a call/wrap-up ends, as well as on the slow poll.
	}, [enabled, booked, expired, key, onCall]);

	useEffect(() => {
		if (!enabled || booked || !current?.status.purchased_at || expired) return;
		const purchase = Date.parse(current.status.purchased_at);
		if (!Number.isFinite(purchase)) return;
		const nextBoundary = serverNow < purchase + 5 * DAY_MS
			? purchase + 5 * DAY_MS : purchase + 14 * DAY_MS + 1;
		const timer = setTimeout(() => setNow(Date.now()), Math.max(1, Math.min(30_000, nextBoundary - serverNow)));
		return () => clearTimeout(timer);
	}, [enabled, booked, current, expired, serverNow]);

	const completeBooking = useCallback(() => {
		try { document.cookie = bookingCookie(key, location.protocol === 'https:'); } catch { /* retain for this session */ }
		setBookedKey(key);
	}, [key]);

	return {
		bookingRequired: enabled && !booked && coachingRequired(current?.status ?? null, serverNow),
		completeBooking
	};
}
