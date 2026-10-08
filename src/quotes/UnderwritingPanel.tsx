/**
 * "Drug and Health Information" (ENG-286): search a health condition or a
 * medication, walk its ITK questionnaire, and keep the finished underwriting
 * items that ride every quote. Editing an item re-runs its questionnaire and
 * replaces it in place.
 */

import {useEffect, useRef, useState} from 'react';
import {HeartPulse, Loader2, Pencil, Pill, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {QS_SUCCESS, searchUnderwriting} from './api';
import {TraversalDialog, type TraversalTarget} from './TraversalDialog';
import type {ItkUnderwritingItem, PendingTraversal} from './types';

const SEARCH_DEBOUNCE_MS = 250;

export function useUnderwritingSearch(kind: 'drug' | 'condition', term: string) {
	const [results, setResults] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const q = term.trim();
		if (q.length < 2) {
			setResults([]);
			return;
		}
		let cancelled = false;
		const t = window.setTimeout(async () => {
			setBusy(true);
			try {
				const res = await searchUnderwriting(kind, q);
				if (!cancelled) setResults(res.statusCode === QS_SUCCESS ? (res.results ?? []) : []);
			} finally {
				if (!cancelled) setBusy(false);
			}
		}, SEARCH_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			window.clearTimeout(t);
		};
	}, [kind, term]);
	return {results, busy};
}

export function SearchBox({
	kind,
	placeholder,
	onPick
}: {
	kind: 'drug' | 'condition';
	placeholder: string;
	onPick: (name: string) => void;
}) {
	const [term, setTerm] = useState('');
	const [open, setOpen] = useState(false);
	const {results, busy} = useUnderwritingSearch(kind, term);
	const boxRef = useRef<HTMLDivElement>(null);
	const Icon = kind === 'drug' ? Pill : HeartPulse;

	useEffect(() => {
		const onDoc = (e: MouseEvent) => {
			if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, []);

	const pick = (name: string) => {
		setTerm('');
		setOpen(false);
		onPick(name);
	};

	return (
		<div ref={boxRef} className="relative">
			<Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				value={term}
				placeholder={placeholder}
				onChange={(e) => {
					setTerm(e.target.value);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				className="bg-card pl-9 pr-9"
			/>
			{busy && (
				<Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
			)}
			{open && results.length > 0 && (
				<ul className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
					{results.map((r) => (
						<li key={r}>
							<button
								type="button"
								onClick={() => pick(r)}
								className="w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
							>
								{r}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

const answerSummary = (item: ItkUnderwritingItem) =>
	item.answers
		.map((a) => a.answer)
		.filter(Boolean)
		.join(' · ');

export function UnderwritingPanel({
	items,
	pending,
	onItemsChange,
	onPendingChange
}: {
	items: ItkUnderwritingItem[];
	pending: PendingTraversal | null;
	onItemsChange: (items: ItkUnderwritingItem[]) => void;
	onPendingChange: (p: PendingTraversal | null) => void;
}) {
	const [target, setTarget] = useState<(TraversalTarget & {replaceIndex?: number}) | null>(null);

	const start = (name: string, isDrug: boolean, replaceIndex?: number) =>
		setTarget({name, isDrug, replaceIndex});

	return (
		<div className="space-y-3">
			<SearchBox
				kind="condition"
				placeholder="Add a health condition"
				onPick={(n) => start(n, false)}
			/>
			<SearchBox
				kind="drug"
				placeholder="Add a medication"
				onPick={(n) => start(n, true)}
			/>

			{pending && !target && (
				<div className="flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
					<span>
						Unfinished questionnaire: <span className="font-medium">{pending.name}</span>
					</span>
					<div className="flex gap-1">
						<Button
							size="sm"
							variant="outline"
							onClick={() =>
								setTarget({
									name: pending.name,
									isDrug: pending.isDrug,
									resumeSessionId: pending.sessionId
								})
							}
						>
							Resume
						</Button>
						<Button size="sm" variant="ghost" onClick={() => onPendingChange(null)}>
							Discard
						</Button>
					</div>
				</div>
			)}

			{items.length > 0 ? (
				<ul className="divide-y rounded-lg border">
					{items.map((item, i) => {
						const Icon = item.type === 'Drug' ? Pill : HeartPulse;
						return (
							<li
								key={`${item.type}-${item.name}-${i}`}
								className="group flex items-center gap-3 px-3 py-2.5"
							>
								<span
									className={cn(
										'flex size-8 shrink-0 items-center justify-center rounded-lg',
										item.type === 'Drug'
											? 'bg-secondary text-primary'
											: 'bg-orange-50 text-orange-600'
									)}
								>
									<Icon className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">{item.name}</div>
									<div className="truncate text-xs text-muted-foreground">
										{answerSummary(item) || 'No details'}
									</div>
								</div>
								<div className="flex opacity-60 transition-opacity group-hover:opacity-100">
									<Button
										size="icon"
										variant="ghost"
										className="size-8"
										aria-label={`Edit ${item.name}`}
										onClick={() => start(item.name, item.type === 'Drug', i)}
									>
										<Pencil className="size-3.5" />
									</Button>
									<Button
										size="icon"
										variant="ghost"
										className="size-8"
										aria-label={`Remove ${item.name}`}
										onClick={() => onItemsChange(items.filter((_, j) => j !== i))}
									>
										<X className="size-3.5" />
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="text-xs text-muted-foreground">
					None added — quotes assume a healthy client.
				</p>
			)}

			<TraversalDialog
				target={target}
				onClose={() => setTarget(null)}
				onSessionChange={(sessionId) =>
					onPendingChange(
						sessionId && target
							? {name: target.name, isDrug: target.isDrug, sessionId}
							: null
					)
				}
				onComplete={(item) => {
					const idx = target?.replaceIndex;
					onItemsChange(
						idx !== undefined
							? items.map((it, j) => (j === idx ? item : it))
							: [...items, item]
					);
					setTarget(null);
				}}
			/>
		</div>
	);
}
