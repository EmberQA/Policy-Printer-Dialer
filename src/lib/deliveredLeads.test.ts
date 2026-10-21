import {afterEach, describe, expect, it, vi} from 'vitest';
import {api, listDeliveredLeads, listPurchasedLeads} from './api';

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
	it('leaves existing purchased-only callers and status filters unchanged', async () => {
		const post = vi.spyOn(api, 'post').mockResolvedValue({data: {statusCode: 'SP100', data: {leads: []}}});
		await listPurchasedLeads({page: 1, limit: 25, status: 'contacted'});
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/outboundLeads/list',
			{page: 1, limit: 25, status: 'contacted'}, undefined);
		await listDeliveredLeads({page: 1, limit: 25, status: 'contacted'});
		expect(post).toHaveBeenLastCalledWith('/qualityscore/policyPrinter/outboundLeads/list',
			{page: 1, limit: 25, status: 'contacted', include_direct: true}, undefined);
	});
});
