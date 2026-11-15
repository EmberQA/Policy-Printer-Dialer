import {describe, expect, it} from 'vitest';
import {campaignMenuAvailability} from './campaignAllowance';
import type {DialerCampaign} from './api';

const campaign = (
	remaining: number | null | undefined,
	extra: Partial<DialerCampaign> = {}
) =>
	({
		id: 'campaign',
		name: 'Social',
		ready: true,
		calls_remaining: remaining,
		calls_remaining_status: 'available',
		...extra
	}) as DialerCampaign;

describe('campaign menu balances', () => {
	it('only offers positive balances while preserving campaign identity and ready state', () => {
		const funded = campaign(3);
		expect(
			campaignMenuAvailability([
				campaign(0),
				funded,
				campaign(null),
				campaign(undefined)
			]).campaigns
		).toEqual([funded]);
	});
	it('directs empty and uninitialized accounts to the portal', () => {
		for (const campaigns of [
			[],
			[campaign(0)],
			[campaign(null, {calls_remaining_status: 'hard_cap_not_configured'})]
		]) {
			expect(campaignMenuAvailability(campaigns).emptyMessage).toContain(
				'Add calls from the portal'
			);
		}
	});
	it('distinguishes loading and failed reads from empty balances', () => {
		expect(
			campaignMenuAvailability([campaign(undefined)]).emptyMessage
		).toContain('Loading');
		expect(campaignMenuAvailability([campaign(null)]).emptyMessage).toContain(
			'unavailable'
		);
	});
	it('hides daily-exhausted campaigns without telling funded users to buy more calls', () => {
		const result = campaignMenuAvailability([
			campaign(10, {daily_cap: 6, daily_remaining: 0})
		]);
		expect(result.campaigns).toEqual([]);
		expect(result.emptyMessage).toContain('daily call limits');
		expect(
			campaignMenuAvailability([
				campaign(10, {daily_cap: 6, daily_remaining: 2})
			]).campaigns
		).toHaveLength(1);
	});
});
