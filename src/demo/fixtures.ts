import {
	DEMO_AGENT,
	DEMO_ORG_ID,
	assertDemoIdentity,
	type DemoIdentity
} from './scope';

import campaignCatalog from './campaigns.json';
// Synthetic balances only. Existing demo campaign IDs are retained for CRM labels;
// new catalog entries use reserved fixture IDs and are never provisioned.
export const campaigns = campaignCatalog.map((campaign, i) => ({
	...campaign,
	campaign_id: campaign.id,
	active: true,
	ready: i === 0,
	has_buyer: true,
	calls_remaining_status: 'available',
	calls_used: 8 + i,
	calls_allotted: 40,
	calls_remaining: 32 - i,
	daily_cap: 20,
	daily_used: 3,
	daily_remaining: 17,
	default_form_id: 'recording-form'
}));
export class RecordingStore {
	readonly identity: DemoIdentity;
	campaigns = structuredClone(campaigns);
	balance = 125000;
	subscription = {
		membership_id: 'recording-subscription',
		status: 'active',
		renewal_period_end: new Date(Date.now() + 25 * 86400000).toISOString(),
		cancel_at_period_end: false,
		manage_url: null,
		amount_cents: 15000,
		access_paused: false,
		pause_reason: null,
		recovery_action: null as string | null,
		quoter: null as null | Record<string, unknown>
	};
	orders: Record<string, unknown>[] = [];
	seats = 3;
	private idempotency = new Map<string, unknown>();
	constructor(identity: DemoIdentity = DEMO_AGENT) {
		assertDemoIdentity(identity);
		this.identity = Object.freeze({...identity});
	}
	request(path: string, body: Record<string, any> = {}): any {
		assertDemoIdentity(this.identity);
		for (const key of ['org_id', 'user_id', 'recipient_user_id', 'agent_id']) {
			const expected =
				key === 'org_id'
					? this.identity.org_id
					: key === 'agent_id'
						? this.identity.dialer_agent_id
						: this.identity.user_id;
			if (body[key] && body[key] !== expected)
				throw new Error('Cross-account recording request blocked');
		}
		switch (path) {
			case '/policyPrinter/admin/access':
				return {
					is_policy_printer_org: true,
					can_manage_wallet: false,
					can_manage_dialer: false,
					can_manage_call_metadata: false,
					can_replay_retreaver_calls: false
				};
			case '/policyPrinter/wallet/get':
				return {
					wallet_enabled: true,
					balance_cents: this.balance,
					effective_pricing: this.campaigns,
					topup_min_cents: 5000,
					self_purchase_enabled: true
				};
			case '/policyPrinter/wallet/campaignRemainingCalls':
				return {
					wallet_enabled: true,
					campaigns: structuredClone(this.campaigns)
				};
			case '/policyPrinter/wallet/orders':
				return {
					wallet_enabled: true,
					orders: this.orders,
					transitions: [],
					total: this.orders.length
				};
			case '/policyPrinter/dialer/subscription/get':
				return structuredClone(this.subscription);
			case '/policyPrinter/dialer/subscription/activity':
				return {};
			case '/policyPrinter/dialer/subscription/cancel':
				this.subscription.cancel_at_period_end = true;
				this.subscription.status = 'canceling';
				this.subscription.recovery_action = 'uncancel';
				return {cancel_at_period_end: true};
			case '/policyPrinter/dialer/subscription/reactivate':
				this.subscription.cancel_at_period_end = false;
				this.subscription.status = 'active';
				this.subscription.recovery_action = null;
				return {status: 'active'};
			case '/policyPrinter/dialer/quoter/preview':
				return {
					amount_today_cents: 2500,
					renewal_cents: 3000,
					next_renewal_at: this.subscription.renewal_period_end,
					card: {brand: 'visa', last4: '4242'}
				};
			case '/policyPrinter/dialer/quoter/add':
				this.subscription.quoter = {
					membership_id: 'recording-quoter',
					status: 'active',
					cancel_at_period_end: false,
					renewal_period_end: this.subscription.renewal_period_end,
					amount_cents: 3000,
					access: true
				};
				return {status: 'active'};
			case '/policyPrinter/dialer/quoter/remove':
				if (this.subscription.quoter) {
					this.subscription.quoter.cancel_at_period_end = true;
					this.subscription.quoter.status = 'canceling';
				}
				return {ends_at: this.subscription.renewal_period_end};
			case '/policyPrinter/dialer/quoter/keep':
				if (this.subscription.quoter) {
					this.subscription.quoter.cancel_at_period_end = false;
					this.subscription.quoter.status = 'active';
				}
				return {};
			case '/policyPrinter/wallet/purchase': {
				const c = this.campaigns.find((c) => c.slug === body.call_type);
				if (
					!c ||
					!Number.isSafeInteger(body.quantity) ||
					body.quantity < 1 ||
					!body.idempotency_key
				)
					throw new Error('Invalid synthetic purchase');
				const key = String(body.idempotency_key);
				if (this.idempotency.has(key))
					return structuredClone(this.idempotency.get(key));
				const total = c.unit_price_cents * body.quantity;
				if (total > this.balance) throw new Error('Insufficient demo balance');
				this.balance -= total;
				c.calls_allotted += body.quantity;
				c.calls_remaining += body.quantity;
				const order = {
					id: `recording-order-${this.orders.length + 1}`,
					org_id: DEMO_ORG_ID,
					user_id: this.identity.user_id,
					recipient_user_id: this.identity.user_id,
					call_type: c.slug,
					quantity: body.quantity,
					unit_price_cents: c.unit_price_cents,
					total_cents: total,
					status: 'completed',
					created_at: new Date().toISOString()
				};
				this.orders.unshift(order);
				const result = {order, balance_cents: this.balance};
				this.idempotency.set(key, structuredClone(result));
				return result;
			}
			case '/recording/seats/add':
				if (this.identity.role !== 'owner')
					throw new Error('Existing demo owner role required');
				if (
					!Number.isSafeInteger(body.count) ||
					body.count < 1 ||
					body.count > 10
				)
					throw new Error('Choose 1 to 10 demo seats');
				this.seats += body.count;
				return {seats: this.seats};
			default:
				throw new Error(`Unavailable in offline recording: ${path}`);
		}
	}
}
