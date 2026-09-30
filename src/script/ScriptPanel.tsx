/**
 * Guided call script panel (ENG-278).
 *
 * ScriptHost sits in the Dial screen's left column. When the live call's lead
 * form published a script (LeadFormBridgeContext), it renders Script | Notes
 * tabs; otherwise just the notes panel, exactly as before.
 *
 * The session lives here, in the browser, for one call (keyed by the form's
 * callKey + script id). Navigation stays local; answers flow into lead fields
 * or plain lead notes through the existing save workflow. Form ↔ script
 * sync: form commits (blur / pick / save) feed `in` vars; a committed script
 * capture writes `out` vars into the form. Last write wins both ways.
 *
 * ScriptPreview is the same panel with no call attached (Campaigns menu).
 */

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode
} from 'react';
import {
	ArrowLeft,
	ArrowRight,
	Check,
	CheckCircle2,
	Ear,
	StickyNote,
	Keyboard,
	Megaphone,
	RotateCcw,
	TriangleAlert
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {stateFormValueFromCode} from '@/lib/phone';
import {
	useLeadFormBridge,
	type LeadFormView
} from '@/leads/LeadFormBridgeContext';
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
	isItemDone,
	itemInputKeys,
	itemDisplay,
	visibleFields,
	prerequisiteFields,
	jumpToHeading,
	missingVars,
	raiseInterrupt,
	normalizeCallerPhone,
	resolveTextParts,
	setItemChecked,
	varsForFormField,
	varsForLeadColumn,
	type ScriptIndex,
	type VarSeed
} from './engine';
import {focusNextScriptField, handleScriptTab} from './fieldNavigation';
import {
	scriptAnswerLines,
	mergeAnswerNotes,
	type AnswerLines
} from './answerNotes';
import {ScriptVarInput} from './ScriptVarInput';
import type {
	DialerScript,
	ScriptHeading,
	ScriptInstruction,
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
	if (!view?.script) return null;
	return (
		<LiveScript
			key={`${view.callKey}:${view.script.id}`}
			view={view}
			agentVars={agentVars}
		/>
	);
}

