import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScriptDoc} from '@/scriptDoc/ScriptDoc';
import {SCRIPT_DOC} from '@/scriptDoc/content';
import {buildAnchorIndex, exitOf, findBrokenLinks, isBlockVisible} from '@/scriptDoc/core';
import type {Block} from '@/scriptDoc/types';

const ANCHORS = buildAnchorIndex(SCRIPT_DOC);
const visible = (b: Block, mode: 'live' | 'training') => isBlockVisible(b, mode, SCRIPT_DOC, ANCHORS);

describe('script doc Live / Training modes (ENG-298)', () => {
	it('live hides purple guidance; training shows it', () => {
		const inst: Block = {t: 'inst', title: 'Why', body: ['x']};
		expect(visible(inst, 'live')).toBe(false);
		expect(visible(inst, 'training')).toBe(true);
	});

	it('live hides stage notes that only point at emotional triggers', () => {
		const triggerNote: Block = {t: 'note', text: 'Only want cremation? → [Cremation-only trigger](#trg-cremation)'};
		const plainNote: Block = {t: 'note', text: 'Wait for confirmation.'};
		const objectionNote: Block = {t: 'note', text: 'Push back → [Already Have Insurance](#obj-have-insurance).'};
		expect(visible(triggerNote, 'live')).toBe(false);
		expect(visible(triggerNote, 'training')).toBe(true);
		expect(visible(plainNote, 'live')).toBe(true);
		expect(visible(objectionNote, 'live')).toBe(true);
	});

	it('live keeps spoken lines, choices, headings and paths', () => {
		for (const b of [
			{t: 'say', text: 'Hi.'},
			{t: 'h', text: 'Opening'},
			{t: 'choices', options: [{label: 'Healthy', to: 'med-healthy'}]},
			{t: 'path', id: 'p', label: 'If YES', blocks: []}
		] as Block[])
			expect(visible(b, 'live')).toBe(true);
	});

	it('every objection has a "continue" exit into the script', () => {
		for (const node of SCRIPT_DOC.filter((n) => n.group === 'objections')) {
			const exit = exitOf(node);
			expect(exit, node.id).not.toBeNull();
			expect(SCRIPT_DOC.find((n) => n.id === ANCHORS.get(exit!.to)?.nodeId)?.group).toBe('script');
		}
	});

	it('has no broken links', () => {
		expect(findBrokenLinks(SCRIPT_DOC, ANCHORS)).toEqual([]);
	});
});

describe('ScriptDoc render', () => {
	it('starts in Live mode: no purple guidance, no Emotional Triggers button', () => {
		const html = renderToStaticMarkup(createElement(ScriptDoc));
		expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>live</);
		expect(html).not.toContain('Motivation first, then situation');
		expect(html).not.toContain('Emotional Triggers</button>');
		expect(html).toContain('Open Common Objections');
		expect(html).toContain('Is this your first time looking into these plans?');
	});
});
