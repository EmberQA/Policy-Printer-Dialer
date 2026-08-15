import {type DialerCampaign} from '@/lib/api';

/**
 * How many calls this campaign can still send the agent, resolved from the two
 * independent Retreaver ceilings on the (agent, campaign) buyer:
 *   - the Hard cap  — the purchased allowance, spends down until topped up.
 *   - the Daily cap — a per-day ceiling Retreaver resets nightly. Optional: auto-
 *     provisioned buyers get one, and it is cleared for good after a sale.
 *
 * Whichever is tighter is what the agent actually gets, so `remaining` is the min of
 * the two. `dailyCap` is non-null only when a daily cap exists — the only case where
 * the UI renders an "x of y" denominator.
 */
export type CampaignAllowance =
	| {state: 'loading'}
	| {state: 'unavailable'}
	| {state: 'available'; remaining: number; dailyCap: number | null};

export function resolveCampaignAllowance(
	campaign: Pick<DialerCampaign, 'calls_remaining' | 'daily_cap' | 'daily_remaining'>
): CampaignAllowance {
	const hardRemaining = campaign.calls_remaining;
	if (hardRemaining === undefined) return {state: 'loading'};
	if (hardRemaining === null) return {state: 'unavailable'};

	const dailyCap = campaign.daily_cap ?? null;
	const dailyRemaining = campaign.daily_remaining ?? null;
	if (dailyCap === null || dailyRemaining === null) {
		return {state: 'available', remaining: hardRemaining, dailyCap: null};
	}

	return {
		state: 'available',
		remaining: Math.min(hardRemaining, dailyRemaining),
		dailyCap
	};
}

/** "5 of 6" when a daily cap applies, otherwise just "5". */
export function formatAllowanceCount(
	remaining: number,
	dailyCap: number | null
): string {
	return dailyCap === null
		? remaining.toLocaleString()
		: `${remaining.toLocaleString()} of ${dailyCap.toLocaleString()}`;
}
