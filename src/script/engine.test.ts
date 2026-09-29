import {describe, expect, it} from 'vitest';
import {
	advance,
	availableChoices,
	commitVar,
	createSession,
	currentStep,
	formFieldsForVar,
	goBack,
	indexGraph,
	jumpToHeading,
	missingVars,
	normalizeCallerPhone,
	resolveText,
	resume,
	varsForFormField,
	varsForLeadColumn
} from './engine';
import type {ScriptGraph} from './types';

const NOW = '2026-09-28T00:00:00.000Z';

/**
 * intro.name (required capture first_name) → intro.hi (say) → pitch.choose (ask)
 *   pitch.choose: plan → pitch.done (end sale) | expensive → heading h.obj
 *                 | reloop (max_uses 1) → pitch.choose
 * h.obj: obj.ack (say) → obj.pick (ask): back → return(fallback intro.hi)
 *                                       adjust → node pitch.quote (flow)
 */
const graph: ScriptGraph = {
	schema_version: 1,
	version_label: 't',
	title: 'T',
	start_node_id: 'intro.name',
	vars: [
		{
			key: 'first_name',
			label: 'First',
			source: 'call',
			bindings: [
				{
					target: 'form_field',
					form: 'default',
					field: 'first_name',
					direction: 'both'
				}
			]
		},
		{
			key: 'dob',
			label: 'DOB',
			source: 'call',
			bindings: [
				{target: 'form_field', form: 'default', field: 'dob', direction: 'in'}
			]
		},
		{
			key: 'caller_phone',
			label: 'Caller',
			source: 'call',
			bindings: [
				{target: 'lead_column', column: 'caller_phone', direction: 'in'}
			]
		},
		{
			key: 'beneficiary',
			label: 'Ben',
			source: 'call',
			fallback: 'your loved one'
		},
		{key: 'amount', label: 'Amount', source: 'call', input: {kind: 'currency'}},
		{
			key: 'plan',
			label: 'Plan',
			source: 'call',
			input: {
				kind: 'choice',
				config: {options: [{value: '1', label: 'Plan 1'}]}
			}
		}
	],
	nodes: [
		{
			id: 'h.intro',
			type: 'heading',
			level: 1,
			parent_id: null,
			title: 'Intro',
			role: 'flow',
			entry_node_id: 'intro.name',
			sort: 1
		},
		{
			id: 'h.pitch',
			type: 'heading',
			level: 1,
			parent_id: null,
			title: 'Pitch',
			role: 'flow',
			entry_node_id: 'pitch.choose',
			sort: 2
		},
		{
			id: 'h.obj',
			type: 'heading',
			level: 1,
			parent_id: null,
			title: 'Objections',
			role: 'objection',
			entry_node_id: 'obj.ack',
			sort: 3
		},
		{
			id: 'intro.name',
			type: 'capture',
			heading_id: 'h.intro',
			data: {var: 'first_name', required: true},
			say: {text: 'Who am I speaking with?'},
			next: {kind: 'node', node_id: 'intro.hi'}
		},
		{
			id: 'intro.hi',
			type: 'say',
			heading_id: 'h.intro',
			data: {},
			say: {text: 'Hi {{first_name}}, this is for {{beneficiary}}: {{amount}}'},
			next: {kind: 'node', node_id: 'pitch.choose'},
			on_enter: [{type: 'tag', params: {tag: 'greeted'}}]
		},
		{
			id: 'pitch.choose',
			type: 'ask',
			heading_id: 'h.pitch',
			data: {},
			say: {text: 'Which one?'},
			requires: ['beneficiary'],
			choices: [
				{
					id: 'plan',
					label: 'Plan 1',
					target: {kind: 'end', outcome: 'sale'},
					actions: [{type: 'set_var', params: {key: 'plan', value: '1'}}]
				},
				{
					id: 'expensive',
					label: 'Too expensive',
					target: {kind: 'heading', heading_id: 'h.obj'}
				},
				{
					id: 'reloop',
					label: 'Again',
					target: {kind: 'node', node_id: 'pitch.choose'},
					max_uses: 1
				}
			]
		},
		{
			id: 'pitch.quote',
			type: 'say',
			heading_id: 'h.pitch',
			data: {},
			say: {text: 'Quote'},
			next: {kind: 'node', node_id: 'pitch.choose'}
		},
		{
			id: 'obj.ack',
			type: 'say',
			heading_id: 'h.obj',
			data: {},
			say: {text: 'I understand.'},
			next: {kind: 'node', node_id: 'obj.pick'}
		},
		{
			id: 'obj.pick',
			type: 'ask',
			heading_id: 'h.obj',
			data: {},
			say: {text: 'Which way?'},
			choices: [
				{
					id: 'back',
					label: 'Back',
					target: {kind: 'return', fallback: 'intro.hi'}
				},
				{
					id: 'adjust',
					label: 'Adjust',
					target: {kind: 'node', node_id: 'pitch.quote'}
				}
			]
		}
	]
};

const ix = indexGraph(graph);
const start = () => createSession(ix, {}, NOW);
const named = () =>
	advance(ix, commitVar(start(), 'first_name', 'Ada', 'capture', NOW), {
		now: NOW
	});
const atPitch = () =>
	advance(ix, commitVar(named(), 'beneficiary', 'Bob', 'capture', NOW), {
		now: NOW
	});

