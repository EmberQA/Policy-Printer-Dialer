/**
 * Call script transition engine (ENG-278) — pure functions, no React, no I/O.
 *
 * The session lives only in the browser for the duration of one call. Every
 * function returns a NEW session (never mutates), so the provider can keep an
 * undo history and React re-renders on identity change.
 *
 * Graphs reaching this module were validated server-side (validateScriptGraph),
 * so ids resolve; the engine still degrades safely (no-op) on a bad id.
 *
 * Return-stack rule: entering an OBJECTION / TRIGGER heading pushes the current
 * step; `return` pops it. Landing on a FLOW step by any other route (a node
 * target like "→ Pitch, adjust coverage", or an outline jump) clears the stack —
 * the agent has left the override for good, so nothing is left to return to.
 */

import type {
	ScriptAction,
	ScriptChoice,
	ScriptGraph,
	ScriptHeading,
	ScriptHeadingRole,
	ScriptLeadColumn,
	ScriptNodeId,
	ScriptSession,
	ScriptStep,
	ScriptTarget,
	ScriptVarDef,
	ScriptVarKey,
	ScriptVarValue,
	ScriptVarWriteSource
} from './types';

/* -------------------------------------------------------------------------- */
/* Index                                                                      */
/* -------------------------------------------------------------------------- */

export interface ScriptIndex {
	graph: ScriptGraph;
	steps: Map<ScriptNodeId, ScriptStep>;
	headings: Map<ScriptNodeId, ScriptHeading>;
	vars: Map<ScriptVarKey, ScriptVarDef>;
}

export const indexGraph = (graph: ScriptGraph): ScriptIndex => {
	const steps = new Map<ScriptNodeId, ScriptStep>();
	const headings = new Map<ScriptNodeId, ScriptHeading>();
	for (const n of graph.nodes) {
		if (n.type === 'heading') headings.set(n.id, n);
		else steps.set(n.id, n);
	}
	return {
		graph,
		steps,
		headings,
		vars: new Map(graph.vars.map((v) => [v.key, v]))
	};
};

/** The chain of headings from the step's own heading up to its level-1 root. */
export const headingChain = (
	ix: ScriptIndex,
	headingId: ScriptNodeId
): ScriptHeading[] => {
	const chain: ScriptHeading[] = [];
	let h = ix.headings.get(headingId);
	while (h && chain.length < 8) {
		chain.push(h);
		h = h.parent_id ? ix.headings.get(h.parent_id) : undefined;
	}
	return chain;
};

export const stepRole = (
	ix: ScriptIndex,
	stepId: ScriptNodeId
): ScriptHeadingRole => {
	const step = ix.steps.get(stepId);
	if (!step) return 'flow';
	const chain = headingChain(ix, step.heading_id);
	return chain[chain.length - 1]?.role ?? 'flow';
};

const isOverride = (role: ScriptHeadingRole) =>
	role === 'objection' || role === 'trigger';

/* -------------------------------------------------------------------------- */
/* Session + variables                                                        */
/* -------------------------------------------------------------------------- */

export type VarSeed = Record<
	ScriptVarKey,
	{value: ScriptVarValue; source: ScriptVarWriteSource}
>;

const hasValue = (v: unknown): boolean =>
	v !== undefined && v !== null && v !== '';

export const createSession = (
	ix: ScriptIndex,
	seed: VarSeed = {},
	now: string = new Date().toISOString()
): ScriptSession => {
	const vars: ScriptSession['vars'] = {};
	for (const [key, {value, source}] of Object.entries(seed)) {
		if (ix.vars.has(key) && hasValue(value))
			vars[key] = {value, source, updated_at: now};
	}
	const start: ScriptSession = {
		current_node_id: ix.graph.start_node_id,
		return_stack: [],
		vars,
		choice_uses: {},
		outcome: null,
		ended: false,
		tags: [],
		path: []
	};
	return enter(ix, start, ix.graph.start_node_id, {keepStack: true});
};

/** Last write wins. An empty value clears the var (the field was emptied). */
export const commitVar = (
	session: ScriptSession,
	key: ScriptVarKey,
	value: ScriptVarValue | null | undefined,
	source: ScriptVarWriteSource,
	now: string = new Date().toISOString()
): ScriptSession => {
	const vars = {...session.vars};
	if (!hasValue(value)) {
		if (!(key in vars)) return session;
		delete vars[key];
	} else {
		const prev = vars[key];
		if (prev && prev.value === value && prev.source === source) return session;
		vars[key] = {value: value as ScriptVarValue, source, updated_at: now};
	}
	return {...session, vars};
};

export const varValue = (
	session: ScriptSession,
	key: ScriptVarKey
): ScriptVarValue | undefined => session.vars[key]?.value;

