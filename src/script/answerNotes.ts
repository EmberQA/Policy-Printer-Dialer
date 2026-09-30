import type {ScriptGraph, ScriptSession, ScriptVarDef} from './types';

export type AnswerLines = Record<string, string>;
const present = (value: unknown) =>
	value !== undefined && value !== null && value !== '';

export function answerLabel(def: ScriptVarDef, value: unknown): string {
	if (def.input?.kind === 'boolean')
		return value === true || value === 'true'
			? (def.input.config?.true_label ?? 'Yes')
			: value === false || value === 'false'
				? (def.input.config?.false_label ?? 'No')
				: String(value);
	if (def.input?.kind === 'choice')
		return (
			def.input.config?.options.find((o) => o.value === String(value))?.label ??
			String(value)
		);
	return String(value);
}

/** Answers already represented by a real lead field stay in that field. */
export function scriptAnswerLines(
	graph: ScriptGraph,
	session: ScriptSession,
	formKey: string | null | undefined,
	fields: Array<string | {key: string; options?: Array<{value: string}>}>
): AnswerLines {
	const lines: AnswerLines = {};
	const hasField = (def: ScriptVarDef, value: unknown) =>
		def.bindings?.some((b) => {
			if (
				b.target !== 'form_field' ||
				b.direction === 'in' ||
				(formKey !== undefined && b.form !== formKey)
			)
				return false;
			const field = fields.find(
				(field) => (typeof field === 'string' ? field : field.key) === b.field
			);
			if (!field) return false;
			return (
				typeof field === 'string' ||
				!field.options?.length ||
				field.options.some((o) => o.value === String(value))
			);
		});
	for (const def of graph.vars) {
		const state = session.vars[def.key];
		if (
			def.source === 'agent' ||
			hasField(def, state?.value) ||
			!state ||
			!present(state.value) ||
			(state.source !== 'capture' && state.source !== 'action')
		)
			continue;
		lines[def.key] = `${def.label}: ${answerLabel(def, state.value)}`;
	}
	for (const [id, choiceId] of Object.entries(session.answers ?? {})) {
		const step = graph.nodes.find((n) => n.id === id);
		if (!step || step.type === 'heading' || !step.choices) continue;
		const choice = step.choices.find((c) => c.id === choiceId);
		if (!choice) continue;
		// A set_var answer is already represented by its field or line above.
		if (choice.actions?.some((a) => a.type === 'set_var')) continue;
		const heading = graph.nodes.find((n) => n.id === step.heading_id);
		const label = heading?.type === 'heading' ? heading.title : 'Response';
		lines[`choice:${id}`] = `${label}: ${choice.label}`;
	}
	return lines;
}

/** Update only our exact previous lines. Agent-written text is left intact. */
export function mergeAnswerNotes(
	notes: string,
	previous: AnswerLines,
	next: AnswerLines
): string {
	let text = notes;
	for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
		const before = previous[key],
			after = next[key];
		if (before === after) continue;
		const padded = `\n${text}\n`;
		const at = before ? padded.lastIndexOf(`\n${before}\n`) : -1;
		if (at >= 0) {
			text = text.slice(0, at) + (after ?? '') + text.slice(at + before.length);
		} else if (after) {
			text += `${text && !text.endsWith('\n') ? '\n' : ''}${after}`;
		}
	}
	return text;
}
