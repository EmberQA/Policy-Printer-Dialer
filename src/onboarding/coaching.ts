import type {CoachingStatus} from '@/lib/api';

export const DAY_MS = 86_400_000;
export const CALENDLY_URL = 'https://calendly.com/chrispolicyprinter/30min';

export function coachingRequired(status: CoachingStatus | null, now: number): boolean {
	if (!status?.purchased_at) return false;
	const age = now - Date.parse(status.purchased_at);
	return Number.isFinite(age) && age >= 0 && age <= 14 * DAY_MS &&
		(age >= 5 * DAY_MS || status.answered_calls >= 15);
}

export const bookingCookieName = (orgId: string, userId: string) =>
	`pp_coaching_booked_${encodeURIComponent(orgId)}_${encodeURIComponent(userId)}`;

export const hasBookingCookie = (cookies: string, key: string) =>
	cookies.split(';').some((entry) => entry.trim() === `${key}=1`);

export const bookingCookie = (key: string, secure: boolean) =>
	`${key}=1; Max-Age=31536000; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;

/** Only a completion from this widget may dismiss the required dialog. */
export function isBookingConfirmation(
	event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
	frameWindow: Window | null | undefined
): boolean {
	return Boolean(frameWindow) && event.source === frameWindow &&
		event.origin === 'https://calendly.com' &&
		event.data?.event === 'calendly.event_scheduled';
}