/** Display form of a var: currency as $, choice as its label, booleans as Yes/No. */
export const formatVar = (
	def: ScriptVarDef | undefined,
	value: ScriptVarValue
): string => {
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	const kind = def?.input?.kind;
	if (kind === 'currency') {
		const n = Number(String(value).replace(/[$,\s]/g, ''));
		return Number.isFinite(n)
			? `$${n.toLocaleString('en-US', {maximumFractionDigits: 2})}`
			: String(value);
	}
	if (def?.input?.kind === 'choice') {
		const opt = def.input.config?.options.find((o) => o.value === value);
		if (opt) return opt.label;
	}
	return String(value);
};

export const BLANK = '____';

export type TextPart =
	| {kind: 'text'; text: string}
	| {kind: 'var'; key: string; text: string; filled: boolean};

/** `{{var}}` → value | fallback | blank, split into parts so the UI can style
 *  filled vs. missing placeholders. */
export const resolveTextParts = (
	ix: ScriptIndex,
	session: ScriptSession,
	text: string
): TextPart[] => {
	const parts: TextPart[] = [];
	const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
	let last = 0;
	for (const m of text.matchAll(re)) {
		if (m.index! > last)
			parts.push({kind: 'text', text: text.slice(last, m.index)});
		const key = m[1];
		const def = ix.vars.get(key);
		const value = varValue(session, key);
		parts.push(
			value !== undefined
				? {kind: 'var', key, text: formatVar(def, value), filled: true}
				: {kind: 'var', key, text: def?.fallback ?? BLANK, filled: false}
		);
		last = m.index! + m[0].length;
	}
	if (last < text.length) parts.push({kind: 'text', text: text.slice(last)});
	return parts;
};

export const resolveText = (
	ix: ScriptIndex,
	session: ScriptSession,
	text: string
): string =>
	resolveTextParts(ix, session, text)
		.map((p) => p.text)
		.join('');

/* -------------------------------------------------------------------------- */
/* Step queries                                                               */
/* -------------------------------------------------------------------------- */

export const currentStep = (
	ix: ScriptIndex,
	session: ScriptSession
): ScriptStep | undefined => ix.steps.get(session.current_node_id);

/** Choices still offered: `max_uses` exhausted ones are hidden. */
export const availableChoices = (
	session: ScriptSession,
	step: ScriptStep
): ScriptChoice[] =>
	(step.choices ?? []).filter(
		(c) =>
			c.max_uses === undefined ||
			(session.choice_uses[choiceUseKey(step.id, c.id)] ?? 0) < c.max_uses
	);

const choiceUseKey = (stepId: string, choiceId: string) =>
	`${stepId}:${choiceId}`;

/** Vars that must be set before the agent can leave this step. */
export const missingVars = (
	session: ScriptSession,
	step: ScriptStep
): ScriptVarKey[] => {
	const needed = new Set<ScriptVarKey>(step.requires ?? []);
	if (step.type === 'capture' && step.data.required && step.data.var)
		needed.add(step.data.var);
	if (step.type === 'checklist') {
		for (const item of step.data.items)
			if (item.required && item.var) needed.add(item.var);
	}
	return [...needed].filter((k) => !hasValue(session.vars[k]?.value));
};

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

const applyActions = (
	session: ScriptSession,
	actions: ScriptAction[] | undefined,
	now: string
): ScriptSession => {
	let s = session;
	for (const a of actions ?? []) {
		switch (a.type) {
			case 'set_var':
				s = commitVar(s, a.params.key, a.params.value, 'action', now);
				break;
			case 'set_outcome':
				s = {...s, outcome: a.params.outcome};
				break;
			case 'tag':
				if (!s.tags.includes(a.params.tag))
					s = {...s, tags: [...s.tags, a.params.tag]};
				break;
			case 'integration':
				// v1: no integrations are wired; the hook exists so graphs can
				// declare them now.
				if (import.meta.env?.DEV)
					console.info('[script] integration (no-op)', a.params.integration);
				break;
		}
	}
	return s;
};

function enter(
	ix: ScriptIndex,
	session: ScriptSession,
	stepId: ScriptNodeId,
	opts: {keepStack?: boolean; choiceId?: string; now?: string} = {}
): ScriptSession {
	const step = ix.steps.get(stepId);
	if (!step) return session;
	const now = opts.now ?? new Date().toISOString();
	const clearStack = !opts.keepStack && !isOverride(stepRole(ix, stepId));
	const next: ScriptSession = {
		...session,
		current_node_id: stepId,
		return_stack: clearStack ? [] : session.return_stack,
		path: [
			...session.path,
			{node_id: stepId, ...(opts.choiceId ? {choice_id: opts.choiceId} : {})}
		]
	};
	return applyActions(next, step.on_enter, now);
}

