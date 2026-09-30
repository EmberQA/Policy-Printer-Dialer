import {it, expect, vi, afterEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScriptPreview} from '../src/script/ScriptPanel';
import {handleScriptTab} from '../src/script/fieldNavigation';
import type {DialerScript, ScriptGraph} from '../src/script/types';
import seed from './fixtures/final_expense_v4.json';
const markup = (start = seed.start_node_id) =>
	renderToStaticMarkup(
		<ScriptPreview
			script={
				{
					id: 'test',
					name: seed.title,
					graph: {...seed, start_node_id: start} as ScriptGraph
				} as DialerScript
			}
			agentVars={{agent_name: 'Test Agent'}}
		/>
	);
it('prefills editable name and renders state at the first intro', () => {
	const html = markup();
	expect(html).toMatch(/aria-label="Agent name"[^>]*value="Test Agent"/);
	expect(html).toContain('aria-label="Agent state"');
	expect(html).not.toContain('You say');
	expect(html).not.toContain('You type');
});
it('never disables Next for unanswered capture or checklist fields', () => {
	for (const id of ['intro.name', 'dq.funeral']) {
		const html = markup(id);
		expect(html).not.toContain('Needed before moving on');
		expect(html).not.toContain('(required)');
		const next = html.match(/<button[^>]*>Next[\s\S]*?<\/button>/)?.[0];
		expect(next).toBeDefined();
		expect(next).not.toMatch(/\sdisabled(?:=|\s|>)/);
	}
});
it('keeps checklist ticks out of Tab order and nested fields free of command headings', () => {
	const html = markup('dq.funeral');
	expect(html).not.toMatch(/>(Type|Select|Enter|Choose)</);
	expect(html).toMatch(/<button[^>]*tabindex="-1"[^>]*aria-label="Line/);
	expect(html).toContain('data-script-answer');
});
afterEach(() => vi.unstubAllGlobals());
it('Tab and Shift-Tab skip ticks, JSON-location buttons and hidden inputs', () => {
	let focused = '';
	class Element {
		tabIndex = 0;
		ownerDocument = {querySelectorAll: () => elements};
		constructor(
			public id: string,
			public input = false,
			public answer = false,
			public hidden = false
		) {}
		matches(selector: string) {
			return selector.startsWith('[disabled]')
				? false
				: this.input || this.answer;
		}
		getClientRects() {
			return this.hidden ? [] : [{}];
		}
		focus() {
			focused = this.id;
		}
	}
	const elements = [
		new Element('first', true),
		new Element('tick'),
		new Element('json'),
		new Element('hidden', true, false, true),
		new Element('answer', false, true),
		new Element('next'),
		new Element('last', true)
	];
	vi.stubGlobal('HTMLElement', Element);
	let prevented = false;
	const event = (index: number, shiftKey = false) => ({
		key: 'Tab',
		shiftKey,
		target: elements[index] as unknown as EventTarget,
		preventDefault() {
			prevented = true;
		}
	});
	handleScriptTab(event(0));
	expect(focused).toBe('answer');
	expect(prevented).toBe(true);
	handleScriptTab(event(6, true));
	expect(focused).toBe('answer');
	handleScriptTab(event(4));
	expect(focused).toBe('last');
});
