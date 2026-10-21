import type {LeadDetailResponse} from '@/lib/api';
import {isoDateToUs} from '@/lib/dates';

type Lead = NonNullable<LeadDetailResponse['lead']>;

export function formatLeadValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—';
	if (
		Array.isArray(value) &&
		value.every((item) => item === null || typeof item !== 'object')
	) {
		return value.join(', ');
	}
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value === 'object') return JSON.stringify(value, null, 2);
	return isoDateToUs(String(value));
}

export function leadResponseFields(lead: Lead) {
	const schema = lead.form_schema_snapshot ?? [];
	// Direct vendor leads carry their answers without a campaign or form schema.
	const fields =
		!lead.campaign_id && schema.length === 0
			? Object.keys(lead.form_data ?? {}).map((key) => ({key, label: key}))
			: schema;
	return fields.map((field) => ({
		key: field.key,
		label: field.label || field.key,
		value: formatLeadValue(lead.form_data?.[field.key])
	}));
}

export function leadToText(detail: LeadDetailResponse | null): string {
	if (!detail?.lead) return '';
	const lead = detail.lead;
	const dateTime = (value: string) => {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
	};
	const lines = [
		`Name: ${lead.name || '—'}`,
		`Phone: ${lead.caller_phone || '—'}`,
		...(lead.campaign_id ? [`Campaign: ${detail.campaign_name || '—'}`] : []),
		...(lead.campaign_id || lead.disposition_label
			? [`Disposition: ${lead.disposition_label || '—'}`]
			: []),
		`Created: ${dateTime(lead.created_at)}`,
		`Last updated: ${dateTime(lead.updated_at)}`
	];
	for (const field of leadResponseFields(lead)) {
		lines.push(`${field.label}: ${field.value}`);
	}
	return lines.join('\n');
}
