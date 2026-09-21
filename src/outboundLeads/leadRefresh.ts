import type {OutboundLead} from '@/lib/api';

/** Preserve the open editor if new arrivals move its row beyond this page. */
export function mergeRefreshedLeads(
	current: OutboundLead[],
	incoming: OutboundLead[],
	expandedId: string | null
): OutboundLead[] {
	const editing = current.find((lead) => lead.id === expandedId);
	return editing && !incoming.some((lead) => lead.id === editing.id)
		? [...incoming, editing]
		: incoming;
}

/** Only the successfully rendered slice is eligible for acknowledgment. */
export function unseenDisplayedLeadIds(
	leads: OutboundLead[],
	acknowledged: Set<string>
): string[] {
	return leads
		.filter((lead) => !lead.acknowledged_at && !acknowledged.has(lead.id))
		.map((lead) => lead.id);
}
