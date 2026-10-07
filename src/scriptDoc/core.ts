/** Pure helpers for the hyperlinked script doc. */

import type {AnchorInfo, Block, BlankSource, DocNode, ScriptMode, ScriptValues} from './types';

export type InlineToken =
	| {type: 'text'; text: string}
	| {type: 'bold'; text: string}
	/** `{{placeholder}}` or `{{placeholder|source}}`; an empty placeholder renders nothing until filled. */
	| {type: 'blank'; text: string; source?: string}
	| {type: 'link'; text: string; to: string};

const INLINE_RE = /\[([^\]]+)\]\(#([^)]+)\)|\*\*([^*]+)\*\*|\{\{([^}]+)\}\}/g;

/** Split `[label](#id)`, `**bold**`, `{{blank}}` / `{{blank|source}}` out of a plain string. */
export function parseInline(text: string): InlineToken[] {
	const out: InlineToken[] = [];
	let last = 0;
	for (const m of text.matchAll(INLINE_RE)) {
		const at = m.index ?? 0;
		if (at > last) out.push({type: 'text', text: text.slice(last, at)});
		if (m[1] !== undefined) out.push({type: 'link', text: m[1], to: m[2]});
		else if (m[3] !== undefined) out.push({type: 'bold', text: m[3]});
		else {
			const [placeholder, source] = m[4].split('|');
			out.push(source === undefined ? {type: 'blank', text: placeholder} : {type: 'blank', text: placeholder, source: source.trim()});
		}
		last = at + m[0].length;
	}
	if (last < text.length) out.push({type: 'text', text: text.slice(last)});
	return out;
}

/** Every jump target in the doc: nodes, paths (green), and headings with ids. */
export function buildAnchorIndex(doc: DocNode[]): Map<string, AnchorInfo> {
	const index = new Map<string, AnchorInfo>();
	const walk = (blocks: Block[], node: DocNode) => {
		for (const b of blocks) {
			if (b.t === 'path') {
				index.set(b.id, {id: b.id, kind: 'path', label: b.label, nodeId: node.id});
				walk(b.blocks, node);
			} else if (b.t === 'h' && b.id) {
				index.set(b.id, {id: b.id, kind: node.kind, label: `${node.short ?? node.title} · ${b.text}`, nodeId: node.id});
			}
		}
	};
	for (const node of doc) {
		index.set(node.id, {id: node.id, kind: node.kind, label: node.short ?? node.title, nodeId: node.id});
		walk(node.blocks, node);
	}
	return index;
}

/**
 * Path id → its sibling path ids (every path offered by the same choices
 * block). Picking one path grays out the rest of its group.
 */
export function buildPathGroups(doc: DocNode[], index: Map<string, AnchorInfo>): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	const walk = (blocks: Block[]) => {
		for (const b of blocks) {
			if (b.t === 'choices') {
				const paths = b.options.map((o) => o.to).filter((to) => index.get(to)?.kind === 'path');
				if (paths.length > 1) for (const p of paths) groups.set(p, paths);
			} else if (b.t === 'path') walk(b.blocks);
		}
	};
	doc.forEach((n) => walk(n.blocks));
	return groups;
}

/** True when `text` links to an Emotional Triggers node (training-only material). */
function linksToTriggers(text: string, doc: DocNode[], index: Map<string, AnchorInfo>): boolean {
	return parseInline(text).some((tok) => {
		if (tok.type !== 'link') return false;
		const nodeId = index.get(tok.to)?.nodeId;
		return doc.some((n) => n.id === nodeId && n.group === 'triggers');
	});
}

/**
 * Live mode keeps what the agent says, the choices, and the headings. It drops
 * the purple guidance boxes and any stage note that only points at
 * emotional-trigger coaching. Training mode shows everything.
 */
export function isBlockVisible(b: Block, mode: ScriptMode, doc: DocNode[], index: Map<string, AnchorInfo>): boolean {
	if (mode === 'training') return true;
	if (b.t === 'inst') return false;
	if (b.t === 'note') return !linksToTriggers(b.text, doc, index);
	return true;
}