function LiveScript({
	view,
	agentVars
}: {
	view: LeadFormView;
	agentVars: ScriptAgentVars;
}) {
	const script = view.script!;
	const ix = useMemo(() => indexGraph(script.graph), [script.graph]);
	const {subscribeCommit} = useLeadFormBridge();

	// Latest view without re-subscribing on every keystroke republish.
	const viewRef = useRef(view);
	viewRef.current = view;

	const runner = useScriptRunner(ix, () => initialSeed(ix, view, agentVars));
	const {update} = runner;
	const priorNoteLines = useRef<AnswerLines>({});
	useEffect(() => {
		const v = viewRef.current;
		const lines = scriptAnswerLines(
			ix.graph,
			runner.session,
			v.formKey,
			v.schema
		);
		const previous = priorNoteLines.current;
		if (JSON.stringify(lines) === JSON.stringify(previous)) return;
		priorNoteLines.current = lines;
		const noteKey =
			v.schema.find((field) => field.key === 'notes' || field.key === 'note')
				?.key ?? 'notes';
		v.updateField(noteKey, (value) =>
			mergeAnswerNotes(typeof value === 'string' ? value : '', previous, lines)
		);
	}, [ix, runner.session]);

	useEffect(() => {
		update((session) => {
			let next = session;
			for (const [key, seed] of Object.entries(agentSeed(ix, agentVars))) {
				const existing = next.vars[key];
				if (!existing || existing.source === 'profile') {
					if (existing?.value !== seed.value)
						next = commitVar(next, key, seed.value, 'profile');
				}
			}
			return next;
		});
	}, [agentVars, ix, update]);

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
				// A typed "Other" answer can't go into a pick-list field that
				// doesn't offer it — the lead would fail to save.
				const def = v.schema.find((f) => f.key === field);
				if (!def) continue;
				const picks = def.options?.map((o) => o.value);
				let formValue = value;
				if (field === 'state' && typeof value === 'string' && picks?.length) {
					const normalized = value.trim().toLowerCase();
					formValue =
						stateFormValueFromCode(value, def.options) ??
						def.options?.find(
							(option) =>
								option.value.toLowerCase() === normalized ||
								option.label.toLowerCase() === normalized ||
								option.label.split(' (')[0].toLowerCase() === normalized
						)?.value ??
						value;
				}
				if (
					picks?.length &&
					formValue !== '' &&
					!picks.includes(String(formValue))
				)
					continue;
				v.writeField(field, formValue);
				if (formValue !== value)
					update((session) => commitVar(session, key, formValue, 'capture'));
				update((session) =>
					varsForFormField(ix, v.formKey!, field).reduce(
						(next, alias) =>
							alias === key ? next : commitVar(next, alias, formValue, 'form'),
						session
					)
				);
			}
		},
		[ix, update]
	);

	return (
		<div className="xl:sticky xl:top-28">
			<ScriptPanel
				ix={ix}
				title={script.name}
				versionLabel={script.graph.version_label}
				{...runnerPanelProps(ix, runner, pushOut)}
			/>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Session runner (shared by the live call and the preview)                   */
/* -------------------------------------------------------------------------- */

type ScriptRunner = ReturnType<typeof useScriptRunner>;

/**
 * One call's walk through a script: the session plus a Back history. One state
 * object so every update is a pure functional updater (history rides along with
 * the session it snapshots).
 */
function useScriptRunner(ix: ScriptIndex, seed: () => VarSeed) {
	const [{session, history}, setState] = useState<{
		session: ScriptSession;
		history: ScriptSession[];
	}>(() => ({session: createSession(ix, seed()), history: []}));

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
				const moved =
					next.current_node_id !== st.session.current_node_id ||
					next.pending_choices !== st.session.pending_choices ||
					next.ended !== st.session.ended;
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

	const back = useCallback(
		() =>
			setState((st) => {
				const prev = st.history.at(-1);
				return prev
					? {
							session: goBack(prev, st.session),
							history: st.history.slice(0, -1)
						}
					: st;
			}),
		[]
	);

	/** Back to the start, keeping every captured answer. */
	const restart = useCallback(
		() =>
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
			})),
		[ix]
	);

	return {session, history, update, navigateWith, back, restart};
}

/** The ScriptPanel handlers for a runner. `onCommitted` sees finished values. */
function runnerPanelProps(
	ix: ScriptIndex,
	runner: ScriptRunner,
	onCommitted?: (key: ScriptVarKey, value: ScriptVarValue) => void
) {
	const {session, history, update, navigateWith} = runner;
	return {
		session,
		canGoBack: history.length > 0,
		onChangeVar: (key: ScriptVarKey, value: ScriptVarValue) =>
			update((s) => commitVar(s, key, value, 'capture')),
		onInterrupt: (interruptId: string) => {
			// The fill answer goes out to the bound form like any typed answer.
			const step = currentStep(ix, session);
			const it = step?.interrupts?.find((i) => i.id === interruptId);
			navigateWith((s) => raiseInterrupt(ix, s, interruptId));
			if (it?.fill !== undefined && step?.type === 'capture' && step.data.var)
				onCommitted?.(step.data.var, it.fill);
		},
		onToggleItem: (stepId: string, itemId: string, checked: boolean) =>
			update((s) => setItemChecked(s, stepId, itemId, checked)),
		onCommitVar: (key: ScriptVarKey, value: ScriptVarValue) => {
			update((s) => commitVar(s, key, value, 'capture'));
			onCommitted?.(key, value);
		},
		onAdvance: (choiceId?: string) =>
			navigateWith((s) => advance(ix, s, {choiceId})),
		onJump: (headingId: string) =>
			navigateWith((s) => jumpToHeading(ix, s, headingId)),
		onBack: runner.back,
		onRestart: runner.restart
	};
}

/**
 * A stand-alone walk through a script with no call and no lead form — for
 * agents to read a campaign's script ahead of time. Only agent profile vars are
 * seeded; answers typed here go nowhere.
 */
