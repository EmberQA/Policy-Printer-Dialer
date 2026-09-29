/**
 * Guided call script panel (ENG-278).
 *
 * ScriptHost sits in the Dial screen's left column. When the live call's lead
 * form published a script (LeadFormBridgeContext), it renders Script | Notes
 * tabs; otherwise just the notes panel, exactly as before.
 *
 * The session lives here, in the browser, for one call (keyed by the form's
 * callKey + script id) — never persisted, never sent anywhere. Form ↔ script
 * sync: form commits (blur / pick / save) feed `in` vars; a committed script
 * capture writes `out` vars into the form. Last write wins both ways.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	CornerUpLeft,
	RotateCcw,
	TriangleAlert
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {cn} from '@/lib/utils';
import {
	useLeadFormBridge,
	type LeadFormView
} from '@/leads/LeadFormBridgeContext';
import {LeadNotesPanel, useLeadNotes} from '@/leads/LeadNotesContext';
import {
	advance,
	availableChoices,
	commitVar,
	createSession,
	currentStep,
	formFieldsForVar,
	goBack,
	headingChain,
	indexGraph,
	jumpToHeading,
	missingVars,
	normalizeCallerPhone,
	resolveTextParts,
	resume,
	stepRole,
	varsForFormField,
	varsForLeadColumn,
	type ScriptIndex,
	type VarSeed
} from './engine';
import {ScriptVarInput} from './ScriptVarInput';
import type {
	ScriptHeading,
	ScriptSession,
	ScriptStep,
	ScriptText,
	ScriptVarKey,
	ScriptVarValue
} from './types';

/** Agent profile values for `source: 'agent'` vars. Missing ones render blank. */
export type ScriptAgentVars = Partial<Record<string, string>>;

const HISTORY_LIMIT = 50;

const toVarValue = (v: unknown): ScriptVarValue | null => {
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
		return v;
	if (Array.isArray(v)) return v.join(', ');
	return null;
};

/* -------------------------------------------------------------------------- */
/* Host: tabs + per-call session                                              */
/* -------------------------------------------------------------------------- */

export function ScriptHost({agentVars}: {agentVars: ScriptAgentVars}) {
	const {view} = useLeadFormBridge();
	const {note} = useLeadNotes();
	if (!view?.script) return <LeadNotesPanel />;
	return (
		<ScriptTabs
			key={`${view.callKey}:${view.script.id}`}
			view={view}
			agentVars={agentVars}
			hasNotes={note !== null}
		/>
	);
}

