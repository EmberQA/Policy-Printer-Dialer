import {useCallback, useEffect, useState} from 'react';
import {fetchCoachingStatus, type CoachingStatus} from '@/lib/api';
import {bookingCookie, bookingCookieName, coachingRequired, hasBookingCookie} from './coaching';

export function useCoachingBooking({orgId, userId, enabled, onCall}: {
	orgId: string;
	userId: string;
	enabled: boolean;
	onCall: boolean;
}) {
	const key = bookingCookieName(orgId, userId);
	// Local development exposes the dialog through the explicit preview button only.
	// Do not let real account history auto-open the gate or take the dialer offline.
	const eligibilityEnabled = enabled && !import.meta.env.DEV;
	const [bookedKey, setBookedKey] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<{key: string; status: CoachingStatus} | null>(null);
	let cookieBooked = false;
	try { cookieBooked = hasBookingCookie(document.cookie, key); } catch { /* in-memory fallback */ }
	const booked = bookedKey === key || cookieBooked;
	const current = snapshot?.key === key ? snapshot : null;

	useEffect(() => {
		if (!eligibilityEnabled || booked) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const response = await fetchCoachingStatus();
				if (cancelled) return;
				if (response.statusCode === 'SP100' && response.coaching) {
					setSnapshot({key, status: response.coaching});
				}
			} catch { /* Retry without blocking the dialer on an eligibility read failure. */ }
			if (!cancelled) timer = setTimeout(poll, 30_000);
		};
		void poll();
		return () => { cancelled = true; clearTimeout(timer); };
		// Re-check as a call/wrap-up ends, as well as on the slow poll.
	}, [eligibilityEnabled, booked, key, onCall]);

	const completeBooking = useCallback(() => {
		try { document.cookie = bookingCookie(key, location.protocol === 'https:'); } catch { /* retain for this session */ }
		setBookedKey(key);
	}, [key]);

	return {
		bookingRequired: eligibilityEnabled && !booked && coachingRequired(current?.status ?? null),
		completeBooking
	};
}