export function ScriptPreview({
	script,
	agentVars
}: {
	script: DialerScript;
	agentVars: ScriptAgentVars;
}) {
	const ix = useMemo(() => indexGraph(script.graph), [script.graph]);
	const runner = useScriptRunner(ix, () => agentSeed(ix, agentVars));
	return (
		<ScriptPanel
			ix={ix}
			title={script.name}
			versionLabel={script.graph.version_label}
			{...runnerPanelProps(ix, runner)}
		/>
	);
}

function agentSeed(ix: ScriptIndex, agentVars: ScriptAgentVars): VarSeed {
	const seed: VarSeed = {};
	for (const def of ix.graph.vars) {
		if (def.source === 'agent' && agentVars[def.key])
			seed[def.key] = {value: agentVars[def.key]!, source: 'profile'};
	}
	return seed;
}

/** Agent profile + whatever the form already holds (e.g. a returning caller). */
function initialSeed(
	ix: ScriptIndex,
	view: LeadFormView,
	agentVars: ScriptAgentVars
): VarSeed {
	const seed = agentSeed(ix, agentVars);
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
	onToggleItem,
	onInterrupt,
	onAdvance,
	onJump,
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
	onToggleItem: (stepId: string, itemId: string, checked: boolean) => void;
	onInterrupt: (interruptId: string) => void;
	onAdvance: (choiceId?: string) => void;
	onJump: (headingId: string) => void;
	onBack: () => void;
	onRestart: () => void;
}) {
	const step = currentStep(ix, session);
	const chain = step ? headingChain(ix, step.heading_id).reverse() : [];
	// Back is always "the page before this one" — never a jump to a section start.
	const back = canGoBack ? onBack : undefined;
	const canNext = !session.ended && step !== undefined;

	return (
		// Objection / trigger rail on the left, script card beside it — the
		// jumps stay visible without pushing the script down.
		<div className="flex items-start gap-1.5">
			<QuickJump ix={ix} session={session} onJump={onJump} />
			<Card className="min-w-0 flex-[3_1_0%] shadow-xs">
				<CardHeader className="space-y-0 px-2 pt-1.5 pb-1">
					<div className="flex items-center justify-between gap-2">
						<p className="min-w-0 truncate text-sm font-semibold">
							{title}{' '}
							<span className="font-normal text-muted-foreground">
								{versionLabel}
							</span>
						</p>
						<div className="flex items-center gap-1">
							{session.outcome && (
								<Badge variant="secondary" className="capitalize">
									{session.outcome.replace('_', ' ')}
								</Badge>
							)}
							<Button
								tabIndex={-1}
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
					<p className="min-h-4 truncate text-xs font-medium text-foreground/80">
						{chain.map((h) => h.title).join(' › ')}
					</p>
				</CardHeader>
				<CardContent className="space-y-1.5 px-2 pb-2 pt-0 text-sm">
					<div className="flex gap-2">
						<Button
							tabIndex={-1}
							type="button"
							variant="outline"
							disabled={!back}
							onClick={back}
						>
							<ArrowLeft className="size-4" />
							Back
						</Button>
						{/* Always available: Next can skip an unanswered question. */}
						<Button
							tabIndex={-1}
							type="button"
							className="flex-1"
							disabled={!canNext}
							onClick={() => onAdvance()}
						>
							Next
							<ArrowRight className="size-4" />
						</Button>
					</div>

					{/* Fixed-height step area (scrolls inside) so the
				    objection chips below never move between steps. */}
					<div
						key={`${session.current_node_id}:${session.pending_choices?.[session.current_node_id] ?? ''}:${session.ended}`}
						className="h-[calc(100vh-24rem)] min-h-[24rem] overflow-y-auto"
					>
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
								onToggleItem={onToggleItem}
								onInterrupt={onInterrupt}
								onAdvance={onAdvance}
							/>
						) : (
							<p className="text-destructive">This script step is missing.</p>
						)}
					</div>

					<Outline ix={ix} session={session} onJump={onJump} />
					<Reference ix={ix} />
				</CardContent>
			</Card>
		</div>
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
	onToggleItem,
	onInterrupt,
	onAdvance
}: {
	ix: ScriptIndex;
	session: ScriptSession;
	step: ScriptStep;
	onChangeVar: (key: ScriptVarKey, value: ScriptVarValue) => void;
	onCommitVar: (key: ScriptVarKey, value: ScriptVarValue) => void;
	onToggleItem: (stepId: string, itemId: string, checked: boolean) => void;
	onInterrupt: (interruptId: string) => void;
	onAdvance: (choiceId?: string) => void;
}) {
	const missing = missingVars(session, step);
	const choices = step.choices ? availableChoices(session, step) : null;
	// Show prerequisite recovery only when needed, then keep it mounted while typing.
	const [recoveryKeys, setRecoveryKeys] = useState<string[]>([]);
	const recoveryCandidates = prerequisiteFields(session, step);
	const recoveryFields = [
		...new Set([
			...recoveryKeys,
			...recoveryCandidates.filter((key) => missing.includes(key))
		])
	].filter((key) => recoveryCandidates.includes(key));
	useEffect(() => {
		const needed = prerequisiteFields(session, step).filter((key) =>
			missingVars(session, step).includes(key)
		);
		setRecoveryKeys((previous) => {
			const added = needed.filter((key) => !previous.includes(key));
			return added.length ? [...previous, ...added] : previous;
		});
	}, [session, step]);

	const varInput = (key: ScriptVarKey, autoFocus = false) => {
		const def = ix.vars.get(key);
		if (!def) return null;
		return (
			<div data-script-field={key}>
				<p className="mb-1 text-[11px] font-semibold text-foreground">
					{def.label}
				</p>
				<ScriptVarInput
					def={def}
					value={session.vars[key]?.value}
					autoFocus={autoFocus}
					onChange={(v) => onChangeVar(key, v)}
					onCommit={(v) => onCommitVar(key, v)}
					onSubmit={(input) => focusNextScriptField(input)}
				/>
			</div>
		);
	};
	const fields = (text: ScriptText, block: number) =>
		visibleFields(session, text)
			.filter((field) => (field.after ?? text.then?.length ?? 0) === block)
			.map((field) => (
				<Cue
					key={field.var}
					plain
					kind="type"
					label={inputCommand(ix.vars.get(field.var)?.input?.kind)}
				>
					{varInput(field.var)}
				</Cue>
			));
	const pending = session.pending_choices?.[step.id]
		? step.choices?.find(
				(c) => c.id === session.pending_choices?.[session.current_node_id]
			)
		: undefined;
	if (pending?.say)
		return (
			<div data-script-step onKeyDown={handleScriptTab} className="space-y-1.5">
				<Cue kind="say">
					<SayText
						ix={ix}
						session={session}
						text={pending.say}
						fields={fields}
					/>
				</Cue>
				{missing.map((key) => (
					<Cue
						key={key}
						kind="type"
						label={inputCommand(ix.vars.get(key)?.input?.kind)}
					>
						{varInput(key)}
					</Cue>
				))}
			</div>
		);

	// Each note sits above or below what to say: its own `position`, else
	// cautions above and plain notes below.
	const above = (i: ScriptInstruction) =>
		(i.position ?? (i.tone === 'warn' ? 'before' : 'after')) === 'before';
	const before = step.instructions?.filter(above) ?? [];
	const after = step.instructions?.filter((i) => !above(i)) ?? [];
	const note = (ins: ScriptInstruction, key: string) => (
		<Cue key={key} kind={ins.tone === 'warn' ? 'caution' : 'do'}>
			<p className="text-sm font-medium text-foreground">{ins.text}</p>
		</Cue>
	);

	const checklist =
		step.type === 'checklist' ? (
			<Cue kind="say" label="Say">
				<ol className="space-y-3">
					{step.data.items.map((item, i) => (
						<li key={item.id} className="space-y-1.5">
							<div className="flex gap-2">
								<ItemCheck
									done={isItemDone(session, step.id, item)}
									auto={
										itemInputKeys(session, item).length > 0 &&
										!item.optional &&
										!item.confirm
									}
									label={`${i + 1}`}
									onToggle={(checked) =>
										onToggleItem(step.id, item.id, checked)
									}
								/>
								<div className="text-[15px] leading-6 font-medium">
									<SayText
										ix={ix}
										session={session}
										text={item.say}
										fields={fields}
									/>

									{item.optional && (
										<span className="text-xs font-normal text-muted-foreground">
											{' '}
											(optional)
										</span>
									)}
								</div>
							</div>
							{item.display && (
								<p className="pl-7 font-semibold">
									{itemDisplay(ix, session, item)}
								</p>
							)}
							{item.var &&
								!visibleFields(session, item.say).some(
									(f) => f.var === item.var
								) && (
									<div className="pl-7">
										<Cue
											kind="type"
											plain
											label={inputCommand(ix.vars.get(item.var)?.input?.kind)}
										>
											{varInput(item.var)}
										</Cue>
									</div>
								)}
						</li>
					))}
				</ol>
			</Cue>
		) : null;

	// Reading order: notes placed before → what to say → notes after → what to listen for /
	// type. Each cue has its own colour + label so the agent can tell at a
	// glance what is spoken aloud and what is not.
	return (
		<div data-script-step onKeyDown={handleScriptTab} className="space-y-1.5">
			{before.map((ins, i) => note(ins, `b${i}`))}
			{step.type === 'checklist' &&
				step.data.position === 'before' &&
				checklist}

			{step.say && (
				<Cue kind="say">
					<SayText ix={ix} session={session} text={step.say} fields={fields} />
				</Cue>
			)}

			{after.map((ins, i) => note(ins, `a${i}`))}

			{step.type === 'capture' &&
				step.data.var &&
				!visibleFields(session, step.say).some(
					(f) => f.var === step.data.var
				) && (
					<Cue
						kind="type"
						label={inputCommand(ix.vars.get(step.data.var)?.input?.kind)}
					>
						{varInput(step.data.var, true)}
					</Cue>
				)}

			{step.type === 'checklist' &&
				step.data.position !== 'before' &&
				checklist}

			{step.interrupts && step.interrupts.length > 0 && (
				<Cue kind="listen" label="Listen">
					<div className="grid gap-1">
						{step.interrupts.map((it) => (
							<button
								tabIndex={-1}
								key={it.id}
								type="button"
								className="flex w-full flex-col items-start gap-0.5 rounded-md border border-rose-200 bg-background px-2 py-1 text-left transition-colors hover:border-rose-500 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
								onClick={() => onInterrupt(it.id)}
							>
								<span className="text-sm font-semibold">{it.label}</span>
								<span className="text-xs text-rose-700 dark:text-rose-300">
									→ {ix.headings.get(it.heading_id)?.title ?? it.heading_id}
									{it.fill ? ` · fills in “${it.fill}”` : ''}
								</span>
							</button>
						))}
					</div>
				</Cue>
			)}

			{recoveryFields.map((key) => (
				<Cue
					key={key}
					kind="type"
					label={inputCommand(ix.vars.get(key)?.input?.kind)}
				>
					{varInput(key)}
				</Cue>
			))}

			{choices && (
				<Cue kind="listen">
					<div className="grid gap-1">
						{choices.map((c) => (
							<button
								tabIndex={0}
								key={c.id}
								data-script-answer
								type="button"
								className="flex w-full flex-col items-start gap-0.5 rounded-md border border-emerald-200 bg-background px-2 py-1 text-left transition-colors hover:border-emerald-500 hover:bg-emerald-50 disabled:pointer-events-none disabled:opacity-50 dark:border-emerald-500/30 dark:hover:bg-emerald-500/10"
								onClick={() => onAdvance(c.id)}
							>
								<span className="text-sm font-semibold">{c.label}</span>
								{c.examples?.length ? (
									<span className="text-xs text-muted-foreground italic">
										“{c.examples.slice(0, 2).join('”, “')}”
									</span>
								) : null}
								{c.say && (
									<span className="mt-1 text-xs">
										<span className="font-bold tracking-wider text-sky-700 uppercase dark:text-sky-300">
											Say:{' '}
										</span>
										<Resolved ix={ix} session={session} text={c.say.text} />
									</span>
								)}
							</button>
						))}
					</div>
				</Cue>
			)}
		</div>
	);
}