function ScriptTabs({
	view,
	agentVars,
	hasNotes
}: {
	view: LeadFormView;
	agentVars: ScriptAgentVars;
	hasNotes: boolean;
}) {
	const script = view.script!;
	const ix = useMemo(() => indexGraph(script.graph), [script.graph]);
	const {subscribeCommit} = useLeadFormBridge();

	// Latest view without re-subscribing on every keystroke republish.
	const viewRef = useRef(view);
	viewRef.current = view;

	// One state object so every update is a pure functional updater (Back
	// history rides along with the session it snapshots).
	const [{session, history}, setState] = useState<{
		session: ScriptSession;
		history: ScriptSession[];
	}>(() => ({
		session: createSession(ix, initialSeed(ix, view, agentVars)),
		history: []
	}));

	/** Update the session in place (var writes — not a navigation). */
	const update = useCallback((fn: (s: ScriptSession) => ScriptSession) => {
		setState((st) => {
			const next = fn(st.session);
			return next === st.session ? st : {...st, session: next};
		});
	}, []);

	/** Navigation: remember where we were so Back can return to it. */
	const navigateWith = useCallback(
		(fn: (s: ScriptSession) => ScriptSession) => {
			setState((st) => {
				const next = fn(st.session);
				if (next === st.session) return st;
				const moved = next.current_node_id !== st.session.current_node_id;
				return {
					session: next,
					history: moved
						? [...st.history.slice(-(HISTORY_LIMIT - 1)), st.session]
						: st.history
				};
			});
		},
		[]
	);

	// Form → script: only committed values (blur / pick / save).
	useEffect(
		() =>
			subscribeCommit((commit) => {
				const value = toVarValue(commit.value);
				const keys =
					commit.target === 'form_field'
						? varsForFormField(ix, viewRef.current.formKey ?? '', commit.key)
						: varsForLeadColumn(ix, commit.column);
				if (keys.length === 0) return;
				update((s) =>
					keys.reduce((acc, k) => commitVar(acc, k, value, 'form'), s)
				);
			}),
		[ix, subscribeCommit, update]
	);

	/** Script → form, for a value the agent finished entering in the script. */
	const pushOut = useCallback(
		(key: ScriptVarKey, value: ScriptVarValue) => {
			const v = viewRef.current;
			if (!v.formKey) return;
			for (const field of formFieldsForVar(ix, v.formKey, key)) {
				v.writeField(field, value);
			}
		},
		[ix]
	);

	return (
		<Tabs defaultValue="script" className="xl:sticky xl:top-28">
			<TabsList className="w-full">
				<TabsTrigger value="script" className="flex-1">
					Script
				</TabsTrigger>
				<TabsTrigger value="notes" className="flex-1" disabled={!hasNotes}>
					Notes
				</TabsTrigger>
			</TabsList>
			<TabsContent value="script">
				<ScriptPanel
					ix={ix}
					title={script.name}
					versionLabel={script.graph.version_label}
					session={session}
					canGoBack={history.length > 0}
					onChangeVar={(key, value) =>
						update((s) => commitVar(s, key, value, 'capture'))
					}
					onCommitVar={(key, value) => {
						update((s) => commitVar(s, key, value, 'capture'));
						pushOut(key, value);
					}}
					onAdvance={(choiceId) =>
						navigateWith((s) => advance(ix, s, {choiceId}))
					}
					onJump={(headingId) =>
						navigateWith((s) => jumpToHeading(ix, s, headingId))
					}
					onResume={() => navigateWith((s) => resume(ix, s))}
					onBack={() =>
						setState((st) => {
							const prev = st.history.at(-1);
							return prev
								? {
										session: goBack(prev, st.session),
										history: st.history.slice(0, -1)
									}
								: st;
						})
					}
					onRestart={() =>
						setState((st) => ({
							history: [],
							session: createSession(
								ix,
								Object.fromEntries(
									Object.entries(st.session.vars).map(([k, v]) => [
										k,
										{value: v.value, source: v.source}
									])
								)
							)
						}))
					}
				/>
			</TabsContent>
			<TabsContent value="notes">
				<LeadNotesPanel />
			</TabsContent>
		</Tabs>
	);
}

