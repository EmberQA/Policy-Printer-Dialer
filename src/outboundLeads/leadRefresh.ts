import type {DeliveredLead, PendingLeadSummary} from '@/lib/api';

/** Preserve the open editor if new arrivals move its row beyond this page. */
export function mergeRefreshedLeads<T extends {id: string}>(
	current: T[],
	incoming: T[],
	expandedId: string | null
): T[] {
	const editing = current.find((lead) => lead.id === expandedId);
	return editing && !incoming.some((lead) => lead.id === editing.id)
		? [...incoming, editing]
		: incoming;
}

/** Only the successfully rendered slice is eligible for acknowledgment. */
export function unseenDisplayedLeadIds(
	leads: {id: string; acknowledged_at: string | null}[],
	acknowledged: Set<string>
): string[] {
	return leads
		.filter((lead) => !lead.acknowledged_at && !acknowledged.has(lead.id))
		.map((lead) => lead.id);
}

/** Keep the two storage types separate even if their record IDs coincide. */
export function unseenDeliveredLeadIds(
	leads: DeliveredLead[],
	acknowledged: {purchased: Set<string>; direct: Set<string>}
): {purchased: string[]; direct: string[]} {
	return {
		purchased: unseenDisplayedLeadIds(
			leads.filter((lead) => lead.kind !== 'direct'),
			acknowledged.purchased
		),
		direct: unseenDisplayedLeadIds(
			leads.filter((lead) => lead.kind === 'direct'),
			acknowledged.direct
		)
	};
}

/** Publish the same summary as the pending poll before acknowledging the row. */
export function deliveredLeadSummary(lead: DeliveredLead): PendingLeadSummary {
	return {
		id: lead.id,
		first_name: lead.first_name,
		last_name: lead.last_name,
		state: lead.state ?? '',
		coverage_type: lead.kind === 'direct' ? null : lead.coverage_type,
		assigned_at: lead.assigned_at,
		...(lead.kind === 'direct' ? {kind: 'direct' as const} : {})
	};
}
