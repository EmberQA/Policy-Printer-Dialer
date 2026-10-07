/**
 * Hyperlinked script doc — a playground, NOT the ENG-278 script engine.
 * Think "text doc with jump links": every [link](#id) / choice button scrolls
 * to its target, and the place you jumped FROM is pushed on a back stack.
 *
 * Main Flow, Objections, and Emotional Triggers share one persistent viewport,
 * matching the training frontend. Back restores the exact saved scroll position;
 * the blue outlined continuation moves into the next script section.
 *
 * Two modes (ENG-298), Live by default:
 *  - live: spoken lines, choices, headings. No purple guidance, no triggers.
 *  - training: everything.
 * Branches stay grayed until picked; a picked branch can always be re-picked.
 * Far jumps are instant.
 */

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode
} from 'react';
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ArrowUpRight,
	PanelLeftClose,
	MoreHorizontal,
	RotateCcw
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem
} from '@/components/ui/dropdown-menu';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {DOC_TITLE, SCRIPT_DOC} from './content';
import {
	buildAnchorIndex,
	buildPathGroups,
	exitOf,
	findBrokenLinks,
	findUnknownBlankSources,
	isBlockVisible,
	parseInline,
	resolveBlank
} from './core';
import type {
	AnchorKind,
	Block,
	DocGroup,
	DocNode,
	ScriptMode,
	ScriptValues
} from './types';

const NO_VALUES: ScriptValues = {};

const ANCHORS = buildAnchorIndex(SCRIPT_DOC);
const PATH_GROUPS = buildPathGroups(SCRIPT_DOC, ANCHORS);
const NODE_GROUP = new Map(SCRIPT_DOC.map((n) => [n.id, n.group]));
const OBJECTION_PICKER = 'objection-picker';
const groupOf = (anchorId: string): DocGroup =>
	anchorId === OBJECTION_PICKER
		? 'objections'
		: (NODE_GROUP.get(ANCHORS.get(anchorId)?.nodeId ?? '') ?? 'script');
if (import.meta.env.DEV) {
	const broken = findBrokenLinks(SCRIPT_DOC, ANCHORS);
	if (broken.length) console.warn('[ScriptDoc] broken links:', broken);
	const unknown = findUnknownBlankSources(SCRIPT_DOC);
	if (unknown.length) console.warn('[ScriptDoc] unknown blank sources:', unknown);
}

const PANELS: Record<DocGroup, {title: string; nodes: DocNode[]}> = {
	script: {
		title: DOC_TITLE,
		nodes: SCRIPT_DOC.filter((n) => n.group === 'script')
	},
	objections: {
		title: 'Common Objections',
		nodes: SCRIPT_DOC.filter((n) => n.group === 'objections')
	},
	triggers: {
		title: 'Emotional Triggers',
		nodes: SCRIPT_DOC.filter((n) => n.group === 'triggers')
	}
};

/** Where a jumped-to anchor lands, as a fraction of the scroller's height. */
const FOCUS_LINE = 0.15;

const LINK: Record<AnchorKind, string> = {
	objection: 'text-rose-600 decoration-rose-400 dark:text-rose-400',
	path: 'text-emerald-700 decoration-emerald-400 dark:text-emerald-400',
	section: 'text-sky-700 decoration-sky-400 dark:text-sky-400',
	trigger: 'text-amber-700 decoration-amber-400 dark:text-amber-400',
	reference: 'text-violet-700 decoration-violet-400 dark:text-violet-400'
};
/** Progression choices (branch or next section) are green; objections red. */
const CHOICE: Record<AnchorKind, string> = {
	objection:
		'border-rose-200 text-rose-700 hover:border-rose-500 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10',
	path: 'border-emerald-200 text-emerald-800 hover:border-emerald-500 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10',
	section:
		'border-emerald-200 text-emerald-800 hover:border-emerald-500 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10',
	trigger:
		'border-amber-200 text-amber-800 hover:border-amber-500 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10',
	reference:
		'border-violet-200 text-violet-800 hover:border-violet-500 hover:bg-violet-50 dark:border-violet-500/30 dark:text-violet-300 dark:hover:bg-violet-500/10'
};
/** Filled look for a choice that's already been clicked. */
const CHOICE_CLICKED: Record<AnchorKind, string> = {
	objection: 'border-rose-500 bg-rose-100 dark:bg-rose-500/20',
	path: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15',
	section: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15',
	trigger: 'border-amber-500 bg-amber-100 dark:bg-amber-500/20',
	reference: 'border-violet-500 bg-violet-100 dark:bg-violet-500/20'
};
const TITLE: Record<AnchorKind, string> = {
	objection: 'text-rose-700 dark:text-rose-400',
	path: 'text-emerald-700 dark:text-emerald-400',
	section: 'text-sky-700 dark:text-sky-400',
	trigger: 'text-amber-700 dark:text-amber-400',
	reference: 'text-violet-700 dark:text-violet-400'
};

