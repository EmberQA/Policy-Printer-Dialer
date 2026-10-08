/**
 * ITK questionnaire walk for one medication / health condition (ENG-286).
 *
 * start (or resume by session_id) → answer each question → when ITK reports no
 * further questions AND the current one is answered, hand the finished
 * underwriting item back. The in-progress session id is reported up so the
 * page can save it and offer "resume" after a reload; if ITK has expired it,
 * we silently start over.
 */

import {useEffect, useState} from 'react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {
	Check,
	ChevronLeft,
	ChevronRight,
	HeartPulse,
	Loader2,
	Pill,
	RotateCcw,
	Search,
	X
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {QS_SUCCESS, traversalStep} from './api';
import {DateField} from './DateField';
import {Segmented} from './fields';
import type {ItkTraversalResponse, ItkUnderwritingItem, TraversalAction} from './types';

export interface TraversalTarget {
	name: string;
	isDrug: boolean;
	resumeSessionId?: string | null;
}

const isComplete = (t: ItkTraversalResponse) =>
	!t.has_next && (!t.question || (t.answer !== null && t.answer.length > 0));

const buildItem = (t: ItkTraversalResponse): ItkUnderwritingItem => ({
	name: t.name,
	type: t.is_drug ? 'Drug' : 'Health Condition',
	hospitalization: false,
	hospitalizationReason: null,
	// Keep `question`: several yes_no answers are only distinguishable by it.
	answers: (t.underwriting_items || []).map((a) => ({
		answer: a.answer,
		type: a.type,
		...(a.question ? {question: a.question} : {})
	}))
});

