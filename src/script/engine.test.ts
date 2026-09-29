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
	raiseInterrupt,
	missingVars,
	normalizeCallerPhone,
	resolveText,
	resume,
	setItemChecked,
	isItemDone,
	isStepDone,
	readingMs,
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

	it('an objection hands back to where they left off: same step if unfinished, the next one if finished', () => {
		const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
		const hi = ix.steps.get('intro.hi')!;
		const readIt = readingMs(hi);
		expect(readIt).toBeGreaterThan(0);

		// Say step, interrupted before it could have been read → back to it.
		const quick = jumpToHeading(ix, named(), 'h.obj', at(readIt - 1));
		expect(quick.return_stack).toEqual(['intro.hi']);
		expect(isStepDone(ix, quick, 'intro.hi', at(readIt - 1))).toBe(false);
		expect(resume(ix, quick, at(readIt + 5_000)).current_node_id).toBe(
			'intro.hi'
		);

		// Say step read in full (at READING_WPM) → on to the step after it.
		const read = jumpToHeading(ix, named(), 'h.obj', at(readIt));
		expect(isStepDone(ix, read, 'intro.hi', at(readIt))).toBe(true);
		const back = resume(ix, read, at(readIt + 5_000));
		expect(back.current_node_id).toBe('pitch.choose');
		expect(back.return_stack).toEqual([]);

		// Capture: finished once its field is filled, not by time.
		const cap = createSession(ix, {}, NOW);
		expect(isStepDone(ix, cap, 'intro.name', at(60_000))).toBe(false);
		const filled = commitVar(cap, 'first_name', 'Ada', 'capture', NOW);
		expect(isStepDone(ix, filled, 'intro.name', NOW)).toBe(true);
		const obj = jumpToHeading(ix, filled, 'h.obj', NOW);
		expect(resume(ix, obj, NOW).current_node_id).toBe('intro.hi');

		// Ask: only an answer finishes it, however long they sat on it.
		const pitch = atPitch();
		expect(isStepDone(ix, pitch, 'pitch.choose', at(600_000))).toBe(false);
		// Leaving by Next / an answer marks the step done.
		expect(named().done['intro.name']).toBe(true);
	});

	it("an answer that raises an objection marks the question done first; afterwards the call continues on the main answer's route", () => {
		// Without a main answer the question is asked again.
		const inObj = advance(ix, atPitch(), {choiceId: 'expensive', now: NOW});
		expect(inObj.done['pitch.choose']).toBe(true);
		const pick = advance(ix, inObj, {now: NOW});
		expect(
			advance(ix, pick, {choiceId: 'back', now: NOW}).current_node_id
		).toBe('pitch.choose');

		// With one (like "Yes" on the opening question) it carries on down that route.
		const withMain = indexGraph({
			...graph,
			nodes: graph.nodes.map((n) =>
				n.id === 'pitch.choose' && n.type === 'ask'
					? {
							...n,
							choices: n.choices.map((c) =>
								c.id === 'reloop'
									? {
											...c,
											target: {kind: 'node', node_id: 'pitch.quote'},
											main: true
										}
									: c
							)
						}
					: n
			)
		} as ScriptGraph);
		const s = advance(
			withMain,
			commitVar(named(), 'beneficiary', 'Bob', 'capture', NOW),
			{now: NOW}
		);
		const obj = advance(withMain, s, {choiceId: 'expensive', now: NOW});
		const p2 = advance(withMain, obj, {now: NOW});
		const out = advance(withMain, p2, {choiceId: 'back', now: NOW});
		expect(out.current_node_id).toBe('pitch.quote');
		expect(out.return_stack).toEqual([]);
	});

	it('a step interrupt fills the field first, opens the objection, and the call then carries on past the step', () => {
		const withInterrupt = indexGraph({
			...graph,
			nodes: graph.nodes.map((n) =>
				n.id === 'intro.name'
					? {
							...n,
							interrupts: [
								{id: 'r', label: 'Review', heading_id: 'h.obj', fill: 'Ada'}
							]
						}
					: n
			)
		} as ScriptGraph);
		const s = createSession(withInterrupt, {}, NOW);
		const inObj = raiseInterrupt(withInterrupt, s, 'r', NOW);
		expect(inObj.vars.first_name.value).toBe('Ada');
		expect(inObj.current_node_id).toBe('obj.ack');
		expect(inObj.return_stack).toEqual(['intro.name']);
		expect(resume(withInterrupt, inObj, NOW).current_node_id).toBe('intro.hi');
		expect(raiseInterrupt(withInterrupt, s, 'nope', NOW)).toBe(s);
	});

	it('a checklist counts as done without its optional lines', () => {
		const withList = indexGraph({
			...graph,
			nodes: [
				...graph.nodes,
				{
					id: 'list',
					type: 'checklist',
					heading_id: 'h.intro',
					data: {
						items: [
							{id: 'name', say: {text: 'Name?'}, var: 'first_name'},
							{id: 'unit', say: {text: 'Unit?'}, var: 'dob', optional: true}
						]
					},
					next: {kind: 'node', node_id: 'intro.hi'}
				}
			]
		} as ScriptGraph);
		const s = start();
		expect(isStepDone(withList, s, 'list', NOW)).toBe(false);
		const named = commitVar(s, 'first_name', 'Ada', 'capture', NOW);
		expect(isStepDone(withList, named, 'list', NOW)).toBe(true);
	});

	it('checklist lines: a field ticks itself when filled, plain lines are ticked by hand', () => {
		const plain = {id: 'p', say: {text: 'Over 50?'}};
		const field = {id: 'f', say: {text: 'Name?'}, var: 'first_name'};
		const s = start();
		expect(isItemDone(s, 'x', plain)).toBe(false);
		const ticked = setItemChecked(s, 'x', 'p', true);
		expect(isItemDone(ticked, 'x', plain)).toBe(true);
		expect(isItemDone(ticked, 'y', plain)).toBe(false); // per step
		expect(setItemChecked(ticked, 'x', 'p', true)).toBe(ticked); // no-op
		expect(
			isItemDone(setItemChecked(ticked, 'x', 'p', false), 'x', plain)
		).toBe(false);
		expect(isItemDone(s, 'x', field)).toBe(false);
		expect(
			isItemDone(commitVar(s, 'first_name', 'Ada', 'capture', NOW), 'x', field)
		).toBe(true);
	});

	it('resume leaves an override early and is a no-op outside one', () => {
		const s = named();
		const inObj = jumpToHeading(ix, s, 'h.obj', NOW);
		const back = resume(ix, inObj, NOW);
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

	it('goBack restores position but keeps what was captured, finished and read since', () => {
		const before = start();
		const after = setItemChecked(named(), 'x', 'p', true);
		const back = goBack(before, after, NOW);
		expect(back.current_node_id).toBe('intro.name');
		expect(back.vars.first_name.value).toBe('Ada');
		expect(back.done['intro.name']).toBe(true);
		expect(back.checked['x:p']).toBe(true);
		expect(back.entered_at).toBe(NOW);
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
