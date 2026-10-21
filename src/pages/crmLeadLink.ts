import {acknowledgeDirectLeads, type LeadDetailResponse} from '@/lib/api';
import {requestNewLeadRefresh} from '@/outboundLeads/useNewLeadPoll';

const LEAD_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crmLeadIdFromSearch(params: URLSearchParams): string | null {
	const id = params.get('lead_id');
	return id && LEAD_ID_PATTERN.test(id) ? id.toLowerCase() : null;
}

export function crmLeadSearch(
	params: URLSearchParams,
	leadId: string | null
): URLSearchParams {
	const next = new URLSearchParams(params);
	if (leadId) next.set('lead_id', leadId);
	else next.delete('lead_id');
	return next;
}

/** Called only for the record currently displayed, never for list results. */
export async function acknowledgeViewedCrmLead(
	leadId: string,
	detail: LeadDetailResponse
): Promise<void> {
	if (detail.statusCode !== 'SP100' || detail.lead?.id !== leadId) return;
	try {
		const result = await acknowledgeDirectLeads([leadId]);
		if (result.statusCode === 'SP100') requestNewLeadRefresh();
	} catch {
		// The record remains usable. A failed acknowledgement stays pending.
	}
}