/**
 * Check-off box for one checklist line. Lines with a field tick themselves once
 * it's filled (the box just mirrors that); plain lines are ticked by hand.
 */
function ItemCheck({
	done,
	auto,
	label,
	onToggle
}: {
	done: boolean;
	auto: boolean;
	label: string;
	onToggle: (checked: boolean) => void;
}) {
	return (
		<button
			tabIndex={-1}
			type="button"
			role="checkbox"
			aria-checked={done}
			aria-label={`Line ${label} ${done ? 'done' : 'not done'}`}
			title={
				auto
					? 'Ticks itself once the answer is filled in'
					: done
						? 'Untick'
						: 'Tick off once said'
			}
			disabled={auto}
			onClick={() => onToggle(!done)}
			className={cn(
				'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-[11px] font-semibold tabular-nums transition-colors',
				done
					? 'border-emerald-600 bg-emerald-600 text-white'
					: 'border-sky-400 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10',
				auto && 'cursor-default'
			)}
		>
			{done ? <Check className="size-3.5" strokeWidth={3} /> : label}
		</button>
	);
}

const CUES = {
	say: {
		label: 'Say',
		icon: Megaphone,
		box: 'border-sky-500 bg-sky-50 dark:bg-sky-500/10',
		tag: 'text-sky-700 dark:text-sky-300'
	},
	do: {
		label: 'Note',
		icon: StickyNote,
		box: 'border-purple-500 bg-purple-50 dark:bg-purple-500/10',
		tag: 'text-purple-700 dark:text-purple-300'
	},
	caution: {
		label: 'Caution',
		icon: TriangleAlert,
		box: 'border-red-500 bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200',
		tag: 'text-red-700 dark:text-red-300'
	},
	listen: {
		label: 'Select',
		icon: Ear,
		box: 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-500/10',
		tag: 'text-emerald-700 dark:text-emerald-300'
	},
	type: {
		label: 'Type',
		icon: Keyboard,
		box: 'border-amber-400 bg-amber-50 dark:bg-amber-500/10',
		tag: 'text-amber-700 dark:text-amber-300'
	}
} as const;

