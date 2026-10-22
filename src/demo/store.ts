import {RecordingStore} from './fixtures';
import {
	DEMO_ORG_ID,
	assertDemoIdentity,
	assertSyntheticPhone
} from './scope';
// Exact published production form v6, read-only snapshot from 2026-10-22.
// Only the verified demo transport serves this schema; saves stay in memory.
import leadForm from './leadForm.json';
const now = () => new Date().toISOString();
const jurisdictions = [
	{code: 'us-fl', abbr: 'FL', name: 'Florida'},
	{code: 'us-tx', abbr: 'TX', name: 'Texas'},
	{code: 'us-oh', abbr: 'OH', name: 'Ohio'}
];
export class DialerRecordingStore extends RecordingStore {
	contacts: Array<{id: string; name: string; phone: string; state: string; status: string; note: string; premium: string; form_data: Record<string, any>; campaign_id: string; disposition_id: string}> = [];
	leadOrders: any[] = [];
	request(path: string, body: Record<string, any> = {}): any {
		assertDemoIdentity(this.identity);
		if (this.identity.role !== 'agent')
			throw new Error('Dialer recording requires verified demo agent');
		for (const key of ['org_id', 'user_id', 'agent_id'])
			if (
				body[key] &&
				body[key] !==
					(key === 'agent_id'
						? this.identity.dialer_agent_id
						: this.identity[key as keyof typeof this.identity])
			)
				throw new Error('Cross-account request blocked');
		const relative = path.replace(/^\/policyPrinter/, '');
		if (relative === '/dialer/campaigns/list')
			return {campaigns: this.campaigns};
		if (relative === '/dialer/campaigns/remainingCalls')
			return {campaigns: this.campaigns};
		if (relative === '/dialer/call/disposition') {
			assertSyntheticPhone(body.caller_phone);
			if (
				!this.campaigns.some((c) => c.id === body.campaign_id) ||
				!/^(debug-incoming-call-|recording-active-call)/.test(
					body.twilio_call_sid || ''
				)
			)
				throw new Error('Synthetic call required');
			return {call_id: body.twilio_call_sid};
		}
		if (relative === '/dialer/leadForm/get')
			return {
				form: {
					id: 'recording-form',
					org_id: DEMO_ORG_ID,
					version: leadForm.version,
					name: leadForm.name,
					status: 'published',
					schema: structuredClone(leadForm.schema)
				},
				dispositions: ['Callback', 'Sold', 'Contacted', 'New'].map(
					(label, i) => ({
						id: `recording-disposition-${label.toLowerCase()}`,
						label,
						disposition_key:
							label === 'Callback' ? 'call_back' : label.toLowerCase(),
						sort_order: i,
						active: true
					})
				)
			};
		if (relative === '/dialer/lead/update') {
			const p = this.contacts.find((p) => p.id === body.lead_id);
			if (!p) throw new Error('Unknown synthetic lead');
			if (body.form_data) p.form_data = {...p.form_data, ...body.form_data};
			if (body.name) p.name = body.name;
			if (body.disposition_id) {
				p.disposition_id = body.disposition_id;
				p.status = body.disposition_id
					.replace('recording-disposition-', '')
					.replace(/^./, (s: string) => s.toUpperCase());
			}
			return {lead_id: p.id};
		}
		if (relative === '/dialer/lead/save') {
			if (!this.campaigns.some((c) => c.id === body.campaign_id))
				throw new Error('Unknown synthetic campaign');
			const id = `00000000-0000-4000-8000-${String(201 + this.contacts.length).padStart(12, '0')}`;
			this.contacts.push({
				id,
				name:
					body.name ||
					[body.form_data?.first_name, body.form_data?.last_name]
						.filter(Boolean)
						.join(' ') ||
					'Demo Caller',
				phone: body.caller_phone || '+12025550105',
				state: body.form_data?.state || 'FL',
				status: 'Callback',
				note: body.form_data?.notes || '',
				premium: '',
				form_data: body.form_data || {},
				campaign_id: body.campaign_id,
				disposition_id: body.disposition_id || 'recording-disposition-callback'
			});
			return {lead_id: id};
		}
		if (relative === '/dialer/lead/returningCaller')
			return {lead: null, calls: [], match: null};
		if (
			relative === '/dialer/presence/set' ||
			relative === '/dialer/presence/onCall'
		)
			return {
				presence: {status: body.status || 'paused', on_call: false},
				available: 0
			};
		if (relative === '/dialer/campaigns/setReady') {
			const c = this.campaigns.find((c) => c.id === body.campaign_id);
			if (!c) throw new Error('Unknown synthetic campaign');
			c.ready = body.ready;
			return {campaigns: this.campaigns};
		}
		if (relative === '/outboundLeads/order/get')
			return {
				orders: this.leadOrders.map((order) => ({
					order,
					today_count: 0,
					state_mismatch: {
						differs: false,
						selected_not_saved: [],
						saved_not_selected: []
					}
				})),
				new_order_price_cents: 1200,
				balance_cents: this.balance,
				wallet_enabled: true,
				can_create_order: true,
				licensed_states: jurisdictions.map((j) => j.code),
				jurisdictions,
				sms_contact: {
					phone_number: '+12025550100',
					verified: true,
					code_expires_at: null
				}
			};
		if (relative === '/outboundLeads/order/create') {
			if (
				!Number.isInteger(body.daily_cap) ||
				body.daily_cap < 1 ||
				!Number.isInteger(body.max_cap) ||
				body.max_cap < body.daily_cap ||
				!body.states?.length ||
				body.states.some(
					(s: string) => !jurisdictions.some((j) => j.code === s)
				)
			)
				throw new Error('Invalid demo lead order');
			const order = {
				...body,
				id: `recording-lead-order-${this.leadOrders.length + 1}`,
				org_id: DEMO_ORG_ID,
				agent_id: this.identity.dialer_agent_id,
				status: 'active',
				paused: false,
				unit_price_cents: 1200,
				delivered_count: 0,
				created_at: now(),
				updated_at: now()
			};
			this.leadOrders.push(order);
			return {order};
		}
		if (
			[
				'/outboundLeads/order/setPaused',
				'/outboundLeads/order/cancel',
				'/outboundLeads/order/update'
			].includes(relative)
		) {
			const order = this.leadOrders.find((o) => o.id === body.order_id);
			if (!order) throw new Error('Unknown synthetic order');
			if (relative.endsWith('setPaused')) order.paused = body.paused;
			else if (relative.endsWith('cancel')) order.status = 'cancelled';
			else {
				for (const k of [
					'working_hours_start',
					'working_hours_end',
					'timezone',
					'daily_cap',
					'max_cap',
					'states',
					'coverage_types',
					'min_age',
					'max_age'
				])
					if (k in body) order[k] = body[k];
			}
			return {order};
		}
		if (relative === '/outboundLeads/acknowledge') return {acknowledged: 0};
		if (relative === '/outboundLeads/pending') return {leads: [], count: 0};
		return super.request(path, body);
	}
}
export const store = new DialerRecordingStore();
