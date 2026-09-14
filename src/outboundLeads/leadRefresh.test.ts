import {describe, it, expect} from 'vitest';
import type {OutboundLead} from '@/lib/api';
import {mergeRefreshedLeads, unseenDisplayedLeadIds} from './leadRefresh';
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
});
