import {afterEach, describe, expect, it, vi} from 'vitest';
import {api, listDeliveredLeads, listPurchasedLeads, setDeliveredLeadStatus, startOutboundCall} from './api';

afterEach(() => vi.restoreAllMocks());

describe('delivered lead list requests', () => {
	it('opts the Leads page into direct delivery pagination', async () => {
		const direct = {id: 'crm-id', kind: 'direct'};
		const post = vi.spyOn(api, 'post').mockResolvedValue({
			data: {statusCode: 'SP100', statusMessage: 'Success', data: {leads: [direct], total: 26, currentPage: 2}}
		});
		const result = await listDeliveredLeads({page: 2, limit: 25});
		expect(post).toHaveBeenCalledWith('/qualityscore/policyPrinter/outboundLeads/list',
			{page: 2, limit: 25, include_direct: true}, undefined);
		expect(result.leads).toEqual([direct]);
		expect(result.total).toBe(26);
	});
	it('leaves purchased-only callers unchanged and sends status filters for combined lists', async () => {
		const post = vi.spyOn(api, 'post').mockResolvedValue({data: {statusCode: 'SP100', data: {leads: []}}});
		await listPurchasedLeads({page: 1, limit: 25, status: 'contacted'});
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/outboundLeads/list',
			{page: 1, limit: 25, status: 'contacted'}, undefined);
		await listDeliveredLeads({page: 1, limit: 25, status: 'contacted'});
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/outboundLeads/list',
			{page: 1, limit: 25, status: 'contacted', include_direct: true}, undefined);
	});
	it('saves direct outcomes against the existing record with an explicit source', async () => {
		const direct = {id: 'crm-id', kind: 'direct', status: 'contacted', agent_note: 'Reached them'};
		const post = vi.spyOn(api, 'post').mockResolvedValue({data: {statusCode: 'SP100', data: {lead: direct}}});
		const result = await setDeliveredLeadStatus('crm-id', 'contacted', 'Reached them', 'direct');
		expect(result.lead).toEqual(direct);
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/outboundLeads/lead/setStatus',
			{lead_id: 'crm-id', status: 'contacted', note: 'Reached them', kind: 'direct'}, undefined);
		await setDeliveredLeadStatus('purchase-id', 'sold', '');
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/outboundLeads/lead/setStatus',
			{lead_id: 'purchase-id', status: 'sold', note: ''}, undefined);
	});
	it('tracks direct calls separately and preserves purchased and ordinary call payloads', async () => {
		const post = vi.spyOn(api, 'post').mockResolvedValue({data: {statusCode: 'SP100', data: {}}});
		await startOutboundCall('+12025550123', 'attempt-direct', null, 'crm-id');
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/dialer/call/start',
			{to: '+12025550123', attempt_id: 'attempt-direct', direct_lead_id: 'crm-id'}, expect.any(Object));
		await startOutboundCall('+12145550123', 'attempt-purchased', 'purchase-id');
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/dialer/call/start',
			{to: '+12145550123', attempt_id: 'attempt-purchased', outbound_lead_id: 'purchase-id'}, expect.any(Object));
		await startOutboundCall('+12025550123', 'ordinary');
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/dialer/call/start',
			{to: '+12025550123', attempt_id: 'ordinary'}, expect.any(Object));
	});
});