describe('script engine', () => {
	it('starts on start_node_id and seeds only declared, non-empty vars', () => {
		const s = createSession(
			ix,
			{
				caller_phone: {value: '+15551234567', source: 'form'},
				unknown_key: {value: 'x', source: 'form'},
				dob: {value: '', source: 'form'}
			},
			NOW
		);
		expect(s.current_node_id).toBe('intro.name');
		expect(Object.keys(s.vars)).toEqual(['caller_phone']);
	});

	it('blocks a required capture until its var is set', () => {
		const s = start();
		expect(missingVars(s, currentStep(ix, s)!)).toEqual(['first_name']);
		expect(advance(ix, s)).toBe(s);
		expect(named().current_node_id).toBe('intro.hi');
	});

	it('runs on_enter actions', () => {
		expect(named().tags).toEqual(['greeted']);
	});

	it('resolves {{vars}}: value, formatted currency, fallback, blank', () => {
		const s = named();
		expect(
			resolveText(ix, s, 'Hi {{first_name}}, {{beneficiary}}, {{amount}}')
		).toBe('Hi Ada, your loved one, ____');
		const priced = commitVar(s, 'amount', '25000', 'capture', NOW);
		expect(resolveText(ix, priced, '{{amount}}')).toBe('$25,000');
	});

	it('`requires` blocks leaving a step until the var is set, from any source', () => {
		const s = advance(ix, named(), {now: NOW}); // → pitch.choose
		expect(s.current_node_id).toBe('pitch.choose');
		expect(advance(ix, s, {choiceId: 'plan'})).toBe(s);
		const fromForm = commitVar(s, 'beneficiary', 'Bob', 'form', NOW);
		const done = advance(ix, fromForm, {choiceId: 'plan', now: NOW});
		expect(done.ended).toBe(true);
		expect(done.outcome).toBe('sale');
		expect(done.vars.plan.value).toBe('1');
		expect(done.vars.plan.source).toBe('action');
	});

	it('hides a choice once max_uses is spent', () => {
		const s = atPitch();
		const again = advance(ix, s, {choiceId: 'reloop', now: NOW});
		expect(again.current_node_id).toBe('pitch.choose');
		expect(
			availableChoices(again, currentStep(ix, again)!).map((c) => c.id)
		).not.toContain('reloop');
		expect(advance(ix, again, {choiceId: 'reloop'})).toBe(again);
	});

	it('objection pushes the current step and `return` pops back to it', () => {
		const inObj = advance(ix, atPitch(), {choiceId: 'expensive', now: NOW});
		expect(inObj.current_node_id).toBe('obj.ack');
		expect(inObj.return_stack).toEqual(['pitch.choose']);
		const pick = advance(ix, inObj, {now: NOW});
		const back = advance(ix, pick, {choiceId: 'back', now: NOW});
		expect(back.current_node_id).toBe('pitch.choose');
		expect(back.return_stack).toEqual([]);
	});

	it('`return` with an empty stack uses the fallback', () => {
		const jumped = {...jumpToHeading(ix, start(), 'h.obj'), return_stack: []};
		const pick = advance(ix, jumped, {now: NOW});
		expect(
			advance(ix, pick, {choiceId: 'back', now: NOW}).current_node_id
		).toBe('intro.hi');
	});

	it('leaving an objection for a FLOW step by node target clears the stack', () => {
		const inObj = advance(ix, atPitch(), {choiceId: 'expensive', now: NOW});
		const pick = advance(ix, inObj, {now: NOW});
		const adjusted = advance(ix, pick, {choiceId: 'adjust', now: NOW});
		expect(adjusted.current_node_id).toBe('pitch.quote');
		expect(adjusted.return_stack).toEqual([]);
	});

	it('quick-jump into an override from anywhere pushes; outline jump to flow does not', () => {
		const s = named();
		expect(jumpToHeading(ix, s, 'h.obj').return_stack).toEqual(['intro.hi']);
		expect(jumpToHeading(ix, s, 'h.pitch').return_stack).toEqual([]);
	});

	it('resume leaves an override early and is a no-op outside one', () => {
		const s = named();
		const inObj = jumpToHeading(ix, s, 'h.obj');
		const back = resume(ix, inObj);
		expect(back.current_node_id).toBe('intro.hi');
		expect(back.return_stack).toEqual([]);
		expect(resume(ix, s)).toBe(s);
	});

	it('commitVar: last write wins across sources, and an empty value clears', () => {
		let s = commitVar(start(), 'first_name', 'Ada', 'capture', NOW);
		s = commitVar(s, 'first_name', 'Adah', 'form', NOW);
		expect(s.vars.first_name).toEqual({
			value: 'Adah',
			source: 'form',
			updated_at: NOW
		});
		expect(
			commitVar(s, 'first_name', '', 'form', NOW).vars.first_name
		).toBeUndefined();
	});

	it('goBack restores position but keeps what was captured since', () => {
		const before = start();
		const after = named();
		const back = goBack(before, after);
		expect(back.current_node_id).toBe('intro.name');
		expect(back.vars.first_name.value).toBe('Ada');
	});

	it('bindings: in/both fields feed vars; out/both vars write fields; columns are in-only', () => {
		expect(varsForFormField(ix, 'default', 'first_name')).toEqual([
			'first_name'
		]);
		expect(varsForFormField(ix, 'default', 'dob')).toEqual(['dob']);
		expect(varsForFormField(ix, 'other_form', 'dob')).toEqual([]);
		expect(formFieldsForVar(ix, 'default', 'first_name')).toEqual([
			'first_name'
		]);
		expect(formFieldsForVar(ix, 'default', 'dob')).toEqual([]);
		expect(varsForLeadColumn(ix, 'caller_phone')).toEqual(['caller_phone']);
	});

	it("treats a missing or 'Unknown' caller id as unset", () => {
		expect(normalizeCallerPhone('Unknown')).toBeNull();
		expect(normalizeCallerPhone('  ')).toBeNull();
		expect(normalizeCallerPhone(null)).toBeNull();
		expect(normalizeCallerPhone('+15551234567')).toBe('+15551234567');
	});
});
