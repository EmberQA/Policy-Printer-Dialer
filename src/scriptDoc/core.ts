/** Pure helpers for the hyperlinked script doc. */

import type {AnchorInfo, Block, DocNode} from './types';

export type InlineToken =
	| {type: 'text'; text: string}
	| {type: 'bold'; text: string}
	| {type: 'blank'; text: string}
	| {type: 'link'; text: string; to: string};

const INLINE_RE = /\[([^\]]+)\]\(#([^)]+)\)|\*\*([^*]+)\*\*|\{\{([^}]+)\}\}/g;

/** Split `[label](#id)`, `**bold**`, `{{blank}}` out of a plain string. */
export function parseInline(text: string): InlineToken[] {
	const out: InlineToken[] = [];
	let last = 0;
	for (const m of text.matchAll(INLINE_RE)) {
		const at = m.index ?? 0;
		if (at > last) out.push({type: 'text', text: text.slice(last, at)});
		if (m[1] !== undefined) out.push({type: 'link', text: m[1], to: m[2]});
		else if (m[3] !== undefined) out.push({type: 'bold', text: m[3]});
		else out.push({type: 'blank', text: m[4]});
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
