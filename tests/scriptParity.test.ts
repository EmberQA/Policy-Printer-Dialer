import {describe, it, expect} from 'vitest';
import * as dialer from '../src/script/engine';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const adminPath = resolve(
	import.meta.dirname,
	'../../EmberQA-Frontend/src/utils/callScriptEngine.ts'
);
const admin: typeof dialer | undefined = existsSync(adminPath)
	? await import(/* @vite-ignore */ adminPath)
	: undefined;
import seed from './fixtures/final_expense_v4.json';
import type {
	ScriptGraph,
	ScriptSession,
	ScriptChecklistItem
} from '../src/script/types';
import {focusNextScriptField} from '../src/script/fieldNavigation';
const graph = seed as ScriptGraph;
const NOW = '2026-09-29T12:00:00.000Z';

for (const [name, engine] of Object.entries(
	admin ? {dialer, admin} : {dialer}
)) {
	describe(`${name}: Final Expense walkthrough`, () => {
		const ix = engine.indexGraph(graph);
		const start = (id = graph.start_node_id) =>
			engine.createSession(
				engine.indexGraph({...graph, start_node_id: id}),
				{},
				NOW
			);
		const set = (s: ScriptSession, key: string, value: string | boolean) =>
			engine.commitVar(s, key, value, 'capture', NOW);
		const next = (s: ScriptSession, choiceId?: string) =>
			engine.advance(ix, s, {choiceId, now: NOW});
		const item = (id: string, key: string) =>
			(
				ix.steps.get(id) as {data: {items: ScriptChecklistItem[]}}
			).data.items.find((i) => i.id === key)!;
		it.each(['shopped_before', 'first_time', 'has_coverage'])(
			'walks discovery: %s',
			(branch) => {
				let s = next(start(), 'yes');
				expect(s.current_node_id).toBe('intro.name');
				expect(next(s)).not.toBe(s);
				s = next(set(s, 'first_name', 'Test'));
				expect(s.current_node_id).toBe('intro.discounts');
				s = next(next(s)); // Optional discounts can be skipped.
				s = next(s, branch);
				s = next(set(s, 'motivation', 'Protect family'));
				if (branch === 'first_time') s = next(s, 'real_reason');
				expect(s.current_node_id).toBe('dq.coverage');
			}
		);
		it.each(['spouse', 'child', 'other'])(
			'walks beneficiary: %s',
			(relation) => {
				let s = next(
					set(start('dq.beneficiary'), 'beneficiary_name', 'Test Person')
				);
				s = next(s, relation);
				if (relation === 'other') s = set(s, 'beneficiary_relation', 'Sibling');
				s = next(s);
				expect(s.current_node_id).toBe('dq.funeral');
				expect(s.vars.beneficiary_relation.value).toBe(
					relation === 'other' ? 'Sibling' : relation
				);
				s = next(s);
				expect(next(s)).not.toBe(s);
				s = next(set(s, 'benefit_dq_answer', 'pay bills'));
				expect(s.current_node_id).toBe('med.transition');
			}
		);
		it('keeps optional checklists permissive and false values answered', () => {
			let s = start('dq.funeral');
			expect(
				engine.isItemDone(s, 'dq.funeral', item('dq.funeral', 'extra'))
			).toBe(false);
			s = set(s, 'leave_extra_money', false);
			expect(
				engine.isItemDone(s, 'dq.funeral', item('dq.funeral', 'extra'))
			).toBe(true);
			expect(next(s).current_node_id).toBe('dq.benefit');
			s = start('app.beneficiary');
			const copy = item('app.beneficiary', 'copy');
			s = set(s, 'beneficiary_policy_copy', false);
			expect(engine.visibleFields(s, copy.say).map((f) => f.var)).not.toContain(
				'beneficiary_address'
			);
			expect(engine.isItemDone(s, 'app.beneficiary', copy)).toBe(true);
			s = set(s, 'beneficiary_policy_copy', true);
			expect(engine.isItemDone(s, 'app.beneficiary', copy)).toBe(false);
			s = set(s, 'beneficiary_address', 'Test address');
			expect(engine.isItemDone(s, 'app.beneficiary', copy)).toBe(true);
		});
		it('keeps required recovery inputs present after the first character', () => {
			let s = start('pitch.choose');
			expect(
				engine.prerequisiteFields(s, ix.steps.get('pitch.choose')!)
			).toContain('plan1_amount');
			s = set(s, 'plan1_amount', '1');
			expect(
				engine.prerequisiteFields(s, ix.steps.get('pitch.choose')!)
			).toContain('plan1_amount');
		});
		it('walks quotes, adjustment, application and closing; preserves response until Next', () => {
			let s = start('pitch.quotes');
			for (const [k, v] of Object.entries({
				beneficiary_name: 'Test',
				plan1_amount: '10000',
				plan1_premium: '25',
				plan2_amount: '15000',
				plan2_premium: '35',
				plan3_amount: '20000',
				plan3_premium: '45'
			}))
				s = set(s, k, v);
			s = next(s);
			s = next(s, 'adjust');
			expect(s.current_node_id).toBe('pitch.quotes');
			s = next(next(s), 'plan2');
			s = next(s, 'yes');
			expect(s.current_node_id).toBe('pitch.confirm');
			expect(s.pending_choices?.['pitch.confirm']).toBe('yes');
			expect(next(s, 'yes')).toBe(s);
			expect(s.choice_uses['pitch.confirm:yes']).toBe(1);
			s = next(s);
			expect(s.current_node_id).toBe('app.identity');
			s = next(set(set(s, 'first_name', 'Test'), 'last_name', 'Person'));
			s = next(s);
			expect(s.current_node_id).toBe('app.ssn');
			s = next(s);
			s = next(set(s, 'effective_date', 'October 3'));
			s = next(next(next(s)));
			expect(s.current_node_id).toBe('close.writedown');
			expect(
				engine.itemDisplay(ix, s, item('close.writedown', 'benefit'))
			).toBe('$15,000');
			expect(
				engine.itemDisplay(ix, s, item('close.writedown', 'premium'))
			).toBe('$35');
			s = set(s, 'plan2_premium', '37');
			expect(
				engine.itemDisplay(ix, s, item('close.writedown', 'premium'))
			).toBe('$37');
			s = set(s, 'policy_number', 'TEST-123');
			expect(
				engine.isItemDone(
					s,
					'close.writedown',
					item('close.writedown', 'policy')
				)
			).toBe(false);
			s = engine.setItemChecked(s, 'close.writedown', 'policy', true);
			expect(
				engine.isItemDone(
					s,
					'close.writedown',
					item('close.writedown', 'policy')
				)
			).toBe(true);
			s = next(next(s));
			expect(s.ended).toBe(true);
		});
		it('unwinds nested objections without skipping an unread spoken step', () => {
			let s = start('dq.coverage');
			s = engine.jumpToHeading(ix, s, 'h.trg6', NOW);
			s = next(s, 'free');
			expect(s.return_stack).toEqual(['dq.coverage', 'trg6.follow']);
			s = next(s, 'protect');
			s = next(s);
			expect(s.current_node_id).toBe('trg6.soft');
			s = next(s);
			expect(s.current_node_id).toBe('dq.coverage');
			expect(s.return_stack).toEqual([]);
		});
		it('recovers if an author removes the pending choice during a preview', () => {
			const s = next(start('med.result'), 'healthy');
			const changed = engine.indexGraph({
				...graph,
				nodes: graph.nodes.map((n) =>
					n.id === 'med.result' && n.type === 'ask'
						? {...n, choices: n.choices.filter((c) => c.id !== 'healthy')}
						: n
				)
			});
			const recovered = engine.advance(changed, s, {
				choiceId: 'conditions',
				now: NOW
			});
			expect(recovered.pending_choices?.['med.result']).toBe('conditions');
			expect(
				engine.advance(changed, recovered, {now: NOW}).current_node_id
			).toBe('edu.contact');
		});
		it('preserves a parent response when an objection has its own response', () => {
			let s = next(start('med.result'), 'healthy');
			s = engine.jumpToHeading(ix, s, 'h.obj6', NOW);
			s = next(s, 'previous_agent');
			s = next(s, 'yes');
			expect(s.pending_choices).toEqual({
				'med.result': 'healthy',
				'obj6.previous': 'yes'
			});
			s = next(s);
			expect(s.pending_choices).toEqual({'med.result': 'healthy'});
			s = next(s);
			s = next(s);
			expect(s.current_node_id).toBe('med.result');
			expect(s.pending_choices).toEqual({'med.result': 'healthy'});
			expect(next(s).current_node_id).toBe('edu.contact');
		});
		it('preserves a pending response across an objection and Back retains new answers', () => {
			let s = next(start('med.result'), 'healthy');
			const pending = s;
			s = engine.jumpToHeading(ix, s, 'h.obj1', NOW);
			s = next(s, 'protect');
			s = next(s);
			expect(s.pending_choices).toEqual(pending.pending_choices);
			expect(s.current_node_id).toBe('med.result');
			const onward = next(s);
			expect(onward.current_node_id).toBe('edu.contact');
			const back = engine.goBack(
				pending,
				set(onward, 'policy_number', 'TEST'),
				NOW
			);
			expect(back.vars.policy_number.value).toBe('TEST');
			expect(next(back).current_node_id).toBe('edu.contact');
			expect(next(back).choice_uses['med.result:healthy']).toBe(1);
		});
	});
}

