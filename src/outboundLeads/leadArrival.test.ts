import {afterEach, describe, expect, it, vi} from 'vitest';
import {
	createLeadNoticeSession,
	publishLeadArrival,
	subscribeLeadArrivals,
	type LeadArrival
} from './leadArrival';
const arrival = (id: string): LeadArrival => ({
	lead: {
		id,
		first_name: 'Jane',
		last_name: 'Doe',
		state: 'us-tx',
		coverage_type: 'final_expense',
		assigned_at: '2026-09-14T12:00:00Z'
	},
	count: 1
});
afterEach(() => vi.useRealTimers());
describe('lead arrival popup and chime', () => {
	it('table acknowledgement and repeated polls cannot replay the sound or shorten the popup', () => {
		vi.useFakeTimers();
		const notice = vi.fn(),
			sound = vi.fn();
		const session = createLeadNoticeSession(notice, sound);
		const unsubscribe = subscribeLeadArrivals(session.receive);
		publishLeadArrival(arrival('a')); // table publishes before acknowledging
		session.receive(arrival('a')); // pending poll reports the same delivery
		expect(sound).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(9_999);
		expect(notice).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		expect(notice).toHaveBeenLastCalledWith(null);
		session.receive(arrival('a'));
		expect(sound).toHaveBeenCalledTimes(1);
		session.receive(arrival('b'));
		expect(sound).toHaveBeenCalledTimes(2);
		unsubscribe();
		session.dispose();
	});
	it('a second lead replaces the notice and gets a full ten seconds; disposal cancels the timer', () => {
		vi.useFakeTimers();
		const notice = vi.fn(),
			sound = vi.fn();
		const session = createLeadNoticeSession(notice, sound);
		session.receive(arrival('a'));
		vi.advanceTimersByTime(8_000);
		session.receive(arrival('b'));
		vi.advanceTimersByTime(3_000);
		expect(notice).toHaveBeenLastCalledWith(arrival('b'));
		session.dispose();
		vi.runAllTimers();
		expect(notice).toHaveBeenCalledTimes(2);
	});
});
