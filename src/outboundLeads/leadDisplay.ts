/**
 * Pure display helpers for purchased leads (ENG-234 Subplan 05).
 *
 * Status labels/tones are the ONE place the dialer spells them — the admin
 * panel in EmberQA keeps the same label set (the `OutboundLeadStatus` union is
 * the contract). Money, state and coverage formatting come from
 * `./leadOrderForm` so the table and the order cards never disagree.
 */

import type {
	LeadCoverageType,
	OutboundLead,
	OutboundLeadStatus,
	PendingLeadSummary,
	LicensedJurisdiction
} from '@/lib/api';
import {
	LEAD_COVERAGE_OPTIONS,
	formatDollars,
	stateLabel
} from './leadOrderForm';

export {formatDollars, stateLabel};

export const LEAD_STATUS_LABELS: Record<OutboundLeadStatus, string> = {
	new: 'New',
	attempted: 'Contact attempted',
	contacted: 'Contacted',
	no_answer: 'No answer',
	not_interested: 'Not interested',
	sold: 'Sold',
	refunded: 'Refunded'
};

/** Badge tone per status. `success`/`destructive`/`outline`/`secondary` are the
 *  Badge variants the dialer already ships. */
export type LeadStatusTone =
	'default' | 'secondary' | 'outline' | 'destructive';

export const leadStatusTone = (status: OutboundLeadStatus): LeadStatusTone => {
	switch (status) {
		case 'new':
			return 'default';
		case 'sold':
			return 'default';
		case 'refunded':
		case 'not_interested':
			return 'destructive';
		case 'attempted':
		case 'no_answer':
			return 'outline';
		case 'contacted':
			return 'secondary';
	}
};

export const leadStatusLabel = (status: OutboundLeadStatus): string =>
	LEAD_STATUS_LABELS[status] ?? status;

/** The filter dropdown: every status, in lifecycle order. */
export const LEAD_STATUS_FILTER_OPTIONS: Array<{
	value: OutboundLeadStatus;
	label: string;
}> = (
	[
		'new',
		'attempted',
		'contacted',
		'no_answer',
		'not_interested',
		'sold',
		'refunded'
	] as OutboundLeadStatus[]
).map((value) => ({value, label: LEAD_STATUS_LABELS[value]}));

export const coverageLabel = (coverage: LeadCoverageType): string =>
	LEAD_COVERAGE_OPTIONS.find((o) => o.value === coverage)?.label ?? coverage;

/** "Jane Doe" — the row's name column. */
export const leadFullName = (
	lead: Pick<OutboundLead, 'first_name' | 'last_name'>
): string => `${lead.first_name.trim()} ${lead.last_name.trim()}`.trim();

/** "Jane D. (TX)" — the banner / short form, matching the backend's wallet note. */
export const leadShortLabel = (
	lead: Pick<PendingLeadSummary, 'first_name' | 'last_name' | 'state'>,
	jurisdictions: LicensedJurisdiction[] = []
): string => {
	const first = lead.first_name.trim();
	const last = lead.last_name.trim();
	const initial = last ? ` ${last[0].toUpperCase()}.` : '';
	return `${first}${initial} (${stateLabel(lead.state, jurisdictions)})`.trim();
};

/** Received-at for the row: today → time only, else short date + time. */
export const formatReceived = (iso: string, now: Date = new Date()): string => {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	const sameDay =
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate();
	const time = d.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit'
	});
	return sameDay
		? `Today ${time}`
		: `${d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})} ${time}`;
};

export const formatDateTime = (iso: string | null): string => {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

/** A refunded lead is read-only and cannot be called. */
export const leadIsCallable = (lead: Pick<OutboundLead, 'status'>): boolean =>
	lead.status !== 'refunded';

/** "+12145550123" → "(214) 555-0123" for display; anything else passes through. */
export const formatLeadPhone = (phone: string): string => {
	const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
	return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
};

/** Optional dollars (coverage amount arrives as a plain number of dollars). */
export const formatCoverageAmount = (amount: number | null): string =>
	amount === null ? '—' : `$${amount.toLocaleString('en-US')}`;
