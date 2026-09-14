import {describe, it, expect} from 'vitest';
import {fundingWarning} from './fundingWarning';
describe('order funding warning', () => {
	it('distinguishes an unaffordable $15 order from an affordable $10 order', () => {
		const text = fundingWarning({
			balance_cents: 1200,
			active_order_count: 2,
			blocked_orders: [{order_id: 'old', unit_price_cents: 1500}]
		});
		expect(text).toContain('1 of 2');
		expect(text).toContain('$15.00');
		expect(text).toContain('$3.00');
		expect(text).toContain('other orders can still receive');
	});
	it('distinguishes new bids from committed deliveries when every order needs funds', () => {
		const text = fundingWarning({
			balance_cents: 500,
			active_order_count: 1,
			blocked_orders: [{order_id: 'old', unit_price_cents: 1500}]
		});
		expect(text).toContain('New lead bids are waiting for funds');
	});
	it('clears when funded and stays silent without active orders', () => {
		expect(
			fundingWarning({
				balance_cents: 1500,
				active_order_count: 1,
				blocked_orders: []
			})
		).toBeNull();
		expect(
			fundingWarning({
				balance_cents: 0,
				active_order_count: 0,
				blocked_orders: []
			})
		).toBeNull();
		expect(fundingWarning(null)).toBeNull();
	});
});