/** Agent profile + whatever the form already holds (e.g. a returning caller). */
function initialSeed(
	ix: ScriptIndex,
	view: LeadFormView,
	agentVars: ScriptAgentVars
): VarSeed {
	const seed: VarSeed = {};
	for (const def of ix.graph.vars) {
		if (def.source === 'agent' && agentVars[def.key])
			seed[def.key] = {value: agentVars[def.key]!, source: 'profile'};
	}
	for (const field of view.schema) {
		const value = toVarValue(view.formData[field.key]);
		if (value === null || value === '') continue;
		for (const k of varsForFormField(ix, view.formKey ?? '', field.key))
			seed[k] = {value, source: 'form'};
	}
	const caller = normalizeCallerPhone(view.callerPhone);
	if (caller) {
		for (const k of varsForLeadColumn(ix, 'caller_phone'))
			seed[k] = {value: caller, source: 'form'};
	}
	const first = view.formData.first_name;
	const last = view.formData.last_name;
	const name = [first, last]
		.filter((p) => typeof p === 'string' && p)
		.join(' ');
	if (name) {
		for (const k of varsForLeadColumn(ix, 'name'))
			seed[k] = {value: name, source: 'form'};
	}
	return seed;
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

function ScriptPanel({
	ix,
	title,
	versionLabel,
	session,
	canGoBack,
	onChangeVar,
	onCommitVar,
	onAdvance,
	onJump,
	onResume,
	onBack,
	onRestart
}: {
	ix: ScriptIndex;
	title: string;
	versionLabel: string;
	session: ScriptSession;
	canGoBack: boolean;
	onChangeVar: (key: ScriptVarKey, value: ScriptVarValue) => void;
	onCommitVar: (key: ScriptVarKey, value: ScriptVarValue) => void;
	onAdvance: (choiceId?: string) => void;
	onJump: (headingId: string) => void;
	onResume: () => void;
	onBack: () => void;
	onRestart: () => void;
}) {
	const step = currentStep(ix, session);
	const chain = step ? headingChain(ix, step.heading_id).reverse() : [];
	const inOverride =
		step !== undefined &&
		stepRole(ix, step.id) !== 'flow' &&
		session.return_stack.length > 0;

	return (
		<Card className="shadow-xs">
			<CardHeader className="space-y-2 pb-3">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold">{title}</p>
						<p className="text-xs text-muted-foreground">{versionLabel}</p>
					</div>
					<div className="flex items-center gap-1">
						{session.outcome && (
							<Badge variant="secondary" className="capitalize">
								{session.outcome.replace('_', ' ')}
							</Badge>
						)}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							title="Restart script (keeps captured answers)"
							onClick={onRestart}
						>
							<RotateCcw className="size-4" />
						</Button>
					</div>
				</div>
				{chain.length > 0 && (
					<p className="text-xs text-muted-foreground">
						{chain.map((h) => h.title).join(' › ')}
					</p>
				)}
				{inOverride && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full justify-start"
						onClick={onResume}
					>
						<CornerUpLeft className="size-4" />
						Back to where we were
					</Button>
				)}
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				{session.ended ? (
					<div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
						<CheckCircle2 className="size-4 text-success" />
						<span>Script complete.</span>
					</div>
				) : step ? (
					<StepView
						key={step.id}
						ix={ix}
						session={session}
						step={step}
						onChangeVar={onChangeVar}
						onCommitVar={onCommitVar}
						onAdvance={onAdvance}
					/>
				) : (
					<p className="text-destructive">This script step is missing.</p>
				)}

				<div className="flex items-center justify-between border-t pt-3">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={!canGoBack}
						onClick={onBack}
					>
						<ArrowLeft className="size-4" />
						Back
					</Button>
				</div>

				<QuickJump ix={ix} onJump={onJump} />
				<Outline ix={ix} session={session} onJump={onJump} />
				<Reference ix={ix} />
			</CardContent>
		</Card>
	);
}

/* -------------------------------------------------------------------------- */
/* Step                                                                       */
/* -------------------------------------------------------------------------- */