// ───────────────────────────── scroll helpers ─────────────────────────────

const offsetIn = (scroller: HTMLElement, el: HTMLElement) =>
	el.getBoundingClientRect().top -
	scroller.getBoundingClientRect().top +
	scroller.scrollTop;

/** Last anchor in `scroller` starting at or above `y` (scroll coordinates). */
function anchorAt(scroller: HTMLElement, y: number, fallback: string): string {
	let found = fallback;
	for (const el of scroller.querySelectorAll<HTMLElement>('[data-anchor]')) {
		if (offsetIn(scroller, el) <= y + 1) found = el.dataset.anchor!;
		else break;
	}
	return found;
}

/** Short name for an anchor: a heading's own text, or the section a path sits in. */
function returnLabel(id: string): string {
	if (id === OBJECTION_PICKER) return 'Choose an objection';
	const a = ANCHORS.get(id);
	if (!a) return id;
	if (a.kind === 'path') {
		const node = SCRIPT_DOC.find((n) => n.id === a.nodeId);
		return node?.short ?? node?.title ?? a.label;
	}
	return a.label.split(' · ').pop()!;
}

// ─────────────────────────────── component ───────────────────────────────

type JumpFn = (to: string, from: HTMLElement | null) => void;

interface Ctx {
	mode: ScriptMode;
	/** Live lead-form / agent values the `{{…|source}}` blanks show. */
	values: ScriptValues;
	jump: JumpFn;
	pick: (pathId: string, from: HTMLElement) => void;
	/** A choice button whose sibling path was picked instead. */
	isDimmed: (pathId: string) => boolean;
	isPicked: (pathId: string) => boolean;
	/** Non-path choices (objections, sections…) the agent has already clicked. */
	isClicked: (to: string) => boolean;
	markClicked: (to: string) => void;
	flash: string | null;
}

interface ScriptPosition {
	view: DocGroup;
	scrollTop: number;
	anchor: string;
	active: string;
	from: HTMLElement | null;
}

const GROUPS: DocGroup[] = ['script', 'objections', 'triggers'];
const VIEW_LABEL: Record<DocGroup, string> = {
	script: 'Main Flow',
	objections: 'Objections',
	triggers: 'Emotional Triggers'
};
const VIEW_COLORS: Record<DocGroup, {idle: string; selected: string}> = {
	script: {
		idle: 'text-sky-800 bg-sky-50 hover:bg-sky-100 dark:text-sky-300 dark:bg-sky-500/10 dark:hover:bg-sky-500/20',
		selected:
			'border-sky-700 bg-sky-700 text-white dark:border-sky-300 dark:bg-sky-300 dark:text-sky-950'
	},
	objections: {
		idle: 'text-rose-700 bg-rose-50 hover:bg-rose-100 dark:text-rose-300 dark:bg-rose-500/10 dark:hover:bg-rose-500/20',
		selected:
			'border-rose-700 bg-rose-700 text-white dark:border-rose-300 dark:bg-rose-300 dark:text-rose-950'
	},
	triggers: {
		idle: 'text-amber-800 bg-amber-50 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-500/10 dark:hover:bg-amber-500/20',
		selected:
			'border-amber-700 bg-amber-700 text-white dark:border-amber-300 dark:bg-amber-300 dark:text-amber-950'
	}
};
const CONTINUATION =
	'border border-sky-400 bg-sky-50 text-sky-800 hover:border-sky-500 hover:bg-sky-100 dark:border-sky-400 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20';