const navigate = (
	ix: ScriptIndex,
	session: ScriptSession,
	target: ScriptTarget,
	opts: {choiceId?: string; now?: string} = {}
): ScriptSession => {
	switch (target.kind) {
		case 'node':
			return enter(ix, session, target.node_id, opts);
		case 'heading': {
			const h = ix.headings.get(target.heading_id);
			if (!h?.entry_node_id) return session;
			if (isOverride(headingChain(ix, h.id).at(-1)?.role ?? h.role)) {
				const pushed = {
					...session,
					return_stack: [...session.return_stack, session.current_node_id]
				};
				return enter(ix, pushed, h.entry_node_id, {...opts, keepStack: true});
			}
			return enter(ix, session, h.entry_node_id, opts);
		}
		case 'return': {
			const stack = [...session.return_stack];
			const back = stack.pop() ?? target.fallback;
			return enter(ix, {...session, return_stack: stack}, back, {
				...opts,
				keepStack: true
			});
		}
		case 'end':
			return {...session, outcome: target.outcome, ended: true};
	}
};

/**
 * Leave the current step: by `choiceId` for a choice-routed step, otherwise via
 * `next`. Refused (session returned unchanged) while required vars are missing
 * or when the choice isn't currently offered.
 */
export const advance = (
	ix: ScriptIndex,
	session: ScriptSession,
	opts: {choiceId?: string; now?: string} = {}
): ScriptSession => {
	const step = currentStep(ix, session);
	if (!step || session.ended) return session;
	if (missingVars(session, step).length > 0) return session;
	const now = opts.now ?? new Date().toISOString();

	if (step.choices) {
		const choice = availableChoices(session, step).find(
			(c) => c.id === opts.choiceId
		);
		if (!choice) return session;
		const key = choiceUseKey(step.id, choice.id);
		let s: ScriptSession = {
			...session,
			choice_uses: {
				...session.choice_uses,
				[key]: (session.choice_uses[key] ?? 0) + 1
			}
		};
		s = applyActions(s, choice.actions, now);
		return navigate(ix, s, choice.target, {choiceId: choice.id, now});
	}
	return navigate(ix, session, step.next, {now});
};

/** Outline / quick-jump. Overrides push the current step so they can return. */
export const jumpToHeading = (
	ix: ScriptIndex,
	session: ScriptSession,
	headingId: ScriptNodeId
): ScriptSession =>
	navigate(
		ix,
		{...session, ended: false},
		{kind: 'heading', heading_id: headingId}
	);

/**
 * Leave the current objection/trigger early: pop back to where it was raised.
 * No-op when nothing is on the stack.
 */
export const resume = (
	ix: ScriptIndex,
	session: ScriptSession
): ScriptSession => {
	const top = session.return_stack.at(-1);
	return top
		? navigate(ix, session, {kind: 'return', fallback: top})
		: session;
};

/**
 * Undo: restore the previous snapshot's position but keep everything captured
 * since (vars are the agent's work — Back must never erase what they typed).
 */
export const goBack = (
	previous: ScriptSession,
	current: ScriptSession
): ScriptSession => ({...previous, vars: current.vars});

/* -------------------------------------------------------------------------- */
/* Lead-form bindings                                                         */
/* -------------------------------------------------------------------------- */

/** Vars fed by a form field (direction in | both), for the bound form. */
export const varsForFormField = (
	ix: ScriptIndex,
	formKey: string,
	field: string
): ScriptVarKey[] =>
	ix.graph.vars
		.filter((v) =>
			(v.bindings ?? []).some(
				(b) =>
					b.target === 'form_field' &&
					b.form === formKey &&
					b.field === field &&
					b.direction !== 'out'
			)
		)
		.map((v) => v.key);

/** Vars fed by a read-only lead column. */
export const varsForLeadColumn = (
	ix: ScriptIndex,
	column: ScriptLeadColumn
): ScriptVarKey[] =>
	ix.graph.vars
		.filter((v) =>
			(v.bindings ?? []).some(
				(b) => b.target === 'lead_column' && b.column === column
			)
		)
		.map((v) => v.key);

/** Form fields a var writes to (direction out | both), for the bound form. */
export const formFieldsForVar = (
	ix: ScriptIndex,
	formKey: string,
	key: ScriptVarKey
): string[] =>
	(ix.vars.get(key)?.bindings ?? []).flatMap((b) =>
		b.target === 'form_field' && b.form === formKey && b.direction !== 'in'
			? [b.field]
			: []
	);

/** The inbound caller id, or null when the carrier gave us nothing usable. */
export const normalizeCallerPhone = (raw: string | null | undefined) => {
	const v = (raw ?? '').trim();
	return v && v.toLowerCase() !== 'unknown' ? v : null;
};
