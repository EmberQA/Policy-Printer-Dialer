import {describe, expect, it} from 'vitest';
import {bookingCookie, bookingCookieName, coachingRequired, hasBookingCookie, isBookingConfirmation} from './coaching';

const status = {ai_sales: 0, server_time: '2026-09-01T12:00:00Z'};

describe('coaching eligibility', () => {
	it('starts at the fifth AI-confirmed sale', () => {
		for (const ai_sales of [0, 1, 4]) {
			expect(coachingRequired({...status, ai_sales})).toBe(false);
		}
		for (const ai_sales of [5, 6, 150]) {
			expect(coachingRequired({...status, ai_sales})).toBe(true);
		}
	});
	it('fails open while sales eligibility is missing or invalid', () => {
		expect(coachingRequired(null)).toBe(false);
		for (const ai_sales of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(coachingRequired({...status, ai_sales} as typeof status)).toBe(false);
		}
	});
});

describe('booking confirmation', () => {
	const frame = {} as Window;
	const event = {origin: 'https://calendly.com', source: frame, data: {event: 'calendly.event_scheduled'}};
	it('accepts only completion from the current Calendly iframe', () => {
		expect(isBookingConfirmation(event, frame)).toBe(true);
		expect(isBookingConfirmation({...event, origin: 'https://calendly.com.evil.test'}, frame)).toBe(false);
		expect(isBookingConfirmation({...event, source: {} as Window}, frame)).toBe(false);
		expect(isBookingConfirmation(event, null)).toBe(false);
		for (const data of [null, {}, {event: 'calendly.event_type_viewed'}, {event: 'calendly.date_and_time_selected'}]) {
			expect(isBookingConfirmation({...event, data}, frame)).toBe(false);
		}
	});
	it('keeps completion scoped to both organization and user', () => {
		const key = bookingCookieName('org1', 'user1');
		const cookies = `other=1; ${key}=1; last=2`;
		expect(hasBookingCookie(cookies, key)).toBe(true);
		expect(hasBookingCookie(cookies, bookingCookieName('org2', 'user1'))).toBe(false);
		expect(hasBookingCookie(cookies, bookingCookieName('org1', 'user2'))).toBe(false);
		expect(hasBookingCookie(`${key}=10`, key)).toBe(false);
		expect(hasBookingCookie('', key)).toBe(false);
		expect(bookingCookie(key, true)).toContain('Max-Age=31536000; Path=/; SameSite=Lax; Secure');
		expect(bookingCookie(key, false)).not.toContain('Secure');
	});
});
