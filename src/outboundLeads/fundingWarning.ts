import type {LeadFundingStatus} from '@/lib/api';
import {formatDollars} from './leadOrderForm';

export function fundingWarning(
	funding: LeadFundingStatus | null
): string | null {
	if (!funding?.blocked_orders.length) return null;
	const blocked = funding.blocked_orders.length;
	const prices = [
		...new Set(funding.blocked_orders.map((order) => order.unit_price_cents))
	].sort((a, b) => a - b);
	const shortfall = Math.max(...prices) - funding.balance_cents;
	return (
		`Wallet balance ${formatDollars(funding.balance_cents)}: ${blocked} of ${funding.active_order_count} active lead orders need funds. ` +
		`Their saved prices are ${prices.map(formatDollars).join(', ')} per lead. ` +
		`Add at least ${formatDollars(shortfall)} to meet every order’s per-lead price. ` +
		(blocked < funding.active_order_count
			? 'Your other orders can still receive leads when eligible.'
			: 'Lead delivery is waiting for funds.')
	);
}