/** Where an objection's "Objection handled" button returns to, if it has one. */
export function exitOf(node: DocNode | undefined): {to: string; label: string} | null {
	const exit = node?.blocks.find((b) => b.t === 'exit');
	return exit?.t === 'exit' ? {to: exit.to, label: exit.label} : null;
}

/** Every source a `{{placeholder|source}}` blank may name (ENG-298). */
export const BLANK_SOURCES: ReadonlySet<BlankSource> = new Set<BlankSource>([
	'agent_name',
	'lead_name',
	'mailing_address',
	'first_name',
	'last_name',
	'phone',
	'email',
	'state',
	'sob',
	'dob',
	'height',
	'weight'
]);

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** A form field's display text: a select's option label ("New Hampshire (NH)" → "New Hampshire"), else the raw value. */
function formText(key: string, values: ScriptValues): string {
	const raw = asText(values.formData?.[key]);
	if (!raw) return '';
	const option = values.formSchema?.find((f) => f.key === key)?.options?.find((o) => o.value === raw);
	return option ? option.label.replace(/\s*\([A-Z]{2}\)$/, '').trim() : raw;
}

/** Live value for a blank's source, or '' (the placeholder shows) when it isn't known yet. */
export function resolveBlank(source: string, values: ScriptValues): string {
	const form = (key: string) => asText(values.formData?.[key]);
	switch (source as BlankSource) {
		case 'agent_name':
			return asText(values.agentName);
		case 'lead_name':
			return [form('first_name'), form('last_name')].filter(Boolean).join(' ');
		case 'mailing_address': {
			const street = [form('address'), form('address2')].filter(Boolean).join(' ');
			const region = [form('state'), form('zip')].filter(Boolean).join(' ');
			return [street, form('city'), region].filter(Boolean).join(', ');
		}
		case 'first_name':
		case 'last_name':
		case 'phone':
		case 'email':
		case 'state':
		case 'sob':
		case 'dob':
		case 'height':
		case 'weight':
			return formText(source, values);
		default:
			return '';
	}
}

/** Blank sources that aren't in BLANK_SOURCES — handy while editing content. */
export function findUnknownBlankSources(doc: DocNode[]): string[] {
	const unknown: string[] = [];
	const scan = (text: string) => {
		for (const tok of parseInline(text))
			if (tok.type === 'blank' && tok.source !== undefined && !BLANK_SOURCES.has(tok.source as BlankSource)) unknown.push(tok.source);
	};
	const walk = (blocks: Block[]) => {
		for (const b of blocks) {
			if (b.t === 'say' || b.t === 'note' || b.t === 'caller' || b.t === 'warn') scan(b.text);
			else if (b.t === 'list') b.items.forEach(scan);
			else if (b.t === 'inst') b.body.forEach(scan);
			else if (b.t === 'path') walk(b.blocks);
		}
	};
	doc.forEach((n) => walk(n.blocks));
	return unknown;
}

/** Link targets that don't resolve — handy while editing content. */
export function findBrokenLinks(doc: DocNode[], index: Map<string, AnchorInfo>): string[] {
	const broken: string[] = [];
	const check = (to: string) => {
		if (!index.has(to)) broken.push(to);
	};
	const scan = (text: string) => {
		for (const tok of parseInline(text)) if (tok.type === 'link') check(tok.to);
	};
	const walk = (blocks: Block[]) => {
		for (const b of blocks) {
			if (b.t === 'say' || b.t === 'note' || b.t === 'caller' || b.t === 'warn') scan(b.text);
			else if (b.t === 'list') b.items.forEach(scan);
			else if (b.t === 'inst') b.body.forEach(scan);
			else if (b.t === 'choices') b.options.forEach((o) => check(o.to));
			else if (b.t === 'exit') check(b.to);
			else if (b.t === 'path') walk(b.blocks);
		}
	};
	doc.forEach((n) => walk(n.blocks));
	return broken;
}
