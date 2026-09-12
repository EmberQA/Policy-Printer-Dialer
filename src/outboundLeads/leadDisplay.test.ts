import {describe, expect, it} from 'vitest';
import {
	LEAD_STATUS_FILTER_OPTIONS,
	coverageLabel,
	formatCoverageAmount,
	formatLeadPhone,
	formatReceived,
	leadFullName,
	leadIsCallable,
	leadShortLabel,
	leadStatusLabel,
	leadStatusTone
} from './leadDisplay';

describe('leadDisplay', () => {
	it('labels every status and shows attempted as "Contact attempted"', () => {
		expect(leadStatusLabel('attempted')).toBe('Contact attempted');
		expect(leadStatusLabel('no_answer')).toBe('No answer');
		expect(LEAD_STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual([
			'new',
			'attempted',
			'contacted',
			'no_answer',
			'not_interested',
			'sold',
			'refunded'
		]);
		expect(leadStatusTone('refunded')).toBe('destructive');
		expect(leadStatusTone('new')).toBe('default');
	});

	it('short label matches the backend wallet note shape', () => {
		expect(
			leadShortLabel({first_name: 'Jane', last_name: 'Doe', state: 'us-tx'})
		).toBe('Jane D. (TX)');
		expect(
			leadShortLabel({first_name: ' Jane ', last_name: '', state: 'us-fl'}, [
				{code: 'us-fl', abbr: 'FL', name: 'Florida'}
			])
		).toBe('Jane (FL)');
		expect(leadFullName({first_name: 'Jane', last_name: 'Doe'})).toBe(
			'Jane Doe'
		);
	});

	it('coverage + phone + amount formatting', () => {
		expect(coverageLabel('term_life')).toBe('Term life');
		expect(formatLeadPhone('+12145550123')).toBe('(214) 555-0123');
		expect(formatLeadPhone('+442071234567')).toBe('+442071234567');
		expect(formatCoverageAmount(10000)).toBe('$10,000');
		expect(formatCoverageAmount(null)).toBe('—');
	});

	it('received-at collapses to a time on the same day', () => {
		const now = new Date(2026, 8, 11, 15, 0, 0);
		expect(
			formatReceived(new Date(2026, 8, 11, 9, 5, 0).toISOString(), now)
		).toMatch(/^Today 9:05/);
		expect(
			formatReceived(new Date(2026, 8, 10, 9, 5, 0).toISOString(), now)
		).toMatch(/^Sep 10 9:05/);
		expect(formatReceived('garbage', now)).toBe('—');
	});

	it('refunded leads are not callable', () => {
		expect(leadIsCallable({status: 'refunded'})).toBe(false);
		expect(leadIsCallable({status: 'sold'})).toBe(true);
	});
});