/** A coloured, labelled block: one per kind of agent cue (see CUES). */
function Cue({
	kind,
	label,
	children,
	plain = false
}: {
	kind: keyof typeof CUES;
	label?: string;
	plain?: boolean;
	children: ReactNode;
}) {
	const cue = CUES[kind];
	const Icon = cue.icon;
	return (
		<div
			className={
				plain ? 'py-1' : cn('rounded-md border-l-4 px-2 py-1', cue.box)
			}
		>
			{!plain && (
				<p
					className={cn(
						'mb-0.5 flex items-center gap-1 text-[11px] font-bold tracking-wider uppercase',
						cue.tag
					)}
				>
					<Icon className="size-3.5" />
					{label ?? cue.label}
				</p>
			)}
			{children}
		</div>
	);
}

function SayText({
	ix,
	session,
	text,
	fields
}: {
	ix: ScriptIndex;
	session: ScriptSession;
	text: ScriptText;
	fields?: (text: ScriptText, block: number) => ReactNode;
}) {
	const [showVariants, setShowVariants] = useState(false);
	return (
		<div className="space-y-2">
			<p className="text-base leading-6 font-semibold whitespace-pre-line text-foreground">
				<Resolved ix={ix} session={session} text={text.text} />
			</p>
			{fields?.(text, 0)}
			{text.variants && text.variants.length > 0 && (
				<div>
					<button
						tabIndex={-1}
						type="button"
						className="text-xs font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
						onClick={() => setShowVariants((v) => !v)}
					>
						{showVariants
							? 'Hide other ways to say it'
							: `Other ways to say it (${text.variants.length})`}
					</button>
					{showVariants && (
						<ul className="mt-2 space-y-2 border-l-2 border-sky-300 pl-3">
							{text.variants.map((v, i) => (
								<li key={i} className="leading-6 text-muted-foreground">
									<Resolved ix={ix} session={session} text={v} />
								</li>
							))}
						</ul>
					)}
				</div>
			)}
			{text.then?.map((line, i) => (
				<div key={i} className="space-y-2">
					<WaitForAnswer />
					<p className="text-base leading-6 font-semibold whitespace-pre-line text-foreground">
						<Resolved ix={ix} session={session} text={line} />
					</p>
					{fields?.(text, i + 1)}
				</div>
			))}
		</div>
	);
}

