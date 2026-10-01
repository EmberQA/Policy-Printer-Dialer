/**
 * Hyperlinked script doc — a playground, NOT the ENG-278 script engine.
 * Think "text doc with jump links": every [link](#id) / choice button scrolls
 * to its target, and the place you jumped FROM is pushed on a back stack.
 *
 * The Script panel is always open. Objections / Emotional Triggers open as
 * their own panels to the LEFT (on demand — via a link or the header button),
 * so an agent can dig deeper without losing their place in the script.
 * Picking a path grays out its sibling paths. Far jumps are instant.
 */

import {useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, Check, ArrowUpRight, PanelLeftClose, RotateCcw, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {DOC_TITLE, SCRIPT_DOC} from './content';
import {buildAnchorIndex, buildPathGroups, findBrokenLinks, parseInline} from './core';
import type {AnchorKind, Block, DocGroup, DocNode} from './types';

const ANCHORS = buildAnchorIndex(SCRIPT_DOC);
const PATH_GROUPS = buildPathGroups(SCRIPT_DOC, ANCHORS);
const NODE_GROUP = new Map(SCRIPT_DOC.map((n) => [n.id, n.group]));
const groupOf = (anchorId: string): DocGroup => NODE_GROUP.get(ANCHORS.get(anchorId)?.nodeId ?? '') ?? 'script';
if (import.meta.env.DEV) {
	const broken = findBrokenLinks(SCRIPT_DOC, ANCHORS);
	if (broken.length) console.warn('[ScriptDoc] broken links:', broken);
}

const PANELS: Record<DocGroup, {title: string; nodes: DocNode[]}> = {
	script: {title: DOC_TITLE, nodes: SCRIPT_DOC.filter((n) => n.group === 'script')},
	objections: {title: 'Common Objections', nodes: SCRIPT_DOC.filter((n) => n.group === 'objections')},
	triggers: {title: 'Emotional Triggers', nodes: SCRIPT_DOC.filter((n) => n.group === 'triggers')}
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
const CHOICE: Record<AnchorKind, string> = {
	objection: 'border-rose-200 text-rose-700 hover:border-rose-500 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10',
	path: 'border-emerald-200 text-emerald-800 hover:border-emerald-500 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10',
	section: 'border-sky-200 text-sky-800 hover:border-sky-500 hover:bg-sky-50 dark:border-sky-500/30 dark:text-sky-300 dark:hover:bg-sky-500/10',
	trigger: 'border-amber-200 text-amber-800 hover:border-amber-500 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10',
	reference: 'border-violet-200 text-violet-800 hover:border-violet-500 hover:bg-violet-50 dark:border-violet-500/30 dark:text-violet-300 dark:hover:bg-violet-500/10'
};
/** Filled look for a choice that's already been clicked. */
const CHOICE_CLICKED: Record<AnchorKind, string> = {
	objection: 'border-rose-500 bg-rose-100 dark:bg-rose-500/20',
	path: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15',
	section: 'border-sky-500 bg-sky-100 dark:bg-sky-500/20',
	trigger: 'border-amber-500 bg-amber-100 dark:bg-amber-500/20',
	reference: 'border-violet-500 bg-violet-100 dark:bg-violet-500/20'
};
const TITLE: Record<AnchorKind, string> = {
	objection: 'text-rose-700 dark:text-rose-400',
	path: 'text-emerald-700 dark:text-emerald-400',
	section: 'text-foreground',
	trigger: 'text-amber-700 dark:text-amber-400',
	reference: 'text-violet-700 dark:text-violet-400'
};

// ───────────────────────────── scroll helpers ─────────────────────────────

const offsetIn = (scroller: HTMLElement, el: HTMLElement) =>
	el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

/** Last anchor in `scroller` starting at or above `y` (scroll coordinates). */
function anchorAt(scroller: HTMLElement, y: number, fallback: string): string {
	let found = fallback;
	for (const el of scroller.querySelectorAll<HTMLElement>('[data-anchor]')) {
		if (offsetIn(scroller, el) <= y + 1) found = el.dataset.anchor!;
		else break;
	}
	return found;
}

/** Short-hop scroll duration — slower than the browser's native smooth scroll. */
const SCROLL_MS = 750;
/** Panel slide in/out duration. */
const SLIDE_MS = 300;

const scrollFrames = new WeakMap<HTMLElement, number>();
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** rAF scroll with our own easing/duration; a wheel or touch by the agent cancels it. */
function animateScroll(s: HTMLElement, top: number, ms = SCROLL_MS) {
	cancelAnimationFrame(scrollFrames.get(s) ?? 0);
	const from = s.scrollTop;
	const delta = top - from;
	const start = performance.now();
	const stop = () => {
		cancelAnimationFrame(scrollFrames.get(s) ?? 0);
		s.removeEventListener('wheel', stop);
		s.removeEventListener('touchstart', stop);
	};
	s.addEventListener('wheel', stop, {passive: true, once: true});
	s.addEventListener('touchstart', stop, {passive: true, once: true});
	const step = (now: number) => {
		const t = Math.min(1, (now - start) / ms);
		s.scrollTop = from + delta * easeInOutCubic(t);
		if (t < 1) scrollFrames.set(s, requestAnimationFrame(step));
		else stop();
	};
	scrollFrames.set(s, requestAnimationFrame(step));
}

/** Short name for an anchor: a heading's own text, or the section a path sits in. */
function returnLabel(id: string): string {
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
	jump: JumpFn;
	pick: (pathId: string, from: HTMLElement) => void;
	isDimmed: (pathId: string) => boolean;
	isPicked: (pathId: string) => boolean;
	/** Non-path choices (objections, sections…) the agent has already clicked. */
	isClicked: (to: string) => boolean;
	markClicked: (to: string) => void;
	flash: string | null;
	/** Inline "Back to – X" button for the header at `anchorId`, if we just jumped there via a blue link. */
	returnButton: (anchorId: string) => ReactNode;
}

export function ScriptDoc({
	onCollapse,
	onPanelCountChange
}: {
	onCollapse?: () => void;
	/** 1 = script only; 2–3 when objections / triggers panels are open. */
	onPanelCountChange?: (count: number) => void;
}) {
	const scrollers = useRef<Partial<Record<DocGroup, HTMLDivElement | null>>>({});
	/** Extra panels, newest first (renders leftmost). */
	const [extra, setExtra] = useState<DocGroup[]>([]);
	/** Panels mid slide-out; dropped from `extra` once the animation ends. */
	const [closing, setClosing] = useState<ReadonlySet<DocGroup>>(() => new Set());
	const closeTimers = useRef<Partial<Record<DocGroup, number>>>({});
	const [stack, setStack] = useState<string[]>([]);
	/** Picked path per group, keyed by the group's first path id. */
	const [picked, setPicked] = useState<Record<string, string>>({});
	const [clicked, setClicked] = useState<ReadonlySet<string>>(() => new Set());
	const [flash, setFlash] = useState<string | null>(null);
	const flashTimer = useRef<number | undefined>(undefined);
	/** Target to scroll to once its (just-opened) panel has mounted. */
	const [pending, setPending] = useState<string | null>(null);
	/** Set after a blue-link (section) jump: show "Back to – origin" on the target's header. */
	const [returnTo, setReturnTo] = useState<{at: string; origin: string} | null>(null);

	useEffect(() => onPanelCountChange?.(1 + extra.length), [extra.length, onPanelCountChange]);

	const isOpen = (g: DocGroup) => g === 'script' || (extra.includes(g) && !closing.has(g));
	const open = (g: DocGroup) => {
		if (g === 'script') return;
		window.clearTimeout(closeTimers.current[g]);
		setClosing((c) => {
			if (!c.has(g)) return c;
			const next = new Set(c);
			next.delete(g);
			return next;
		});
		setExtra((e) => (e.includes(g) ? e : [g, ...e]));
	};
	const close = (g: DocGroup) => {
		if (!isOpen(g)) return;
		setClosing((c) => new Set(c).add(g));
		window.clearTimeout(closeTimers.current[g]);
		closeTimers.current[g] = window.setTimeout(() => {
			setExtra((e) => e.filter((x) => x !== g));
			setClosing((c) => {
				const next = new Set(c);
				next.delete(g);
				return next;
			});
		}, SLIDE_MS);
	};

	const scrollTo = useCallback((id: string) => {
		const s = scrollers.current[groupOf(id)];
		const el = s?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(id)}"]`);
		if (!s || !el) return false;
		// Objections land flush at the top of their panel; everything else just below it.
		const kind = ANCHORS.get(id)?.kind;
		const top = offsetIn(s, el) - (kind === 'objection' ? 8 : s.clientHeight * FOCUS_LINE);
		// Nearby: slow glide. Far (another section / objection): just go.
		const far = Math.abs(top - s.scrollTop) > s.clientHeight * 1.5;
		if (far) {
			cancelAnimationFrame(scrollFrames.get(s) ?? 0);
			s.scrollTop = top;
		} else animateScroll(s, top);
		el.closest('[data-panel]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
		setFlash(id);
		window.clearTimeout(flashTimer.current);
		flashTimer.current = window.setTimeout(() => setFlash(null), kind === 'objection' ? 1800 : 1200);
		return true;
	}, []);

	/** Scroll now if the panel is open; otherwise open it and scroll after mount. */
	const go = (id: string) => {
		const g = groupOf(id);
		if (isOpen(g) && scrollers.current[g]) scrollTo(id);
		else {
			open(g);
			setPending(id);
		}
	};

	useLayoutEffect(() => {
		if (pending && scrollTo(pending)) setPending(null);
	}, [pending, extra, scrollTo]);

	const jump: JumpFn = (to, from) => {
		if (!ANCHORS.has(to)) return;
		const fromGroup = (from?.closest('[data-panel]') as HTMLElement | null)?.dataset.panel as DocGroup | undefined;
		const s = fromGroup && scrollers.current[fromGroup];
		let origin: string | null = null;
		if (s && from && s.contains(from)) {
			origin = anchorAt(s, offsetIn(s, from), PANELS[fromGroup].nodes[0].id);
			const o = origin;
			if (o !== to) setStack((st) => (st[st.length - 1] === o ? st : [...st, o]));
		}
		// Blue link within the script (not an objection's escape hatch) → offer a way straight back.
		const blue = ANCHORS.get(to)?.kind === 'section' && fromGroup !== 'objections';
		setReturnTo(blue && origin && origin !== to ? {at: to, origin} : null);
		go(to);
		// Leaving an objection for the script (blue link / escape hatch) = objection handled: close it.
		if (fromGroup === 'objections' && groupOf(to) === 'script') close('objections');
	};

	const groupKey = (pathId: string) => PATH_GROUPS.get(pathId)?.[0] ?? pathId;
	const ctx: Ctx = {
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
		returnButton: (anchorId) => {
			if (returnTo?.at !== anchorId) return null;
			const {origin} = returnTo;
			return (
				<button
					type="button"
					onClick={() => {
						setReturnTo(null);
						setStack((st) => (st[st.length - 1] === origin ? st.slice(0, -1) : st));
						go(origin);
					}}
					className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-600 px-2 py-0.5 align-middle text-xs font-medium text-white shadow-xs transition-colors hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400"
				>
					<ArrowUpRight className="size-3.5" />
					Back to – {returnLabel(origin)}
				</button>
			);
		},
		isClicked: (to) => clicked.has(to),
		markClicked: (to) => setClicked((c) => new Set(c).add(to)),
		flash
	};

	const back = () => {
		setReturnTo(null);
		if (!stack.length) return;
		const target = stack[stack.length - 1];
		setStack(stack.slice(0, -1));
		go(target);
	};
	const backRef = useRef(back);
	backRef.current = back;

	const reset = () => {
		setPicked({});
		setClicked(new Set());
		setStack([]);
		setReturnTo(null);
		for (const s of Object.values(scrollers.current)) s?.scrollTo({top: 0});
	};

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

	useEffect(
		() => () => {
			window.clearTimeout(flashTimer.current);
			for (const t of Object.values(closeTimers.current)) window.clearTimeout(t);
		},
		[]
	);

	const register = (g: DocGroup) => (el: HTMLDivElement | null) => {
		scrollers.current[g] = el;
	};

	return (
		<div className="flex items-start gap-3">
			{extra.map((g) => (
				<SlideFromLeft key={g} closing={closing.has(g)}>
					<Panel group={g} ctx={ctx} scrollerRef={register(g)}>
						<Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Close ${PANELS[g].title}`} onClick={() => close(g)}>
							<X className="size-4" />
						</Button>
					</Panel>
				</SlideFromLeft>
			))}
			<Panel
				group="script"
				ctx={ctx}
				scrollerRef={register('script')}
				className="min-w-[28rem] flex-1"
				subheader={
					<div className="flex gap-1">
						{(['objections', 'triggers'] as const).map((g) => (
							<button
								key={g}
								type="button"
								onClick={() => (isOpen(g) ? close(g) : open(g))}
								className={cn(
									'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
									g === 'objections' ? CHOICE.objection : CHOICE.trigger,
									isOpen(g) && (g === 'objections' ? 'bg-rose-50 dark:bg-rose-500/15' : 'bg-amber-50 dark:bg-amber-500/15')
								)}
							>
								{isOpen(g) ? 'Hide' : 'Open'} {PANELS[g].title}
							</button>
						))}
					</div>
				}
			>
				<Button type="button" variant="outline" size="sm" className="h-7" disabled={!stack.length} onClick={back} title="Back to where you jumped from (Alt + ←)">
					<ArrowLeft className="size-3.5" />
					Back
				</Button>
				<Button type="button" variant="ghost" size="icon" className="size-7" title="Reset choices" onClick={reset}>
					<RotateCcw className="size-4" />
				</Button>
				{onCollapse && (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="w-6 shrink-0 p-0 text-[#4338ca] hover:bg-[#eef2ff] hover:text-[#3730a3] dark:text-[#818cf8]"
						aria-label="Collapse script sidebar"
						title="Collapse script sidebar"
						onClick={onCollapse}
					>
						<PanelLeftClose className="size-4" />
					</Button>
				)}
			</Panel>
		</div>
	);
}

/**
 * Slides an extra panel in from the left on mount and back out when `closing`.
 * The outer width animates too, so the script panel eases over instead of jumping.
 */
function SlideFromLeft({closing, children}: {closing: boolean; children: ReactNode}) {
	const [entered, setEntered] = useState(false);
	useEffect(() => {
		// Two frames so the collapsed start state paints before transitioning.
		let f2 = 0;
		const f1 = requestAnimationFrame(() => {
			f2 = requestAnimationFrame(() => setEntered(true));
		});
		return () => {
			cancelAnimationFrame(f1);
			cancelAnimationFrame(f2);
		};
	}, []);
	const shown = entered && !closing;
	return (
		<div
			className="shrink-0 overflow-hidden transition-[width,margin-right] ease-out"
			// -0.75rem cancels the flex gap while collapsed.
			style={{width: shown ? '27rem' : 0, marginRight: shown ? 0 : '-0.75rem', transitionDuration: `${SLIDE_MS}ms`}}
		>
			<div
				className="w-[27rem] transition-[transform,opacity] ease-out"
				style={{transform: shown ? 'none' : 'translateX(-100%)', opacity: shown ? 1 : 0, transitionDuration: `${SLIDE_MS}ms`}}
			>
				{children}
			</div>
		</div>
	);
}

/** One scrollable card: header (title + actions + section chips) and its group's nodes. */
function Panel({
	group,
	ctx,
	scrollerRef,
	className,
	subheader,
	children
}: {
	group: DocGroup;
	ctx: Ctx;
	scrollerRef: (el: HTMLDivElement | null) => void;
	className?: string;
	subheader?: ReactNode;
	/** Header actions, right-aligned. */
	children?: ReactNode;
}) {
	const {title, nodes} = PANELS[group];
	const localRef = useRef<HTMLDivElement | null>(null);
	const [active, setActive] = useState(nodes[0].id);

	useEffect(() => {
		const s = localRef.current;
		if (!s) return;
		let frame = 0;
		const onScroll = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const id = anchorAt(s, s.scrollTop + s.clientHeight * FOCUS_LINE + 4, nodes[0].id);
				setActive(ANCHORS.get(id)?.nodeId ?? id);
			});
		};
		s.addEventListener('scroll', onScroll, {passive: true});
		return () => {
			s.removeEventListener('scroll', onScroll);
			cancelAnimationFrame(frame);
		};
	}, [nodes]);

	return (
		<Card data-panel={group} className={cn('flex h-[70vh] min-h-[28rem] flex-col gap-0 py-0 shadow-xs xl:h-[calc(100dvh-10rem)]', className)}>
			<CardHeader className="space-y-1.5 border-b px-2 pt-1.5 pb-2">
				<div className="flex items-center gap-1">
					<p className={cn('min-w-0 flex-1 truncate text-sm font-semibold', group === 'objections' && TITLE.objection, group === 'triggers' && TITLE.trigger)}>{title}</p>
					{children}
				</div>
				{subheader}
				<div className="flex flex-wrap gap-1">
					{nodes.map((n) => (
						<button
							key={n.id}
							type="button"
							onClick={(e) => ctx.jump(n.id, e.currentTarget)}
							className={cn(
								'rounded px-1.5 py-0.5 text-xs transition-colors',
								active === n.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
							)}
						>
							{n.short ?? n.title}
						</button>
					))}
				</div>
			</CardHeader>
			<CardContent className="min-h-0 flex-1 px-0 pb-0">
				<div
					ref={(el) => {
						localRef.current = el;
						scrollerRef(el);
					}}
					className="h-full overflow-y-auto overscroll-contain px-3 pt-4"
					style={{
						maskImage: 'linear-gradient(to bottom, transparent 0, black 1.5rem, black calc(100% - 4rem), transparent 100%)',
						WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 1.5rem, black calc(100% - 4rem), transparent 100%)'
					}}
				>
					{nodes.map((n) => <NodeView key={n.id} node={n} ctx={ctx} />)}
					<div aria-hidden className="h-[60vh]" />
				</div>
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
		<section data-anchor={node.id} className={cn('-mx-1.5 mb-8 rounded-md px-1.5 py-1 transition-colors duration-500', flashCls(node.id, ctx.flash))}>
			{node.eyebrow && <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{node.eyebrow}</p>}
			<h2 className={cn('mb-3 text-base font-semibold', TITLE[node.kind])}>
				{node.title}
				{ctx.returnButton(node.id)}
			</h2>
			<Blocks blocks={node.blocks} ctx={ctx} />
		</section>
	);
}

function Blocks({blocks, ctx}: {blocks: Block[]; ctx: Ctx}) {
	return <div className="space-y-2.5">{blocks.map((b, i) => <BlockView key={i} block={b} ctx={ctx} />)}</div>;
}

function ChoiceButtons({options, ctx}: {options: {label: string; to: string}[]; ctx: Ctx}) {
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
				<h3 data-anchor={b.id} className={cn('-mx-1 rounded px-1 pt-2 text-sm font-semibold text-sky-700 transition-colors duration-500 dark:text-sky-400', flashCls(b.id, ctx.flash))}>
					{b.text}
					{b.id && ctx.returnButton(b.id)}
				</h3>
			);
		case 'say':
			return <p className="text-[15px] leading-6 text-foreground"><Inline text={b.text} ctx={ctx} /></p>;
		case 'caller':
			return <p className="text-[15px] leading-6 text-muted-foreground"><span className="font-semibold text-foreground">Caller: </span>“<Inline text={b.text} ctx={ctx} />”</p>;
		case 'note':
			return <p className="text-xs leading-5 text-muted-foreground italic"><Inline text={b.text} ctx={ctx} /></p>;
		case 'step':
			return <p className="pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{b.text}</p>;
		case 'list': {
			const Tag = b.ordered ? 'ol' : 'ul';
			return (
				<Tag className={cn('space-y-1 pl-5 text-[15px] leading-6 marker:text-muted-foreground', b.ordered ? 'list-decimal' : 'list-disc')}>
					{b.items.map((item, i) => <li key={i}><Inline text={item} ctx={ctx} /></li>)}
				</Tag>
			);
		}
		case 'inst':
			return (
				<div className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
					<p className="mb-1 text-xs font-semibold text-violet-800 dark:text-violet-300">{b.title}</p>
					<div className="space-y-1 text-sm leading-5 text-violet-950 dark:text-violet-100">
						{b.body.map((line, i) => <p key={i}><Inline text={line} ctx={ctx} /></p>)}
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
			const objections = b.options.filter((o) => ANCHORS.get(o.to)?.kind === 'objection');
			const rest = b.options.filter((o) => ANCHORS.get(o.to)?.kind !== 'objection');
			return (
				<div className="space-y-2">
					{rest.length > 0 && (
						<div>
							{b.prompt && <p className="mb-1 text-xs text-muted-foreground">{b.prompt}</p>}
							<ChoiceButtons options={rest} ctx={ctx} />
						</div>
					)}
					{objections.length > 0 && (
						<div>
							<p className="mb-1 text-xs font-medium text-rose-700 dark:text-rose-400">Common objections</p>
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
					className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-2 py-1.5 text-sm font-medium text-sky-800 transition-colors hover:border-sky-500 hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
				>
					Objection handled — return to {b.label}
					<ArrowUpRight className="size-4" />
				</button>
			);
		case 'path': {
			const dimmed = ctx.isDimmed(b.id);
			return (
				<div
					data-anchor={b.id}
					className={cn(
						'-mx-1 rounded-md border-l-2 py-1 pr-1 pl-3 transition-[opacity,background-color] duration-300',
						dimmed ? 'border-muted opacity-35 grayscale' : 'border-emerald-400',
						flashCls(b.id, ctx.flash)
					)}
				>
					<button
						type="button"
						onClick={(e) => ctx.pick(b.id, e.currentTarget)}
						title={dimmed ? 'Switch to this path' : undefined}
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
				return <strong key={i} className="font-semibold">{tok.text}</strong>;
			case 'blank':
				return (
					<span key={i} className="mx-0.5 rounded border border-dashed border-amber-400 bg-amber-50 px-1 text-[0.9em] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
						{tok.text}
					</span>
				);
			case 'link': {
				const kind = ANCHORS.get(tok.to)?.kind ?? 'reference';
				return (
					<a
						key={i}
						href={`#${tok.to}`}
						onClick={(e) => {
							e.preventDefault();
							ctx.jump(tok.to, e.currentTarget);
						}}
						className={cn('font-medium underline decoration-2 underline-offset-2', LINK[kind])}
					>
						{tok.text}
					</a>
				);
			}
		}
	});
}
