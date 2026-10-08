import {useCallback, useEffect, useState} from 'react';
import {fetchCoachingStatus, saveCoachingBooking, type CoachingStatus} from '@/lib/api';
import {expiredBookingCookie, legacyBookingCookieName, coachingRequired, hasLegacyBookingCookie} from './coaching';

export function useCoachingBooking({orgId, userId, enabled, onCall}: {
	orgId: string;
	userId: string;
	enabled: boolean;
	onCall: boolean;
}) {
	const key = legacyBookingCookieName(orgId, userId);
	// Local development exposes the dialog through the explicit preview button only.
	// Do not let real account history auto-open the gate or take the dialer offline.
	const eligibilityEnabled = enabled && !import.meta.env.DEV;
	const [bookedKey, setBookedKey] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<{key: string; status: CoachingStatus | null} | null>(null);
	const booked = bookedKey === key;
	const current = snapshot?.key === key ? snapshot : null;

	const completeBooking = useCallback(async () => {
		const response = await saveCoachingBooking();
		if (response.statusCode !== 'SP100' || response.booking_complete !== true) {
			throw new Error('Failed to save booking completion');
		}
		setBookedKey(key);
		try { document.cookie = expiredBookingCookie(key); } catch { /* DB completion is saved. */ }
	}, [key]);

	useEffect(() => {
		if (!eligibilityEnabled || booked) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const response = await fetchCoachingStatus();
				if (cancelled) return;
				if (response.statusCode === 'SP100') {
					if (response.coaching?.booking_complete) {
						setBookedKey(key);
						try { document.cookie = expiredBookingCookie(key); } catch { /* optional cleanup */ }
					} else if (response.coaching) {
						let legacyBooked = false;
						try { legacyBooked = hasLegacyBookingCookie(document.cookie, key); } catch { /* no legacy cookie */ }
						if (legacyBooked) {
							// Do not ask an existing booker to book again if migration needs a retry.
							await completeBooking();
							return;
						}
					}
					setSnapshot({key, status: response.coaching ?? null});
				}
			} catch { /* Retry without blocking the dialer on an eligibility read failure. */ }
			if (!cancelled) timer = setTimeout(poll, 30_000);
		};
		void poll();
		return () => { cancelled = true; clearTimeout(timer); };
		// Re-check as a call/wrap-up ends, as well as on the slow poll.
	}, [eligibilityEnabled, booked, key, onCall, completeBooking]);

	return {
		bookingRequired: eligibilityEnabled && !booked && coachingRequired(current?.status ?? null),
		completeBooking
	};
}
