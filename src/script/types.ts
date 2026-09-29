/**
 * Call script graph types (ENG-278).
 *
 * Hand-copied from EmberQA-Backend
 * bespoke_features/policy_printer/callScript/types.ts — that file is the source
 * of truth and carries the full field docs. Backend enums are string-literal
 * unions here (same wire values; this app uses no enums).
 */

export type ScriptNodeId = string;
export type ScriptVarKey = string;
export type ScriptVarValue = string | number | boolean;

/* Headings ----------------------------------------------------------------- */

export type ScriptHeadingLevel = 1 | 2 | 3;
export type ScriptHeadingRole = 'flow' | 'objection' | 'trigger' | 'reference';

export interface ScriptHeading {
	id: ScriptNodeId;
	type: 'heading';
	level: ScriptHeadingLevel;
	parent_id: ScriptNodeId | null;
	title: string;
	role: ScriptHeadingRole;
	entry_node_id: ScriptNodeId | null;
	sort: number;
	cue_phrases?: string[];
	notes?: string[];
}

/* Text --------------------------------------------------------------------- */

export interface ScriptText {
	text: string;
	variants?: string[];
}

export interface ScriptInstruction {
	text: string;
	tone?: 'info' | 'warn';
}

/* Actions ------------------------------------------------------------------ */

export type ScriptOutcome =
	'sale' | 'no_sale' | 'callback' | 'redirected' | 'disqualified';

export interface ScriptActionRegistry {
	set_var: {key: ScriptVarKey; value: ScriptVarValue};
	set_outcome: {outcome: ScriptOutcome};
	tag: {tag: string};
	integration: {integration: string; params?: Record<string, ScriptVarValue>};
}
export type ScriptActionType = keyof ScriptActionRegistry;
export type ScriptActionOf<T extends ScriptActionType> = {
	type: T;
	params: ScriptActionRegistry[T];
	blocking?: boolean;
};
export type ScriptAction = {
	[T in ScriptActionType]: ScriptActionOf<T>;
}[ScriptActionType];

/* Routing ------------------------------------------------------------------ */

export type ScriptTarget =
	| {kind: 'node'; node_id: ScriptNodeId}
	| {kind: 'heading'; heading_id: ScriptNodeId}
	| {kind: 'return'; fallback: ScriptNodeId}
	| {kind: 'end'; outcome: ScriptOutcome};

export interface ScriptChoice {
	id: string;
	label: string;
	examples?: string[];
	say?: ScriptText;
	actions?: ScriptAction[];
	target: ScriptTarget;
	max_uses?: number;
}

export interface ScriptNextRouting {
	next: ScriptTarget;
	choices?: never;
}
export interface ScriptChoiceRouting {
	choices: ScriptChoice[];
	next?: never;
}
export type ScriptRouting = ScriptNextRouting | ScriptChoiceRouting;

/* Steps -------------------------------------------------------------------- */

export interface ScriptCaptureData {
	var?: ScriptVarKey;
	required?: boolean;
}
export interface ScriptChecklistItem extends ScriptCaptureData {
	id: string;
	say: ScriptText;
}
export interface ScriptChecklistData {
	items: ScriptChecklistItem[];
}

export interface ScriptStepRegistry {
	say: {data: Record<string, never>; routing: ScriptRouting};
	ask: {data: Record<string, never>; routing: ScriptChoiceRouting};
	capture: {data: ScriptCaptureData; routing: ScriptNextRouting};
	checklist: {data: ScriptChecklistData; routing: ScriptNextRouting};
}
export type ScriptStepType = keyof ScriptStepRegistry;

export interface ScriptStepCommon {
	id: ScriptNodeId;
	heading_id: ScriptNodeId;
	say?: ScriptText;
	instructions?: ScriptInstruction[];
	on_enter?: ScriptAction[];
	requires?: ScriptVarKey[];
}
export type ScriptStepOf<T extends ScriptStepType> = ScriptStepCommon & {
	type: T;
	data: ScriptStepRegistry[T]['data'];
} & ScriptStepRegistry[T]['routing'];
export type ScriptStep = {
	[T in ScriptStepType]: ScriptStepOf<T>;
}[ScriptStepType];

export type ScriptNode = ScriptHeading | ScriptStep;

/* Variables, inputs, bindings ----------------------------------------------- */

export interface ScriptInputRegistry {
	text: {max_length?: number; multiline?: boolean};
	phone: Record<string, never>;
	email: Record<string, never>;
	number: {min?: number; max?: number};
	currency: {min?: number; max?: number};
	date: Record<string, never>;
	choice: {
		options: Array<{value: string; label: string}>;
		allow_other?: boolean;
	};
	boolean: {true_label?: string; false_label?: string};
}
export type ScriptInputKind = keyof ScriptInputRegistry;
export type ScriptInputOf<K extends ScriptInputKind> = {
	kind: K;
	config?: ScriptInputRegistry[K];
};
export type ScriptInput = {
	[K in ScriptInputKind]: ScriptInputOf<K>;
}[ScriptInputKind];

export type ScriptLeadColumn = 'name' | 'caller_phone';
export type ScriptBindingDirection = 'in' | 'out' | 'both';

export type ScriptFieldBinding =
	| {
			target: 'form_field';
			form: string;
			field: string;
			direction: ScriptBindingDirection;
	  }
	| {target: 'lead_column'; column: ScriptLeadColumn; direction: 'in'};

export interface ScriptVarDef {
	key: ScriptVarKey;
	label: string;
	source: 'agent' | 'call';
	input?: ScriptInput;
	fallback?: string;
	bindings?: ScriptFieldBinding[];
}

/* Graph + storage ------------------------------------------------------------ */

export interface ScriptGraph {
	schema_version: 1;
	version_label: string;
	title: string;
	start_node_id: ScriptNodeId;
	vars: ScriptVarDef[];
	nodes: ScriptNode[];
}

/** The published script served in the lead-form bundle. */
export interface DialerScript {
	id: string;
	org_id: string;
	script_key: string;
	version: number;
	name: string;
	status: 'draft' | 'published' | 'archived';
	graph: ScriptGraph;
	published_at: string | null;
	created_at: string;
	updated_at: string;
}

/* Runtime (browser-only) ------------------------------------------------------ */

export type ScriptVarWriteSource = 'capture' | 'form' | 'action' | 'profile';

export interface ScriptVarState {
	value: ScriptVarValue;
	source: ScriptVarWriteSource;
	updated_at: string;
}

export interface ScriptSession {
	current_node_id: ScriptNodeId;
	return_stack: ScriptNodeId[];
	vars: Record<ScriptVarKey, ScriptVarState>;
	choice_uses: Record<string, number>;
	outcome: ScriptOutcome | null;
	/** True once an `end` target was reached. */
	ended: boolean;
	tags: string[];
	path: Array<{node_id: ScriptNodeId; choice_id?: string}>;
}
