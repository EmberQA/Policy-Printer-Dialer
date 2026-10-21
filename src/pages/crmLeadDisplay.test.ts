import {describe, expect, it} from 'vitest';
import type {LeadDetailResponse} from '@/lib/api';
import {leadResponseFields, leadToText} from './crmLeadDisplay';

const detail: LeadDetailResponse = {
	statusCode: 'SP100',
	statusMessage: 'Success',
	lead: {
		id: 'lead-id', name: 'Jane Doe', caller_phone: '+12025550123',
		campaign_id: null, disposition_id: null, disposition_label: null,
		form_id: null, form_version: null, form_schema_snapshot: [],
		form_data: {
			email: 'jane@example.test', state: 'TX', notes: 'Call after 5 pm',
			consent: true, household: [{name: 'Jane', age: 40}],
			preferences: {contact: 'phone'}, tags: ['homeowner', 'evening'],
			children: 0
		},
		created_at: '2026-10-21T15:00:00Z', updated_at: '2026-10-21T15:00:00Z'
	},
	campaign_name: null,
	call: null
};

describe('CRM direct lead data', () => {
	it('shows every vendor answer when no campaign or schema exists', () => {
		const fields = leadResponseFields(detail.lead!);
		expect(fields.map((field) => field.key)).toEqual(Object.keys(detail.lead!.form_data));
		expect(fields).toContainEqual({key: 'notes', label: 'notes', value: 'Call after 5 pm'});
		expect(fields).toContainEqual({key: 'children', label: 'children', value: '0'});
		expect(fields).toContainEqual({key: 'consent', label: 'consent', value: 'Yes'});
	});

	it('copies nested values without collapsing objects into object Object', () => {
		const text = leadToText(detail);
		expect(text).toContain('email: jane@example.test');
		expect(text).toContain('state: TX');
		expect(text).toContain('notes: Call after 5 pm');
		expect(text).toContain('household: ' + JSON.stringify([{name: 'Jane', age: 40}], null, 2));
		expect(text).toContain('preferences: ' + JSON.stringify({contact: 'phone'}, null, 2));
		expect(text).toContain('tags: homeowner, evening');
		expect(text).not.toContain('[object Object]');
		expect(text).not.toContain('Campaign:');
		expect(text).not.toContain('Disposition:');
	});

	it('handles a null schema and empty vendor data', () => {
		expect(leadResponseFields({...detail.lead!, form_schema_snapshot: null, form_data: {}})).toEqual([]);
		expect(leadToText(null)).toBe('');
	});

	it('preserves published form labels and limits for campaign leads', () => {
		const campaignDetail: LeadDetailResponse = {
			...detail, campaign_name: 'Existing campaign', lead: {
				...detail.lead!, campaign_id: 'campaign-id',
				form_schema_snapshot: [{key: 'notes', label: 'Agent notes', type: 'text', sort_order: 1}]
			}
		};
		expect(leadResponseFields(campaignDetail.lead!)).toEqual([{key: 'notes', label: 'Agent notes', value: 'Call after 5 pm'}]);
		expect(leadToText(campaignDetail)).toContain('Campaign: Existing campaign');
		expect(leadToText(campaignDetail)).toContain('Agent notes: Call after 5 pm');
		expect(leadToText(campaignDetail)).not.toContain('email:');
	});

	it('does not infer raw form fields for a campaign whose schema is missing', () => {
		expect(leadResponseFields({...detail.lead!, campaign_id: 'campaign-id'})).toEqual([]);
	});
});
