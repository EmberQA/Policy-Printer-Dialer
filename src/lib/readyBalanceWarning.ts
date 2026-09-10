import type {CampaignRemainingCallsResponse} from './api';

/** Only confirmed empty balances warrant a warning; unavailable reads fail open. */
export function getReadyBalanceWarning(
 response: CampaignRemainingCallsResponse,
 selected: {id: string; name: string}[]
): string | null {
 if (response.statusCode !== 'SP100') return null;
 const warnings: string[] = [];
 for (const campaign of selected) {
  const balance = response.campaigns?.find((item) => item.campaign_id === campaign.id);
  if (!balance) continue;
  if (balance.calls_remaining_status === 'hard_cap_not_configured' ||
   (balance.calls_remaining_status === 'available' &&
    typeof balance.calls_remaining === 'number' &&
    Number.isFinite(balance.calls_remaining) && balance.calls_remaining <= 0)) {
   warnings.push(`${campaign.name}: no calls remaining. Purchase calls for this campaign to receive calls.`);
  } else if (balance.calls_remaining_status === 'available' &&
   balance.daily_cap !== null && typeof balance.daily_remaining === 'number' &&
   Number.isFinite(balance.daily_remaining) && balance.daily_remaining <= 0) {
   warnings.push(`${campaign.name}: daily call limit reached.`);
  }
 }
 return warnings.length ? warnings.join(' ') : null;
}
