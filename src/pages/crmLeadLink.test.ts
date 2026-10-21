import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {LeadDetailResponse} from '@/lib/api';

const mocks = vi.hoisted(() => ({acknowledge: vi.fn(), refresh: vi.fn()}));
vi.mock('@/lib/api', () => ({acknowledgeDirectLeads: mocks.acknowledge}));
vi.mock('@/outboundLeads/useNewLeadPoll', () => ({
	requestNewLeadRefresh: mocks.refresh
}));

import {
	acknowledgeViewedCrmLead,
	crmLeadIdFromSearch,
	crmLeadSearch
} from './crmLeadLink';

const leadId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const detail = {
	statusCode: 'SP100',
	statusMessage: 'Success',
	lead: {id: leadId}
} as LeadDetailResponse;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.acknowledge.mockResolvedValue({statusCode: 'SP100', acknowledged: 1});
});

describe('CRM lead links', () => {
	it('selects the requested record and changes records on the same route', () => {
		const params = new URLSearchParams({lead_id: leadId, filter: 'saved'});
		expect(crmLeadIdFromSearch(params)).toBe(leadId);
		const changed = crmLeadSearch(params, otherId);
		expect(crmLeadIdFromSearch(changed)).toBe(otherId);
		expect(changed.get('filter')).toBe('saved');
	});

	it('removes the selection on close and permits reopening the same lead', () => {
		const params = new URLSearchParams({lead_id: leadId, filter: 'saved'});
		const closed = crmLeadSearch(params, null);
		expect(crmLeadIdFromSearch(closed)).toBeNull();
		expect(closed.toString()).toBe('filter=saved');
		expect(params.get('lead_id')).toBe(leadId);
		expect(crmLeadIdFromSearch(crmLeadSearch(closed, leadId))).toBe(leadId);
	});

	it.each(['', 'bad-id', 'undefined', '../dial'])('ignores invalid lead IDs: %s', (id) => {
		expect(crmLeadIdFromSearch(new URLSearchParams({lead_id: id}))).toBeNull();
	});
});

describe('viewed CRM lead acknowledgement', () => {
	it('acknowledges only the successfully displayed record and refreshes pending leads', async () => {
		await acknowledgeViewedCrmLead(leadId, detail);
		expect(mocks.acknowledge).toHaveBeenCalledExactlyOnceWith([leadId]);
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});

	it('does not acknowledge a failed, missing, or stale detail response', async () => {
		await acknowledgeViewedCrmLead(leadId, {...detail, statusCode: 'SP400'});
		await acknowledgeViewedCrmLead(leadId, {...detail, lead: undefined});
		await acknowledgeViewedCrmLead(otherId, detail);
		expect(mocks.acknowledge).not.toHaveBeenCalled();
		expect(mocks.refresh).not.toHaveBeenCalled();
	});

	it('allows ordinary CRM records to return a harmless no-op', async () => {
		mocks.acknowledge.mockResolvedValue({statusCode: 'SP100', acknowledged: 0});
		await acknowledgeViewedCrmLead(leadId, detail);
		expect(mocks.acknowledge).toHaveBeenCalledExactlyOnceWith([leadId]);
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});

	it('leaves pending notifications intact when acknowledgement fails', async () => {
		mocks.acknowledge.mockResolvedValue({statusCode: 'SP400'});
		await acknowledgeViewedCrmLead(leadId, detail);
		mocks.acknowledge.mockRejectedValue(new Error('Network unavailable'));
		await expect(acknowledgeViewedCrmLead(leadId, detail)).resolves.toBeUndefined();
		expect(mocks.refresh).not.toHaveBeenCalled();
	});
});