function StepView({
	ix,
	session,
	step,
	onChangeVar,
	onCommitVar,
	onAdvance
}: {
	ix: ScriptIndex;
	session: ScriptSession;
	step: ScriptStep;
	onChangeVar: (key: ScriptVarKey, value: ScriptVarValue) => void;
	onCommitVar: (key: ScriptVarKey, value: ScriptVarValue) => void;
	onAdvance: (choiceId?: string) => void;
}) {
	const missing = missingVars(session, step);
	const blocked = missing.length > 0;
	const choices = step.choices ? availableChoices(session, step) : null;

	const varInput = (key: ScriptVarKey, autoFocus = false) => {
		const def = ix.vars.get(key);
		if (!def) return null;
		return (
			<ScriptVarInput
				def={def}
				value={session.vars[key]?.value}
				autoFocus={autoFocus}
				onChange={(v) => onChangeVar(key, v)}
				onCommit={(v) => onCommitVar(key, v)}
				onSubmit={() => onAdvance()}
			/>
		);
	};

	return (
		<div className="space-y-4">
			{step.instructions?.map((ins, i) => (
				<p
					key={i}
					className={cn(
						'flex gap-2 rounded-md px-3 py-2 text-xs leading-5',
						ins.tone === 'warn'
							? 'border border-destructive/30 bg-destructive/5 text-destructive'
							: 'bg-muted/60 text-muted-foreground italic'
					)}
				>
					{ins.tone === 'warn' && (
						<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
					)}
					{ins.text}
				</p>
			))}

			{step.say && <SayText ix={ix} session={session} text={step.say} />}

			{step.type === 'capture' && step.data.var && (
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-muted-foreground">
						{ix.vars.get(step.data.var)?.label}
						{step.data.required && <span className="text-destructive"> *</span>}
					</p>
					{varInput(step.data.var, true)}
				</div>
			)}

			{step.type === 'checklist' && (
				<ol className="space-y-3">
					{step.data.items.map((item, i) => (
						<li key={item.id} className="space-y-1.5">
							<div className="flex gap-2">
								<span className="text-xs text-muted-foreground tabular-nums">
									{i + 1}.
								</span>
								<span className="leading-5">
									<Resolved ix={ix} session={session} text={item.say.text} />
									{item.required && (
										<span className="text-destructive"> *</span>
									)}
								</span>
							</div>
							{item.var && <div className="pl-5">{varInput(item.var)}</div>}
						</li>
					))}
				</ol>
			)}

			{blocked && (
				<p className="text-xs text-destructive">
					Needed before moving on:{' '}
					{missing.map((k) => ix.vars.get(k)?.label ?? k).join(', ')}
				</p>
			)}

			{choices ? (
				<div className="grid gap-2">
					{choices.map((c) => (
						<Button
							key={c.id}
							type="button"
							variant="outline"
							disabled={blocked}
							title={
								c.examples?.length
									? `e.g. “${c.examples.join('”, “')}”`
									: undefined
							}
							className="h-auto min-h-10 flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
							onClick={() => onAdvance(c.id)}
						>
							<span className="font-medium">{c.label}</span>
							{c.say && (
								<span className="text-xs font-normal text-muted-foreground">
									Then say:{' '}
									<Resolved ix={ix} session={session} text={c.say.text} />
								</span>
							)}
						</Button>
					))}
				</div>
			) : (
				<Button
					type="button"
					className="w-full"
					disabled={blocked}
					onClick={() => onAdvance()}
				>
					Next
					<ArrowRight className="size-4" />
				</Button>
			)}
		</div>
	);
}

