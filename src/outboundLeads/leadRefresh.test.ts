import {describe, it, expect} from 'vitest';
import type {DirectDeliveredLead, OutboundLead} from '@/lib/api';
import {
	deliveredLeadSummary,
	mergeRefreshedLeads,
	unseenDeliveredLeadIds,
	unseenDisplayedLeadIds
} from './leadRefresh';
const lead = (id: string, acknowledged_at: string | null = null) =>
	({id, acknowledged_at}) as OutboundLead;
describe('live lead refresh and acknowledgment', () => {
	it('leaves 15 of 40 pending leads unseen after displaying page one', () => {
		const pending = Array.from({length: 40}, (_, i) => lead(String(i)));
		const acknowledged = new Set(
			unseenDisplayedLeadIds(pending.slice(0, 25), new Set())
		);
		expect(acknowledged.size).toBe(25);
		expect(unseenDisplayedLeadIds(pending.slice(25), acknowledged)).toEqual(
			pending.slice(25).map((l) => l.id)
		);
	});
	it('only acknowledges unseen leads from the displayed filter', () => {
		expect(
			unseenDisplayedLeadIds(
				[lead('shown'), lead('seen', '2026-09-11'), lead('just-acked')],
				new Set(['just-acked'])
			)
		).toEqual(['shown']);
	});
	it('shows arrivals and retains the open editor when pushed off the page', () => {
		const previous = Array.from({length: 25}, (_, i) => lead(String(i)));
		const next = [lead('new'), ...previous.slice(0, 24)];
		const refreshed = mergeRefreshedLeads(previous, next, '24');
		expect(refreshed[0].id).toBe('new');
		expect(refreshed.at(-1)).toBe(previous[24]);
		expect(mergeRefreshedLeads(refreshed, next, null)).toEqual(next);
	});
	it('does not duplicate an editor that remains in the fetched page', () => {
		const next = [lead('new'), lead('editing')];
		expect(mergeRefreshedLeads([lead('editing')], next, 'editing')).toEqual(
			next
		);
	});

	it('acknowledges only visible rows through their own storage type', () => {
		const direct = (id: string, acknowledged_at: string | null = null) =>
			({kind: 'direct', id, acknowledged_at}) as DirectDeliveredLead;
		const shown = [lead('same-id'), direct('same-id'), direct('already-seen', '2026-10-21'), direct('just-acked')];
		expect(unseenDeliveredLeadIds(shown, {
			purchased: new Set(['same-id']),
			direct: new Set(['just-acked'])
		})).toEqual({purchased: [], direct: ['same-id']});
		const paged = Array.from({length: 40}, (_, i) => i % 2 ? direct(String(i)) : lead(String(i)));
		const firstPage = unseenDeliveredLeadIds(paged.slice(0, 25), {purchased: new Set(), direct: new Set()});
		expect(firstPage.purchased.length + firstPage.direct.length).toBe(25);
		expect([...firstPage.purchased, ...firstPage.direct]).not.toContain('25');
	});

	it('publishes a direct arrival with CRM routing and a safe empty state', () => {
		const direct: DirectDeliveredLead = {
			kind: 'direct', id: 'crm-lead', first_name: 'Jane Doe', last_name: '',
			phone: '+12025550123', state: null, coverage_type: null,
			assigned_at: '2026-10-21T17:00:00Z', acknowledged_at: null,
			disposition_label: null, vendor_name: 'Direct vendor', age: null,
			status: 'new', agent_note: null, call_count: 0, first_called_at: null,
			last_called_at: null, updated_at: '2026-10-21T17:00:00Z', form_data: {}
		};
		expect(deliveredLeadSummary(direct)).toEqual({
			id: 'crm-lead', kind: 'direct', first_name: 'Jane Doe', last_name: '',
			state: '', coverage_type: null, assigned_at: direct.assigned_at
		});
	});
});
