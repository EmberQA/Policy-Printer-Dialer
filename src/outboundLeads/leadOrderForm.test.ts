import {describe, expect, it} from 'vitest';
import type {LeadPurchaseOrder} from '@/lib/api';
import {
	buildDefaultLeadOrderInput,
	describeWindow,
	diffStates,
	formatDollars,
	orderToInput,
	remainingSpendCents,
	stateLabel,
	validateLeadOrderInputClient
} from './leadOrderForm';

const order: LeadPurchaseOrder = {
	id: 'o1',
	org_id: 'org',
	agent_id: 'a',
	user_id: 'u',
	campaign_id: 'c',
	status: 'active',
	paused: false,
	working_hours_start: '20:00:00',
	working_hours_end: '02:00:00',
	timezone: 'America/Chicago',
	daily_cap: 5,
	max_cap: 20,
	states: ['us-tx', 'us-fl'],
	coverage_types: ['final_expense'],
	min_age: 50,
	max_age: null,
	unit_price_cents: 1500,
	delivered_count: 7,
	exhausted_at: null,
	cancelled_at: null,
	created_at: '',
	updated_at: ''
};

describe('lead order form defaults', () => {
	it('seeds a new order from the licensed states with both coverage types', () => {
		const input = buildDefaultLeadOrderInput({licensed_states: ['us-tx']});
		expect(input).toMatchObject({
			working_hours_start: '09:00',
			working_hours_end: '17:00',
			daily_cap: 5,
			max_cap: 20,
			states: ['us-tx'],
			coverage_types: ['final_expense', 'term_life'],
			min_age: null,
			max_age: null
		});
		expect(input.timezone.length).toBeGreaterThan(0);
	});

	it('turns a saved order into form input, trimming pg times to HH:MM', () => {
		expect(orderToInput(order)).toEqual({
			working_hours_start: '20:00',
			working_hours_end: '02:00',
			timezone: 'America/Chicago',
			daily_cap: 5,
			max_cap: 20,
			states: ['us-tx', 'us-fl'],
			coverage_types: ['final_expense'],
			min_age: 50,
			max_age: null
		});
	});
});

describe('client-side validation mirrors the backend', () => {
	const valid = orderToInput(order);

	it('accepts a valid form, including an overnight window', () => {
		expect(validateLeadOrderInputClient(valid)).toBeNull();
	});

	it.each([
		[{working_hours_start: '8am'}, 'Working hours must be HH:MM'],
		[{working_hours_end: '20:00'}, 'Working hours start and end must differ'],
		[{timezone: ' '}, 'Pick a timezone'],
		[{daily_cap: 0}, 'Daily cap must be a whole number between 1 and 100'],
		[{daily_cap: 2.5}, 'Daily cap must be a whole number between 1 and 100'],
		[{max_cap: 1001}, 'Max cap must be a whole number between 1 and 1000'],
		[{states: []}, 'Select at least one state'],
		[{coverage_types: []}, 'Select at least one coverage type'],
		[{min_age: 12.5}, 'Ages must be whole numbers'],
		[{max_age: 121}, 'Ages must be between 0 and 120'],
		[{min_age: 70, max_age: 60}, 'Minimum age cannot exceed maximum age']
	])('rejects %j', (patch, message) => {
		expect(validateLeadOrderInputClient({...valid, ...patch})).toBe(message);
	});
});

describe('display helpers', () => {
	it('describes an overnight window', () => {
		expect(describeWindow('20:00:00', '02:00:00', 'America/Chicago')).toBe(
			'8:00 PM – 2:00 AM (overnight) America/Chicago'
		);
		expect(describeWindow('09:00', '17:30', 'UTC')).toBe(
			'9:00 AM – 5:30 PM UTC'
		);
	});

	it('remaining spend uses the order price and what is left to deliver', () => {
		expect(remainingSpendCents(order)).toBe(13 * 1500);
		expect(remainingSpendCents({...order, delivered_count: 25})).toBe(0);
	});

	it('formats dollars', () => {
		expect(formatDollars(1500)).toBe('$15.00');
		expect(formatDollars(123456)).toBe('$1,234.56');
	});

	it('labels states through the catalogue with a fallback', () => {
		const catalogue = [{code: 'us-tx', abbr: 'TX', name: 'Texas'}];
		expect(stateLabel('us-tx', catalogue)).toBe('TX');
		expect(stateLabel('us-ga', catalogue)).toBe('GA');
	});

	it('diffs selections against saved/licensed states regardless of spelling', () => {
		expect(diffStates(['TX', 'ga'], ['us-tx', 'us-fl'])).toEqual({
			differs: true,
			selected_not_saved: ['us-ga'],
			saved_not_selected: ['us-fl']
		});
		expect(diffStates(['fl', 'tx'], ['us-tx', 'us-fl']).differs).toBe(false);
	});
});