export function ScriptDoc({
	onCollapse,
	initialMode = 'live',
	values = NO_VALUES
}: {
	onCollapse?: () => void;
	/** Lead form + agent values for the linked blanks (read-only). */
	values?: ScriptValues;
	/** Practice previews may start in Training; real calls start in Live. */
	initialMode?: ScriptMode;
}) {
	const scrollers = useRef<Partial<Record<DocGroup, HTMLDivElement | null>>>(
		{}
	);
	const [view, setView] = useState<DocGroup>('script');
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const [mode, setMode] = useState<ScriptMode>(initialMode);
	const [active, setActive] = useState<Record<DocGroup, string>>({
		script: PANELS.script.nodes[0].id,
		objections: OBJECTION_PICKER,
		triggers: PANELS.triggers.nodes[0].id
	});
	const [stack, setStack] = useState<ScriptPosition[]>([]);
	const [restore, setRestore] = useState<ScriptPosition | null>(null);
	const [picked, setPicked] = useState<Record<string, string>>({});
	const [clicked, setClicked] = useState<ReadonlySet<string>>(() => new Set());
	const [flash, setFlash] = useState<string | null>(null);
	const flashTimer = useRef<number | undefined>(undefined);
	const [pending, setPending] = useState<string | null>(null);

	const scrollTo = useCallback((id: string) => {
		const s = scrollers.current[groupOf(id)];
		const el = s?.querySelector<HTMLElement>(
			`[data-anchor="${CSS.escape(id)}"]`
		);
		if (!s || !el) return false;
		if (id === OBJECTION_PICKER) {
			s.scrollTo({top: 0, behavior: 'instant'});
			return true;
		}
		const kind = ANCHORS.get(id)?.kind;
		const top =
			offsetIn(s, el) -
			(kind === 'objection' ? 8 : s.clientHeight * FOCUS_LINE);
		const far = Math.abs(top - s.scrollTop) > s.clientHeight * 1.5;
		s.scrollTo({
			top,
			behavior: kind === 'objection' || far ? 'instant' : 'smooth'
		});
		setFlash(id);
		window.clearTimeout(flashTimer.current);
		flashTimer.current = window.setTimeout(() => setFlash(null), 1400);
		return true;
	}, []);

	const go = (id: string) => {
		if (mode === 'live' && groupOf(id) === 'triggers') return;
		setRestore(null);
		setView(groupOf(id));
		if (groupOf(id) === 'objections') {
			setActive((current) => ({
				...current,
				objections: ANCHORS.get(id)?.nodeId ?? id
			}));
		}
		setPending(id);
	};

	useLayoutEffect(() => {
		if (restore) {
			const s = scrollers.current[restore.view];
			// Restore the pixel offset after the destination header is laid out.
			s?.scrollTo({top: restore.scrollTop, behavior: 'instant'});
			setActive((current) => ({...current, [restore.view]: restore.active}));
			if (restore.from?.isConnected) restore.from.focus({preventScroll: true});
			setRestore(null);
		} else if (pending && scrollTo(pending)) setPending(null);
	}, [pending, restore, view, scrollTo]);

	const remember = (from: HTMLElement | null) => {
		const s = scrollers.current[view];
		if (!s) return;
		const position: ScriptPosition = {
			view,
			scrollTop: s.scrollTop,
			anchor: anchorAt(
				s,
				from && s.contains(from)
					? offsetIn(s, from)
					: s.scrollTop + s.clientHeight * FOCUS_LINE,
				PANELS[view].nodes[0].id
			),
			active: active[view],
			from
		};
		s.scrollTo({top: position.scrollTop, behavior: 'instant'});
		setStack((history) => [...history, position]);
	};

	const jump: JumpFn = (to, from) => {
		if (
			(!ANCHORS.has(to) && to !== OBJECTION_PICKER) ||
			(mode === 'live' && groupOf(to) === 'triggers')
		)
			return;
		remember(from);
		go(to);
	};

	const openPanel = (group: DocGroup, from: HTMLElement) => {
		if (group === view) return;
		remember(from);
		if (group === 'objections') {
			setFlash(null);
			go(OBJECTION_PICKER);
			return;
		}
		setPending(null);
		setRestore(null);
		setFlash(null);
		setView(group);
	};

	const back = () => {
		setPending(null);
		setFlash(null);
		if (!stack.length) {
			setView('script');
			return;
		}
		const target = stack[stack.length - 1];
		setStack(stack.slice(0, -1));
		setView(target.view);
		setActive((current) => ({...current, [target.view]: target.active}));
		setRestore(target);
	};
	const backRef = useRef(back);
	backRef.current = back;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.altKey && e.key === 'ArrowLeft') {
				e.preventDefault();
				backRef.current();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	const reset = () => {
		setPicked({});
		setClicked(new Set());
		setStack([]);
		setRestore(null);
		setPending(null);
		setFlash(null);
		setView('script');
		setActive({
			script: PANELS.script.nodes[0].id,
			objections: OBJECTION_PICKER,
			triggers: PANELS.triggers.nodes[0].id
		});
		for (const s of Object.values(scrollers.current))
			s?.scrollTo({top: 0, behavior: 'instant'});
	};

	const switchMode = (next: ScriptMode) => {
		setMode(next);
		if (next === 'live') {
			if (view === 'triggers') setView('script');
			setStack((history) =>
				history.filter((position) => position.view !== 'triggers')
			);
			setRestore(null);
			setPending(null);
		}
	};

	useEffect(() => () => window.clearTimeout(flashTimer.current), []);
	useEffect(() => {
		const cleanups = GROUPS.map((g) => {
			const s = scrollers.current[g];
			if (!s) return () => {};
			let frame = 0;
			const onScroll = () => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(() => {
					const id = anchorAt(
						s,
						s.scrollTop + s.clientHeight * FOCUS_LINE + 4,
						g === 'objections' ? OBJECTION_PICKER : PANELS[g].nodes[0].id
					);
					const nodeId = ANCHORS.get(id)?.nodeId ?? id;
					setActive((a) => (a[g] === nodeId ? a : {...a, [g]: nodeId}));
				});
			};
			s.addEventListener('scroll', onScroll, {passive: true});
			return () => {
				s.removeEventListener('scroll', onScroll);
				cancelAnimationFrame(frame);
			};
		});
		return () => cleanups.forEach((c) => c());
	}, []);

	const groupKey = (pathId: string) => PATH_GROUPS.get(pathId)?.[0] ?? pathId;
	const ctx: Ctx = {
		mode,
		values,
		jump,
		pick: (pathId, from) => {
			setPicked((p) => ({...p, [groupKey(pathId)]: pathId}));
			jump(pathId, from);
		},
		isPicked: (pathId) => picked[groupKey(pathId)] === pathId,
		isDimmed: (pathId) => {
			const chosen = picked[groupKey(pathId)];
			return Boolean(chosen && chosen !== pathId);
		},
		isClicked: (to) => clicked.has(to),
		markClicked: (to) => setClicked((c) => new Set(c).add(to)),
		flash
	};
	const backTarget = stack[stack.length - 1];
	const objectionExit =
		view === 'objections'
			? exitOf(PANELS.objections.nodes.find((n) => n.id === active.objections))
			: null;

	return (
		<Card className="flex h-[620px] min-h-0 min-w-0 flex-col gap-0 overflow-hidden py-0 shadow-xs xl:h-auto xl:flex-1 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-primary [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-primary">
			<CardHeader className="shrink-0 space-y-3 border-b p-3">
				<div className="flex items-center gap-2">
					<p className="min-w-0 flex-1 truncate text-sm font-semibold">
						{DOC_TITLE}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 shrink-0"
						disabled={!stack.length && view === 'script'}
						onClick={back}
						title={`${backTarget ? `Back to ${returnLabel(backTarget.anchor)}` : 'Back'} (Alt + ←)`}
					>
						<ArrowLeft className="size-3.5" />
						Back
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								ref={menuTrigger}
								type="button"
								variant="ghost"
								size="icon"
								className="size-8 shrink-0"
								aria-label="Script options"
								title="Script options"
							>
								<MoreHorizontal className="size-5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="w-72 [&_[role^=menuitem]]:min-h-10"
						>
							{view === 'objections' &&
								active.objections !== OBJECTION_PICKER && (
									<>
										<DropdownMenuItem
											onSelect={() =>
												jump(OBJECTION_PICKER, menuTrigger.current)
											}
										>
											Choose another objection
										</DropdownMenuItem>
										{objectionExit && (
											<DropdownMenuItem
												className="text-sky-800 dark:text-sky-300"
												onSelect={() =>
													jump(objectionExit.to, menuTrigger.current)
												}
											>
												<ArrowRight />
												Continue to {objectionExit.label}
											</DropdownMenuItem>
										)}
									</>
								)}
							<DropdownMenuSeparator />
							<DropdownMenuLabel>Script mode</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={mode}
								onValueChange={(next) => switchMode(next as ScriptMode)}
								aria-label="Script mode"
							>
								<DropdownMenuRadioItem value="live">Live</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="training">
									Training
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={reset}>
								<RotateCcw />
								Reset choices
							</DropdownMenuItem>
							{onCollapse && (
								<DropdownMenuItem onSelect={onCollapse}>
									<PanelLeftClose />
									Collapse script sidebar
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<div className="flex flex-col gap-3">
					<div
						role="group"
						aria-label="Script view"
						className="grid min-w-0 auto-cols-fr grid-flow-col gap-2"
					>
						{(mode === 'training'
							? GROUPS
							: (['script', 'objections'] as const)
						).map((g) => (
							<button
								key={g}
								type="button"
								aria-pressed={view === g}
								onClick={(e) => openPanel(g, e.currentTarget)}
								className={cn(
									'min-h-10 min-w-0 rounded-md border px-3 py-2 text-sm font-semibold leading-5 transition-colors',
									view === g
										? cn(VIEW_COLORS[g].selected, 'shadow-xs')
										: cn(
												VIEW_COLORS[g].idle,
												g === 'script'
													? 'border-sky-200 dark:border-sky-500/30'
													: g === 'objections'
														? 'border-rose-200 dark:border-rose-500/30'
														: 'border-amber-200 dark:border-amber-500/30'
											)
								)}
							>
								{VIEW_LABEL[g]}
							</button>
						))}
					</div>
				</div>
				{view !== 'objections' && (
					<div className="flex flex-wrap gap-1">
						{PANELS[view].nodes.map((n) => (
							<button
								key={n.id}
								type="button"
								aria-current={active[view] === n.id ? 'location' : undefined}
								onClick={(e) => jump(n.id, e.currentTarget)}
								className={cn(
									'rounded px-1.5 py-0.5 text-xs transition-colors',
									active[view] === n.id
										? 'bg-primary/10 font-medium text-primary'
										: 'text-muted-foreground hover:bg-muted hover:text-foreground'
								)}
							>
								{n.short ?? n.title}
							</button>
						))}
					</div>
				)}
			</CardHeader>
			<CardContent className="relative min-h-0 flex-1 px-0 pb-0">
				{GROUPS.map((g) => (
					<div
						key={g}
						data-panel={g}
						ref={(el) => {
							scrollers.current[g] = el;
						}}
						className={cn(
							'absolute inset-0 overflow-y-auto overscroll-contain px-3 pt-4 [overflow-anchor:none]',
							view !== g && 'invisible'
						)}
						aria-hidden={view !== g}
					>
						{g === 'objections' && (
							<section
								data-anchor={OBJECTION_PICKER}
								aria-label="Choose an objection"
								className="min-h-full pb-8"
							>
								<h2 className="mb-2 text-xl font-bold text-rose-700 dark:text-rose-300">
									Which objection are you hearing?
								</h2>
								<p className="mb-5 text-sm text-muted-foreground">
									Choose one below to jump straight to the response.
								</p>
								<div className="flex flex-col gap-3">
									{PANELS.objections.nodes.map((n) => (
										<button
											key={n.id}
											type="button"
											onClick={(e) => jump(n.id, e.currentTarget)}
											className={cn(
												'flex min-h-14 w-full items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3 text-left text-base font-semibold transition-colors',
												CHOICE.objection
											)}
										>
											<span>{n.title}</span>
											<ArrowRight aria-hidden className="size-5 shrink-0" />
										</button>
									))}
								</div>
							</section>
						)}
						{PANELS[g].nodes.map((n) => (
							<NodeView key={n.id} node={n} ctx={ctx} />
						))}
						<div aria-hidden className="h-[60%]" />
					</div>
				))}
			</CardContent>
		</Card>
	);
}

// ─────────────────────────────── content ───────────────────────────────

/** Brief highlight on a jump target, tinted by what it is. */
const FLASH: Record<AnchorKind, string> = {
	objection: 'bg-rose-100 ring-2 ring-rose-500 dark:bg-rose-500/20',
	path: 'bg-emerald-50 ring-1 ring-emerald-400 dark:bg-emerald-500/15',
	section: 'bg-primary/5 ring-1 ring-primary/20',
	trigger: 'bg-amber-50 ring-1 ring-amber-400 dark:bg-amber-500/15',
	reference: 'bg-violet-50 ring-1 ring-violet-400 dark:bg-violet-500/15'
};
const flashCls = (id: string | undefined, flash: string | null) =>
	id && flash === id ? FLASH[ANCHORS.get(id)?.kind ?? 'section'] : '';

function NodeView({node, ctx}: {node: DocNode; ctx: Ctx}) {
	return (
		<section
			data-anchor={node.id}
			className={cn(
				'-mx-1.5 mb-8 rounded-md px-1.5 py-1 transition-colors duration-500',
				flashCls(node.id, ctx.flash)
			)}
		>
			{node.eyebrow && (
				<p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
					{node.eyebrow}
				</p>
			)}
			<h2 className={cn('mb-3 text-base font-semibold', TITLE[node.kind])}>
				{node.title}
			</h2>
			<Blocks blocks={node.blocks} ctx={ctx} />
		</section>
	);
}

function Blocks({blocks, ctx}: {blocks: Block[]; ctx: Ctx}) {
	return (
		<div className="space-y-2.5">
			{blocks.map((b, i) =>
				isBlockVisible(b, ctx.mode, SCRIPT_DOC, ANCHORS) ? (
					<BlockView key={i} block={b} ctx={ctx} />
				) : null
			)}
		</div>
	);
}

function ChoiceButtons({
	options,
	ctx
}: {
	options: {label: string; to: string}[];
	ctx: Ctx;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{options.map((o) => {
				const kind = ANCHORS.get(o.to)?.kind ?? 'path';
				const isPath = kind === 'path';
				const dimmed = isPath && ctx.isDimmed(o.to);
				const chosen = isPath ? ctx.isPicked(o.to) : ctx.isClicked(o.to);
				return (
					<button
						key={o.to + o.label}
						type="button"
						aria-pressed={chosen}
						onClick={(e) => {
							if (isPath) ctx.pick(o.to, e.currentTarget);
							else {
								ctx.markClicked(o.to);
								ctx.jump(o.to, e.currentTarget);
							}
						}}
						className={cn(
							'inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-left text-sm font-medium transition-colors',
							CHOICE[kind],
							chosen && CHOICE_CLICKED[kind],
							dimmed && 'opacity-40'
						)}
					>
						{chosen && <Check className="size-3.5 shrink-0" strokeWidth={3} />}
						{o.label}
					</button>
				);
			})}
		</div>
	);
}

function BlockView({block: b, ctx}: {block: Block; ctx: Ctx}) {
	switch (b.t) {
		case 'h':
			return (
				<h3
					data-anchor={b.id}
					className={cn(
						'-mx-1 rounded px-1 pt-2 text-sm font-semibold text-sky-700 transition-colors duration-500 dark:text-sky-400',
						flashCls(b.id, ctx.flash)
					)}
				>
					{b.text}
				</h3>
			);
		case 'say':
			return (
				<p className="text-[15px] leading-6 text-foreground">
					<Inline text={b.text} ctx={ctx} />
				</p>
			);
		case 'caller':
			return (
				<p className="text-[15px] leading-6 text-muted-foreground">
					<span className="font-semibold text-foreground">Caller: </span>“
					<Inline text={b.text} ctx={ctx} />”
				</p>
			);
		case 'note':
			return (
				<p className="text-xs leading-5 text-muted-foreground italic">
					<Inline text={b.text} ctx={ctx} />
				</p>
			);
		case 'step':
			return (
				<p className="pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{b.text}
				</p>
			);
		case 'list': {
			const Tag = b.ordered ? 'ol' : 'ul';
			return (
				<Tag
					className={cn(
						'space-y-1 pl-5 text-[15px] leading-6 marker:text-muted-foreground',
						b.ordered ? 'list-decimal' : 'list-disc'
					)}
				>
					{b.items.map((item, i) => (
						<li key={i}>
							<Inline text={item} ctx={ctx} />
						</li>
					))}
				</Tag>
			);
		}
		case 'inst':
			return (
				<div className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
					<p className="mb-1 text-xs font-semibold text-violet-800 dark:text-violet-300">
						{b.title}
					</p>
					<div className="space-y-1 text-sm leading-5 text-violet-950 dark:text-violet-100">
						{b.body.map((line, i) => (
							<p key={i}>
								<Inline text={line} ctx={ctx} />
							</p>
						))}
					</div>
				</div>
			);
		case 'warn':
			return (
				<p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-sm font-medium text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
					<Inline text={b.text} ctx={ctx} />
				</p>
			);
		case 'choices': {
			// Objection options always sit under their own "Common objections" label.
			const objections = b.options.filter(
				(o) => ANCHORS.get(o.to)?.kind === 'objection'
			);
			const rest = b.options.filter(
				(o) => ANCHORS.get(o.to)?.kind !== 'objection'
			);
			return (
				<div className="space-y-2">
					{rest.length > 0 && (
						<div>
							{b.prompt && (
								<p className="mb-1 text-xs text-muted-foreground">{b.prompt}</p>
							)}
							<ChoiceButtons options={rest} ctx={ctx} />
						</div>
					)}
					{objections.length > 0 && (
						<div>
							<p className="mb-1 text-xs font-medium text-rose-700 dark:text-rose-400">
								Common objections
							</p>
							<ChoiceButtons options={objections} ctx={ctx} />
						</div>
					)}
				</div>
			);
		}
		case 'exit':
			return (
				<button
					type="button"
					onClick={(e) => ctx.jump(b.to, e.currentTarget)}
					className={cn(
						'mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
						CONTINUATION
					)}
				>
					Objection handled — return to {b.label}
					<ArrowUpRight className="size-4" />
				</button>
			);
		case 'path': {
			// Grayed until the agent picks it, so every option is visible up front.
			const dimmed = !ctx.isPicked(b.id);
			return (
				<div
					data-anchor={b.id}
					className={cn(
						'-mx-1 rounded-md border-l-2 py-1 pr-1 pl-3 transition-[opacity,background-color] duration-300',
						dimmed ? 'border-muted opacity-45 grayscale' : 'border-emerald-400',
						flashCls(b.id, ctx.flash)
					)}
				>
					<button
						type="button"
						onClick={(e) => ctx.pick(b.id, e.currentTarget)}
						title={dimmed ? 'Choose this path' : undefined}
						className="mb-2 text-left text-sm font-semibold text-emerald-700 underline decoration-emerald-400 underline-offset-4 dark:text-emerald-400"
					>
						{b.label}
					</button>
					<Blocks blocks={b.blocks} ctx={ctx} />
				</div>
			);
		}
	}
}

function Inline({text, ctx}: {text: string; ctx: Ctx}): ReactNode {
	return parseInline(text).map((tok, i) => {
		switch (tok.type) {
			case 'text':
				return tok.text;
			case 'bold':
				return (
					<strong key={i} className="font-semibold">
						{tok.text}
					</strong>
				);
			case 'blank': {
				const value = tok.source ? resolveBlank(tok.source, ctx.values) : '';
				if (value)
					return (
						<span
							key={i}
							title={tok.text || undefined}
							className="mx-0.5 rounded bg-sky-100 px-1 font-medium text-sky-900 dark:bg-sky-500/20 dark:text-sky-100"
						>
							{value}
						</span>
					);
				// A value-only blank (`{{|source}}`) shows nothing until the form has it.
				if (!tok.text) return null;
				return (
					<span
						key={i}
						className="mx-0.5 rounded border border-dashed border-amber-400 bg-amber-50 px-1 text-[0.9em] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
					>
						{tok.text}
					</span>
				);
			}
			case 'link': {
				const kind = ANCHORS.get(tok.to)?.kind ?? 'reference';
				// Live mode has no Emotional Triggers to jump to.
				if (ctx.mode === 'live' && groupOf(tok.to) === 'triggers')
					return tok.text;
				return (
					<a
						key={i}
						href={`#${tok.to}`}
						onClick={(e) => {
							e.preventDefault();
							ctx.jump(tok.to, e.currentTarget);
						}}
						className={cn(
							'font-medium underline decoration-2 underline-offset-2',
							LINK[kind]
						)}
					>
						{tok.text}
					</a>
				);
			}
		}
	});
}