function SayText({
	ix,
	session,
	text
}: {
	ix: ScriptIndex;
	session: ScriptSession;
	text: ScriptText;
}) {
	const [showVariants, setShowVariants] = useState(false);
	return (
		<div className="space-y-2">
			<p className="text-base leading-7">
				<Resolved ix={ix} session={session} text={text.text} />
			</p>
			{text.variants && text.variants.length > 0 && (
				<div>
					<button
						type="button"
						className="text-xs text-primary underline-offset-2 hover:underline"
						onClick={() => setShowVariants((v) => !v)}
					>
						{showVariants
							? 'Hide other ways to say it'
							: `Other ways to say it (${text.variants.length})`}
					</button>
					{showVariants && (
						<ul className="mt-2 space-y-2 border-l-2 pl-3">
							{text.variants.map((v, i) => (
								<li key={i} className="leading-6 text-muted-foreground">
									<Resolved ix={ix} session={session} text={v} />
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}

/** Template text with filled vars highlighted and missing ones flagged. */
function Resolved({
	ix,
	session,
	text
}: {
	ix: ScriptIndex;
	session: ScriptSession;
	text: string;
}) {
	return (
		<>
			{resolveTextParts(ix, session, text).map((p, i) =>
				p.kind === 'text' ? (
					<span key={i}>{p.text}</span>
				) : (
					<span
						key={i}
						title={ix.vars.get(p.key)?.label}
						className={cn(
							'rounded px-0.5 font-medium',
							p.filled
								? 'bg-primary/10 text-primary'
								: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
						)}
					>
						{p.text}
					</span>
				)
			)}
		</>
	);
}

/* -------------------------------------------------------------------------- */
/* Navigation aids                                                            */
/* -------------------------------------------------------------------------- */

const childrenOf = (ix: ScriptIndex, parentId: string | null) =>
	[...ix.headings.values()]
		.filter((h) => h.parent_id === parentId)
		.sort((a, b) => a.sort - b.sort);

function QuickJump({
	ix,
	onJump
}: {
	ix: ScriptIndex;
	onJump: (headingId: string) => void;
}) {
	const groups = childrenOf(ix, null).filter(
		(h) => h.role === 'objection' || h.role === 'trigger'
	);
	if (groups.length === 0) return null;
	return (
		<div className="space-y-3 border-t pt-3">
			{groups.map((group) => (
				<div key={group.id} className="space-y-1.5">
					<p className="text-xs font-medium text-muted-foreground">
						{group.title}
					</p>
					<div className="flex flex-wrap gap-1.5">
						{childrenOf(ix, group.id)
							.filter((h) => h.entry_node_id)
							.map((h) => (
								<button
									key={h.id}
									type="button"
									title={h.cue_phrases?.map((c) => `“${c}”`).join(' · ')}
									onClick={() => onJump(h.id)}
									className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
								>
									{h.title}
								</button>
							))}
					</div>
				</div>
			))}
		</div>
	);
}

function Outline({
	ix,
	session,
	onJump
}: {
	ix: ScriptIndex;
	session: ScriptSession;
	onJump: (headingId: string) => void;
}) {
	const step = ix.steps.get(session.current_node_id);
	const active = new Set(
		step ? headingChain(ix, step.heading_id).map((h) => h.id) : []
	);
	const sections = childrenOf(ix, null).filter((h) => h.role === 'flow');
	return (
		<details className="border-t pt-3">
			<summary className="cursor-pointer text-xs font-medium text-muted-foreground">
				Outline
			</summary>
			<ol className="mt-2 space-y-1.5">
				{sections.map((h1) => (
					<li key={h1.id}>
						<OutlineLink
							heading={h1}
							active={active.has(h1.id)}
							onJump={onJump}
						/>
						<ol className="mt-1 space-y-0.5 pl-3">
							{childrenOf(ix, h1.id).map((h2) => (
								<li key={h2.id}>
									<OutlineLink
										heading={h2}
										active={active.has(h2.id)}
										onJump={onJump}
										small
									/>
								</li>
							))}
						</ol>
					</li>
				))}
			</ol>
		</details>
	);
}

function OutlineLink({
	heading,
	active,
	onJump,
	small
}: {
	heading: ScriptHeading;
	active: boolean;
	onJump: (headingId: string) => void;
	small?: boolean;
}) {
	return (
		<button
			type="button"
			disabled={!heading.entry_node_id}
			onClick={() => onJump(heading.id)}
			className={cn(
				'text-left hover:underline',
				small ? 'text-xs' : 'text-sm font-medium',
				active ? 'text-primary' : 'text-foreground'
			)}
		>
			{heading.title}
		</button>
	);
}

function Reference({ix}: {ix: ScriptIndex}) {
	const refs = [...ix.headings.values()].filter(
		(h) => h.role === 'reference' && h.notes?.length
	);
	if (refs.length === 0) return null;
	return (
		<details className="border-t pt-3">
			<summary className="cursor-pointer text-xs font-medium text-muted-foreground">
				Reference
			</summary>
			<div className="mt-2 space-y-3">
				{refs.map((h) => (
					<div key={h.id} className="space-y-1">
						<p className="text-xs font-semibold">{h.title}</p>
						<ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
							{h.notes!.map((n, i) => (
								<li key={i}>{n}</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</details>
	);
}