it.skipIf(!admin)(
	'both engines produce identical sessions through a full choice-response transition',
	() => {
		const run = (e: typeof dialer) => {
			const ix = e.indexGraph({...graph, start_node_id: 'med.result'});
			const s = e.advance(ix, e.createSession(ix, {}, NOW), {
				choiceId: 'healthy',
				now: NOW
			});
			return [s, e.advance(ix, s, {now: NOW})];
		};
		expect(run(admin!)).toEqual(run(dialer));
	}
);

it('Enter focuses the next available field and never wraps or submits', () => {
	const focused: string[] = [];
	const fields = ['first', 'second', 'third'].map((name) => ({
		querySelector: () => ({focus: () => focused.push(name)})
	}));
	const input = (index: number) =>
		({
			closest: (selector: string) =>
				selector === '[data-script-step]'
					? {querySelectorAll: () => fields}
					: fields[index]
		}) as unknown as HTMLElement;
	focusNextScriptField(input(0));
	expect(focused).toEqual(['second']);
	focusNextScriptField(input(2));
	expect(focused).toEqual(['second']);
});

const backendSeed = resolve(
	import.meta.dirname,
	'../../EmberQA-Backend/bespoke_features/policy_printer/callScript/seeds/final_expense_v4.json'
);
it.skipIf(!existsSync(backendSeed))(
	'dialer fixture matches the backend seed',
	() => {
		expect(seed).toEqual(JSON.parse(readFileSync(backendSeed, 'utf8')));
	}
);