export function TraversalDialog({
	target,
	onClose,
	onComplete,
	onSessionChange
}: {
	target: TraversalTarget | null;
	onClose: () => void;
	onComplete: (item: ItkUnderwritingItem) => void;
	onSessionChange: (sessionId: string | null) => void;
}) {
	const [step, setStep] = useState<ItkTraversalResponse | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [first, setFirst] = useState('');
	const [second, setSecond] = useState('');
	const [currently, setCurrently] = useState(false);
	const [optionFilter, setOptionFilter] = useState('');

	const resetInputs = (t: ItkTraversalResponse | null) => {
		setFirst(t?.answer?.[0] && t.answer[0] !== 'current' ? t.answer[0] : '');
		setSecond(t?.answer?.[1] ?? '');
		setCurrently(t?.answer?.[0] === 'current');
		setOptionFilter('');
	};

	const apply = (t: ItkTraversalResponse) => {
		onSessionChange(t.session_id);
		if (isComplete(t)) {
			onSessionChange(null);
			onComplete(buildItem(t));
			return;
		}
		setStep(t);
		resetInputs(t);
	};

	const call = async (
		action: TraversalAction,
		body: Parameters<typeof traversalStep>[1]
	): Promise<ItkTraversalResponse | null> => {
		setBusy(true);
		setError(null);
		try {
			const res = await traversalStep(action, body);
			if (res.statusCode !== QS_SUCCESS || !res.traversal) {
				setError(res.statusMessage || 'Questionnaire step failed');
				return null;
			}
			return res.traversal;
		} catch (err: any) {
			setError(err?.message || 'Questionnaire step failed');
			return null;
		} finally {
			setBusy(false);
		}
	};

	useEffect(() => {
		if (!target) {
			setStep(null);
			return;
		}
		let cancelled = false;
		(async () => {
			let t = target.resumeSessionId
				? await call('get', {session_id: target.resumeSessionId})
				: null;
			if (!t) t = await call('start', {name: target.name, is_drug: target.isDrug});
			if (!cancelled && t) apply(t);
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [target]);

	const q = step?.question ?? null;

	const answerValues = (): string[] | null => {
		if (!q) return null;
		if (q.input_type === 'DOUBLE_DATE') {
			const a = currently ? 'current' : first;
			return a && second ? [a, second] : null;
		}
		if (q.input_type === 'DATE' && q.currently_checkbox !== undefined && currently) {
			return ['current'];
		}
		return first ? [first] : null;
	};

	const submit = async (values?: string[]) => {
		if (!step) return;
		const answer = values ?? answerValues();
		if (!answer) return;
		const t = await call('answer', {session_id: step.session_id, answer});
		if (t) apply(t);
	};

	const nav = async (action: 'prev' | 'edit') => {
		if (!step) return;
		const t = await call(action, {session_id: step.session_id});
		if (t) {
			setStep(t);
			resetInputs(t);
		}
	};

	const options = q?.options ?? [];
	const searchable = options.length > 8;
	const visibleOptions = searchable
		? options.filter((o) => o.toLowerCase().includes(optionFilter.trim().toLowerCase()))
		: options;
	const isDate = q?.input_type === 'DATE' || q?.input_type === 'DOUBLE_DATE';
	const questionNumber = (step?.underwriting_items?.length ?? 0) + 1;
	const Icon = target?.isDrug ? Pill : HeartPulse;

	return (
		<DialogPrimitive.Root open={!!target} onOpenChange={(o) => !o && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
					{/* Header */}
					<div className="flex items-center gap-3 border-b px-5 py-4">
						<span
							className={cn(
								'flex size-10 shrink-0 items-center justify-center rounded-xl',
								target?.isDrug ? 'bg-secondary text-primary' : 'bg-orange-50 text-orange-600'
							)}
						>
							<Icon className="size-5" />
						</span>
						<div className="min-w-0 flex-1">
							<DialogPrimitive.Title className="truncate text-base font-semibold">
								{target?.name}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-xs text-muted-foreground">
								{target?.isDrug ? 'Medication' : 'Health condition'} · Question {questionNumber}
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Close">
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					{/* Body */}
					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
						{!step && busy && (
							<div className="space-y-3">
								<div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
								<div className="h-12 animate-pulse rounded-xl bg-muted" />
								<div className="h-12 animate-pulse rounded-xl bg-muted" />
							</div>
						)}

						{q && (
							<div className={cn('space-y-4 transition-opacity', busy && 'opacity-60')}>
								<p className="text-[15px] font-medium leading-snug">{q.text}</p>

								{(q.input_type === 'RADIO' || q.input_type === 'DROPDOWN') && (
									<div className="space-y-2">
										{searchable && (
											<div className="relative">
												<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
												<Input
													value={optionFilter}
													onChange={(e) => setOptionFilter(e.target.value)}
													placeholder={`Search ${options.length} options`}
													className="h-10 pl-9"
													autoFocus
												/>
											</div>
										)}
										<div className="grid gap-2">
											{visibleOptions.map((opt) => {
												const selected = first === opt;
												return (
													<button
														key={opt}
														type="button"
														disabled={busy}
														onClick={() => void submit([opt])}
														className={cn(
															'group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all',
															selected
																? 'border-primary bg-secondary ring-1 ring-primary'
																: 'hover:border-primary/50 hover:bg-muted/60'
														)}
													>
														<span
															className={cn(
																'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
																selected ? 'border-primary bg-primary' : 'group-hover:border-primary/60'
															)}
														>
															{selected && <span className="size-1.5 rounded-full bg-white" />}
														</span>
														<span className="flex-1">{opt}</span>
														<ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
													</button>
												);
											})}
											{!visibleOptions.length && (
												<p className="py-4 text-center text-sm text-muted-foreground">No matching options</p>
											)}
										</div>
									</div>
								)}

								{q.input_type === 'YES_NO' && (
									<div className="grid grid-cols-2 gap-3">
										{['Yes', 'No'].map((opt) => (
											<button
												key={opt}
												type="button"
												disabled={busy}
												onClick={() => void submit([opt])}
												className={cn(
													'flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-base font-semibold transition-all',
													first === opt
														? 'border-primary bg-secondary text-primary ring-1 ring-primary'
														: 'hover:border-primary/50 hover:bg-muted/60'
												)}
											>
												{opt === 'Yes' ? (
													<Check className="size-5 text-success" />
												) : (
													<X className="size-5 text-destructive" />
												)}
												{opt}
											</button>
										))}
									</div>
								)}

								{isDate && (
									<div className="space-y-4">
										{q.currently_checkbox !== undefined && (
											<Segmented
												className="w-full"
												value={currently ? 'current' : 'past'}
												options={[
													{value: 'current', label: q.currently_text || 'Currently'},
													{value: 'past', label: 'Pick a date'}
												]}
												onChange={(v) => setCurrently(v === 'current')}
											/>
										)}
										{!currently && <DateField value={first} onChange={setFirst} autoFocus label={q.text} />}
										{q.input_type === 'DOUBLE_DATE' && (
											<div className="space-y-2">
												{q.text2 && <p className="text-sm font-medium">{q.text2}</p>}
												<DateField value={second} onChange={setSecond} label={q.text2 ?? 'Second date'} />
											</div>
										)}
									</div>
								)}
							</div>
						)}

						{error && (
							<p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
						)}
					</div>

					{/* Footer */}
					{step && (
						<div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-5 py-3">
							<div className="flex gap-1">
								<Button
									variant="ghost"
									size="sm"
									disabled={busy || !step.has_prev}
									onClick={() => void nav('prev')}
								>
									<ChevronLeft className="size-4" /> Back
								</Button>
								<Button variant="ghost" size="sm" disabled={busy} onClick={() => void nav('edit')}>
									<RotateCcw className="size-3.5" /> Start over
								</Button>
							</div>
							{isDate ? (
								<Button size="sm" onClick={() => void submit()} disabled={busy || !answerValues()}>
									{busy && <Loader2 className="size-4 animate-spin" />}
									Continue
									{!busy && <ChevronRight className="size-4" />}
								</Button>
							) : (
								busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />
							)}
						</div>
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