/** say → wait → say: the beat where the agent stops and lets the caller answer. */
function WaitForAnswer() {
	return (
		<p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
			<Ear className="size-3.5" />
			Wait for their answer
			<span className="h-px flex-1 bg-emerald-200 dark:bg-emerald-500/30" />
		</p>
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

/** Narrow single-column rail of objection / trigger jumps (full text on hover). */
function QuickJump({
	ix,
	session,
	onJump
}: {
	ix: ScriptIndex;
	session: ScriptSession;
	onJump: (headingId: string) => void;
}) {
	const groups = childrenOf(ix, null).filter(
		(h) => h.role === 'objection' || h.role === 'trigger'
	);
	if (groups.length === 0) return null;
	const step = ix.steps.get(session.current_node_id);
	const active = new Set(
		step ? headingChain(ix, step.heading_id).map((h) => h.id) : []
	);
	return (
		<nav
			className="max-h-[calc(100vh-9rem)] min-w-32 max-w-64 flex-[1_1_0%] space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			aria-label="Objections and triggers"
		>
			{groups.map((group) => {
				const tone =
					RAIL_TONES[group.role === 'trigger' ? 'trigger' : 'objection'];
				return (
					<div key={group.id} className="space-y-1">
						<p
							className={cn(
								'text-[10px] leading-tight font-bold tracking-wider uppercase',
								tone.heading
							)}
						>
							{group.title}
						</p>
						{childrenOf(ix, group.id)
							.filter((h) => h.entry_node_id)
							.map((h) => (
								<button
									tabIndex={-1}
									key={h.id}
									type="button"
									title={
										(h.cue_phrases ?? []).map((c) => `“${c}”`).join('\n') ||
										undefined
									}
									onClick={() => onJump(h.id)}
									className={cn(
										'block w-full rounded border px-1.5 py-1 text-left text-xs leading-tight font-medium transition-colors',
										active.has(h.id) ? tone.active : tone.idle
									)}
								>
									{h.title}
								</button>
							))}
					</div>
				);
			})}
		</nav>
	);
}

/** Objections read red, emotional triggers violet — distinct from the step cues. */
const RAIL_TONES = {
	objection: {
		heading: 'text-rose-700 dark:text-rose-300',
		idle: 'border-rose-200 bg-rose-50 text-rose-950 hover:border-rose-400 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100',
		active: 'border-rose-600 bg-rose-600 text-white'
	},
	trigger: {
		heading: 'text-indigo-700 dark:text-indigo-300',
		idle: 'border-indigo-200 bg-indigo-50 text-indigo-950 hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100',
		active: 'border-indigo-600 bg-indigo-600 text-white'
	}
} as const;

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
		<details className="border-t pt-2">
			<summary
				tabIndex={-1}
				className="cursor-pointer text-xs font-medium text-muted-foreground"
			>
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
			tabIndex={-1}
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
		<details className="border-t pt-2">
			<summary
				tabIndex={-1}
				className="cursor-pointer text-xs font-medium text-muted-foreground"
			>
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

function inputCommand(kind?: string) {
	return kind === 'boolean' || kind === 'choice'
		? 'Select'
		: kind === 'date'
			? 'Choose'
			: kind === 'number' || kind === 'currency'
				? 'Enter'
				: 'Type';
}
