import {describe, it, expect} from 'vitest';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import * as dialer from '../src/script/engine';
import {scriptAnswerLines, mergeAnswerNotes} from '../src/script/answerNotes';
import type {ScriptGraph, ScriptSession} from '../src/script/types';
import seed from './fixtures/final_expense_v4.json';
const graph = seed as ScriptGraph;
const adminPath = resolve(
	import.meta.dirname,
	'../../EmberQA-Frontend/src/utils/callScriptEngine.ts'
);
const admin: typeof dialer | undefined = existsSync(adminPath)
	? await import(/* @vite-ignore */ adminPath)
	: undefined;
for (const [name, e] of Object.entries(admin ? {dialer, admin} : {dialer}))
	describe(name, () => {
		const ix = e.indexGraph(graph);
		const at = (id: string) =>
			e.createSession(e.indexGraph({...graph, start_node_id: id}));
		it('walks the main flow with every answer blank and no fabricated choice values', () => {
			let s = e.createSession(ix);
			const visited: string[] = [];
			for (let i = 0; i < 80 && !s.ended; i++) {
				visited.push(s.current_node_id);
				const next = e.advance(ix, s);
				expect(next).not.toBe(s);
				s = next;
			}
			expect(s.ended).toBe(true);
			expect(visited).toContain('app.identity');
			expect(visited).toContain('close.writedown');
			expect(s.vars).toEqual({});
			expect(s.choice_uses).toEqual({});
			expect(s.answers).toBeUndefined();
		});
		it('skips eligibility without applying a qualification answer', () => {
			const s = e.advance(ix, at('med.result'));
			expect(s.current_node_id).toBe('edu.contact');
			expect(s.vars).toEqual({});
			expect(s.answers).toBeUndefined();
		});
		it('skips an unanswered nested objection back to its caller', () => {
			let s = at('dq.coverage');
			s = e.jumpToHeading(ix, s, 'h.obj1');
			const parent = s.current_node_id;
			s = e.jumpToHeading(ix, s, 'h.obj2');
			s = e.advance(ix, s);
			expect(s.current_node_id).toBe(parent);
			expect(s.return_stack).toEqual(['dq.coverage']);
		});
		it('retains explicit answers across Back and does not store acknowledgments as answers', () => {
			const before = at('dq.first_time');
			const after = e.advance(ix, before, {choiceId: 'first_time'});
			const back = e.goBack(before, after);
			expect(back.answers?.['dq.first_time']).toBe('first_time');
			const checked = e.setItemChecked(back, 'app.ssn', 'ssn', true);
			expect(checked.answers).toEqual(back.answers);
		});
		it('prefills both state aliases from one form field and keeps agent identity separate', () => {
			expect(e.varsForFormField(ix, 'default', 'state')).toEqual(
				expect.arrayContaining(['agent_state', 'state'])
			);
			expect(ix.vars.get('agent_name')?.source).toBe('agent');
			expect(ix.vars.get('agent_state')?.input?.kind).toBe('text');
			expect(
				ix.steps
					.get(graph.start_node_id)
					?.say?.fields?.map((field) => field.var)
			).toEqual(expect.arrayContaining(['agent_state', 'agent_name']));
		});
	});
const ix = dialer.indexGraph(graph);
const capture = (values: Record<string, string | boolean>): ScriptSession =>
	Object.entries(values).reduce(
		(s, [key, value]) => dialer.commitVar(s, key, value, 'capture'),
		dialer.createSession(ix)
	);
describe('simple answer notes', () => {
	it('records false, choice labels and text while excluding bound fields and agent identity', () => {
		const s = capture({
			first_name: 'Test',
			agent_name: 'Agent',
			leave_extra_money: false,
			additional_beneficiaries: 'Sibling'
		});
		const lines = scriptAnswerLines(graph, s, 'default', ['first_name']);
		expect(lines.first_name).toBeUndefined();
		expect(lines.agent_name).toBeUndefined();
		expect(lines.leave_extra_money).toMatch(/: No$/);
	});
	it('records a bound answer when its form field is absent or rejects the choice', () => {
		const s = capture({first_name: 'Test', state: 'unlisted'});
		expect(scriptAnswerLines(graph, s, 'other', []).first_name).toBe(
			'First name: Test'
		);
		expect(
			scriptAnswerLines(graph, s, 'default', [
				{key: 'state', options: [{value: 'TX'}]}
			]).state
		).toBe('State: unlisted');
	});
	it('updates multiline answers once and preserves manual notes and edits', () => {
		const old = {answer: 'Response: one\ntwo'};
		const next = {answer: 'Response: three\nfour'};
		const notes = mergeAnswerNotes('Manual note', {}, old);
		expect(mergeAnswerNotes(notes, old, next)).toBe(
			'Manual note\nResponse: three\nfour'
		);
		expect(mergeAnswerNotes(notes, old, old)).toBe(notes);
		expect(mergeAnswerNotes('Manually edited response', old, next)).toBe(
			'Manually edited response\nResponse: three\nfour'
		);
	});
	it('includes explicit branch answers without duplicating set_var selections', () => {
		let s = dialer.createSession(
			dialer.indexGraph({...graph, start_node_id: 'dq.first_time'})
		);
		s = dialer.advance(ix, s, {choiceId: 'first_time'});
		expect(
			scriptAnswerLines(graph, s, 'default', [])['choice:dq.first_time']
		).toContain('First time');
	});
});
const previewPath = resolve(
	import.meta.dirname,
	'../../EmberQA-Frontend/src/utils/scriptPreviewForm.ts'
);
if (existsSync(previewPath)) {
	const {previewFormFields, previewFormSeed} = await import(
		/* @vite-ignore */ previewPath
	);
	it('preview form deduplicates aliases and fills state, first name and signed-in agent', () => {
		const fields = previewFormFields(graph);
		expect(
			fields.filter((f: {id: string}) => f.id === 'form:default:state')
		).toHaveLength(1);
		const seed = previewFormSeed(
			graph,
			{'form:default:state': 'TX', 'form:default:first_name': 'Test'},
			'Agent Name'
		);
		expect(seed.agent_state.value).toBe('TX');
		expect(seed.state.value).toBe('TX');
		expect(seed.first_name.value).toBe('Test');
		expect(seed.agent_name).toEqual({value: 'Agent Name', source: 'profile'});
	});
}
