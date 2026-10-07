import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScriptDoc} from '@/scriptDoc/ScriptDoc';
import {SCRIPT_DOC} from '@/scriptDoc/content';
import {
	buildAnchorIndex,
	exitOf,
	findBrokenLinks,
	isBlockVisible
} from '@/scriptDoc/core';
import type {Block} from '@/scriptDoc/types';

const ANCHORS = buildAnchorIndex(SCRIPT_DOC);
const visible = (b: Block, mode: 'live' | 'training') =>
	isBlockVisible(b, mode, SCRIPT_DOC, ANCHORS);

describe('script doc Live / Training modes (ENG-298)', () => {
	it('live hides purple guidance; training shows it', () => {
		const inst: Block = {t: 'inst', title: 'Why', body: ['x']};
		expect(visible(inst, 'live')).toBe(false);
		expect(visible(inst, 'training')).toBe(true);
	});

	it('live hides stage notes that only point at emotional triggers', () => {
		const triggerNote: Block = {
			t: 'note',
			text: 'Only want cremation? → [Cremation-only trigger](#trg-cremation)'
		};
		const plainNote: Block = {t: 'note', text: 'Wait for confirmation.'};
		const objectionNote: Block = {
			t: 'note',
			text: 'Push back → [Already Have Insurance](#obj-have-insurance).'
		};
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
			expect(
				SCRIPT_DOC.find((n) => n.id === ANCHORS.get(exit!.to)?.nodeId)?.group
			).toBe('script');
		}
	});

	it('has no broken links', () => {
		expect(findBrokenLinks(SCRIPT_DOC, ANCHORS)).toEqual([]);
	});
});

describe('ScriptDoc render', () => {
	it('places a large vertical objection picker before any response in both modes', () => {
		for (const initialMode of ['live', 'training'] as const) {
			const html = renderToStaticMarkup(
				createElement(ScriptDoc, {initialMode})
			);
			const picker = html.match(
				/<section[^>]*aria-label="Choose an objection"[\s\S]*?<\/section>/
			)?.[0];
			expect(picker).toBeDefined();
			expect(picker).toContain('Which objection are you hearing?');
			expect(picker).toContain('min-h-full');
			expect(picker).toContain('flex-col');
			expect(picker?.match(/<button/g)).toHaveLength(
				SCRIPT_DOC.filter((n) => n.group === 'objections').length
			);
			expect(picker?.match(/min-h-14/g)).toHaveLength(8);
			expect(picker?.match(/bg-background/g)).toHaveLength(8);
			expect(picker?.match(/border-rose-200/g)).toHaveLength(8);
			expect(picker?.match(/text-rose-700/g)).toHaveLength(9); // Heading plus eight buttons.
			expect(picker).not.toContain('bg-rose-700');
			expect(html.indexOf('data-anchor="objection-picker"')).toBeLessThan(
				html.indexOf('data-anchor="obj-free"')
			);
		}
	});

	it('starts in Live mode: no purple guidance, no Emotional Triggers button', () => {
		const html = renderToStaticMarkup(createElement(ScriptDoc));
		expect(html).toContain('aria-label="Script options"');
		expect(html).toContain('aria-haspopup="menu"');
		expect(html).not.toContain('Reset choices');
		expect(html).not.toContain('role="radio"');
		expect(html).toContain('grid-flow-col gap-2');
		expect(html).not.toContain('Motivation first, then situation');
		expect(html).not.toContain('Emotional Triggers</button>');
		expect(html).toContain('aria-label="Script view"');
		expect(html).toMatch(
			/<button[^>]*aria-pressed="true"[^>]*>Main Flow<\/button>/
		);
		expect(html).toMatch(
			/<button[^>]*aria-pressed="false"[^>]*>Objections<\/button>/
		);
		expect(html).toContain('Is this your first time looking into these plans?');
	});

	it('training uses the same three-way selector and fixed title as the practice frontend', () => {
		const html = renderToStaticMarkup(
			createElement(ScriptDoc, {initialMode: 'training'})
		);
		expect(html).toMatch(
			/<button[^>]*aria-pressed="true"[^>]*>Main Flow<\/button>/
		);
		expect(html).toMatch(
			/<button[^>]*aria-pressed="false"[^>]*>Objections<\/button>/
		);
		expect(html).toMatch(
			/<button[^>]*aria-pressed="false"[^>]*>Emotional Triggers<\/button>/
		);
		expect(html.match(/Final Expense Full Script/g)).toHaveLength(1);
		expect(html).toContain('Motivation first, then situation');
		expect(html).not.toContain('Open Common Objections');
		expect(html).not.toContain('Hide Common Objections');
	});
});
