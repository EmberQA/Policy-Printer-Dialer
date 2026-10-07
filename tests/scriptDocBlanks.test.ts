import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScriptDoc} from '@/scriptDoc/ScriptDoc';
import {SCRIPT_DOC} from '@/scriptDoc/content';
import {findUnknownBlankSources, parseInline, resolveBlank} from '@/scriptDoc/core';
import type {ScriptValues} from '@/scriptDoc/types';

const VALUES: ScriptValues = {
	agentName: 'Ethan Shover',
	formData: {
		first_name: 'Jane',
		last_name: 'Doe',
		phone: '16035689902',
		state: 'NH',
		address: '1 Main St',
		address2: 'Apt 2',
		city: 'Concord',
		zip: '03301',
		sob: 'Ohio',
		dob: '1950-03-02',
		height: `5'6"`,
		weight: '150'
	},
	formSchema: [{key: 'state', options: [{value: 'NH', label: 'New Hampshire (NH)'}]}]
};

describe('script blanks linked to the lead form (ENG-298)', () => {
	it('parses {{placeholder|source}} and value-only {{|source}}', () => {
		expect(parseInline('a {{your name|agent_name}} b {{|dob}} {{plain}}')).toEqual([
			{type: 'text', text: 'a '},
			{type: 'blank', text: 'your name', source: 'agent_name'},
			{type: 'text', text: ' b '},
			{type: 'blank', text: '', source: 'dob'},
			{type: 'text', text: ' '},
			{type: 'blank', text: 'plain'}
		]);
	});

	it('resolves agent, lead name, select labels and the mailing address', () => {
		expect(resolveBlank('agent_name', VALUES)).toBe('Ethan Shover');
		expect(resolveBlank('lead_name', VALUES)).toBe('Jane Doe');
		expect(resolveBlank('state', VALUES)).toBe('New Hampshire');
		expect(resolveBlank('mailing_address', VALUES)).toBe('1 Main St Apt 2, Concord, NH 03301');
		expect(resolveBlank('phone', VALUES)).toBe('16035689902');
	});

	it('returns empty (placeholder stays) when the form has nothing', () => {
		expect(resolveBlank('lead_name', {})).toBe('');
		expect(resolveBlank('state', {formData: {state: '  '}})).toBe('');
		expect(resolveBlank('nope', VALUES)).toBe('');
	});

	it('every linked blank in the script names a known source', () => {
		expect(findUnknownBlankSources(SCRIPT_DOC)).toEqual([]);
	});

	it('renders filled values and hides empty value-only blanks', () => {
		const filled = renderToStaticMarkup(createElement(ScriptDoc, {values: VALUES}));
		expect(filled).toContain('Ethan Shover');
		expect(filled).toContain('New Hampshire');
		expect(filled).toContain('Jane Doe');
		expect(filled).not.toContain('>your name<');
		const empty = renderToStaticMarkup(createElement(ScriptDoc));
		expect(empty).toContain('>your name<');
		expect(empty).toContain('>lead name<');
		expect(empty).not.toContain('Jane Doe');
	});
});
