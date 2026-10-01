/**
 * Hyperlinked script doc (playground — separate from the ENG-278 script
 * engine). A doc is a flat list of nodes; any node, path, or heading with an
 * `id` is a jump target. Inline text supports a tiny markup:
 *   [label](#target-id)   link — colored by the TARGET's kind
 *   **bold**              emphasis
 *   {{blank}}             fill-in blank (agent name, amount, …)
 */

/** Drives link + header color. objection=red, path=green, section=blue, trigger=amber, reference=violet. */
export type AnchorKind = 'section' | 'objection' | 'path' | 'trigger' | 'reference';

export type DocGroup = 'script' | 'objections' | 'triggers';

export type Block =
	/** Sub-heading; give it an id to make it linkable. */
	| {t: 'h'; text: string; id?: string}
	/** Read-aloud agent line — the brightest text on the page. */
	| {t: 'say'; text: string}
	/** What the caller says. */
	| {t: 'caller'; text: string}
	/** Stage direction / what the agent DOES (dim italic). */
	| {t: 'note'; text: string}
	| {t: 'list'; ordered?: boolean; items: string[]}
	/** Agent instruction callout (violet box). */
	| {t: 'inst'; title: string; body: string[]}
	/** Hard rule / don't-do-this (red box). */
	| {t: 'warn'; text: string}
	/** Step label inside a rebuttal flow ("Step 1: Acknowledge"). */
	| {t: 'step'; text: string}
	/** Branch buttons — each jumps to a target. */
	| {t: 'choices'; prompt?: string; options: {label: string; to: string}[]}
	/** Escape hatch out of an objection back into the script (closes the panel). */
	| {t: 'exit'; to: string; label: string}
	/** A named branch (green), itself a jump target. */
	| {t: 'path'; id: string; label: string; blocks: Block[]};

export interface DocNode {
	id: string;
	kind: AnchorKind;
	group: DocGroup;
	/** Small label above the title, e.g. "Section 2" or "Objection 4". */
	eyebrow?: string;
	title: string;
	/** Short name for the TOC / breadcrumb when the title is long. */
	short?: string;
	blocks: Block[];
}

export interface AnchorInfo {
	id: string;
	kind: AnchorKind;
	label: string;
	/** Top-level node this anchor lives in. */
	nodeId: string;
}
