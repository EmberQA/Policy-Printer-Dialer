import {describe, expect, it} from 'vitest';
import {bookingCookie, bookingCookieName, coachingRequired, DAY_MS, hasBookingCookie, isBookingConfirmation} from './coaching';

const purchase = Date.parse('2026-09-01T12:00:00Z');
const status = {purchased_at: new Date(purchase).toISOString(), answered_calls: 0, server_time: new Date(purchase).toISOString()};

describe('coaching eligibility', () => {
	it('starts at five full days, or the fifteenth answered call, whichever is first', () => {
		expect(coachingRequired(status, purchase + 5 * DAY_MS - 1)).toBe(false);
		expect(coachingRequired(status, purchase + 5 * DAY_MS)).toBe(true);
		expect(coachingRequired({...status, answered_calls: 14}, purchase + DAY_MS)).toBe(false);
		expect(coachingRequired({...status, answered_calls: 15}, purchase + DAY_MS)).toBe(true);
	});
	it('always expires after fourteen days even with no cookie and many calls', () => {
		expect(coachingRequired(status, purchase + 14 * DAY_MS)).toBe(true);
		expect(coachingRequired({...status, answered_calls: 150}, purchase + 14 * DAY_MS + 1)).toBe(false);
	});
	it('does not block accounts with missing, invalid, or future activation dates', () => {
		expect(coachingRequired(null, purchase)).toBe(false);
		for (const purchased_at of [null, 'invalid', new Date(purchase + DAY_MS).toISOString()]) {
			expect(coachingRequired({...status, purchased_at, answered_calls: 15}, purchase)).toBe(false);
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
