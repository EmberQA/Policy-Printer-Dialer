import {describe, expect, it} from 'vitest';
import {getActivityPeriodBounds} from './activityPeriod';

describe('getActivityPeriodBounds', () => {
	it('uses local midnight to local midnight for a day', () => {
		const bounds = getActivityPeriodBounds(
			'day',
			new Date(2026, 6, 29, 15, 30)
		);
		const start = new Date(bounds.startedAt);
		const end = new Date(bounds.endedAt);

		expect(start.getHours()).toBe(0);
		expect(start.getDate()).toBe(29);
		expect(end.getHours()).toBe(0);
		expect(end.getDate()).toBe(30);
	});

	it('uses Monday through the following Monday for a week', () => {
		const bounds = getActivityPeriodBounds(
			'week',
			new Date(2026, 6, 29, 15, 30)
		);
		const start = new Date(bounds.startedAt);
		const end = new Date(bounds.endedAt);

		expect(start.getDay()).toBe(1);
		expect(start.getDate()).toBe(27);
		expect(end.getDay()).toBe(1);
		expect(end.getDate()).toBe(3);
	});

	it('uses the first of this month through the first of next month', () => {
		const bounds = getActivityPeriodBounds(
			'month',
			new Date(2026, 6, 29, 15, 30)
		);
		const start = new Date(bounds.startedAt);
		const end = new Date(bounds.endedAt);

		expect(start.getDate()).toBe(1);
		expect(start.getMonth()).toBe(6);
		expect(end.getDate()).toBe(1);
		expect(end.getMonth()).toBe(7);
	});
});
