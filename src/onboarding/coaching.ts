import type {CoachingStatus} from '@/lib/api';

export const CALENDLY_URL = 'https://calendly.com/chrispolicyprinter/30min';

export function coachingRequired(status: CoachingStatus | null): boolean {
	return typeof status?.ai_sales === 'number' &&
		Number.isFinite(status.ai_sales) && status.ai_sales >= 5;
}

export const bookingCookieName = (orgId: string, userId: string) =>
	`pp_five_sale_feedback_booked_${encodeURIComponent(orgId)}_${encodeURIComponent(userId)}`;

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
