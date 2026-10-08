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
import {ChevronLeft, Loader2, RotateCcw, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {QS_SUCCESS, traversalStep} from './api';
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
	answers: (t.underwriting_items || []).map((a) => ({answer: a.answer, type: a.type}))
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

	const resetInputs = (t: ItkTraversalResponse | null) => {
		setFirst(t?.answer?.[0] && t.answer[0] !== 'current' ? t.answer[0] : '');
		setSecond(t?.answer?.[1] ?? '');
		setCurrently(t?.answer?.[0] === 'current');
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

	const choice = (opt: string, onPick: (v: string) => void, selected: boolean) => (
		<button
			key={opt}
			type="button"
			disabled={busy}
			onClick={() => onPick(opt)}
			className={cn(
				'w-full cursor-pointer rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition-colors',
				selected ? 'border-primary bg-secondary text-foreground' : 'hover:border-primary/40 hover:bg-muted'
			)}
		>
			{opt}
		</button>
	);

	return (
		<DialogPrimitive.Root open={!!target} onOpenChange={(o) => !o && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl">
					<div className="flex items-start justify-between gap-3">
						<div>
							<DialogPrimitive.Title className="text-base font-semibold">
								{target?.name}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-xs text-muted-foreground">
								{target?.isDrug ? 'Medication' : 'Health condition'} questionnaire
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button variant="ghost" size="icon" aria-label="Close">
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					{!step && busy && (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading questions…
						</p>
					)}

					{q && (
						<div className="space-y-3">
							<p className="text-sm font-medium">{q.text}</p>

							{(q.input_type === 'RADIO' || q.input_type === 'DROPDOWN') && (
								<div className="grid gap-2">
									{(q.options ?? []).map((opt) =>
										choice(opt, (v) => void submit([v]), first === opt)
									)}
								</div>
							)}

							{q.input_type === 'YES_NO' && (
								<div className="grid grid-cols-2 gap-2">
									{['Yes', 'No'].map((opt) =>
										choice(opt, (v) => void submit([v]), first === opt)
									)}
								</div>
							)}

							{(q.input_type === 'DATE' || q.input_type === 'DOUBLE_DATE') && (
								<div className="space-y-3">
									{q.currently_checkbox !== undefined && (
										<label className="flex items-center gap-2 text-sm">
											<input
												type="checkbox"
												checked={currently}
												onChange={(e) => setCurrently(e.target.checked)}
											/>
											{q.currently_text || 'Currently'}
										</label>
									)}
									{!currently && (
										<Input
											type="date"
											value={first}
											onChange={(e) => setFirst(e.target.value)}
										/>
									)}
									{q.input_type === 'DOUBLE_DATE' && (
										<>
											{q.text2 && <p className="text-sm font-medium">{q.text2}</p>}
											<Input
												type="date"
												value={second}
												onChange={(e) => setSecond(e.target.value)}
											/>
										</>
									)}
									<Button onClick={() => void submit()} disabled={busy || !answerValues()}>
										{busy && <Loader2 className="size-4 animate-spin" />}
										Next
									</Button>
								</div>
							)}
						</div>
					)}

					{error && <p className="text-sm text-destructive">{error}</p>}

					{step && (
						<div className="flex gap-2 border-t pt-3">
							<Button
								variant="outline"
								size="sm"
								disabled={busy || !step.has_prev}
								onClick={() => void nav('prev')}
							>
								<ChevronLeft className="size-4" /> Back
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => void nav('edit')}
							>
								<RotateCcw className="size-4" /> Start over
							</Button>
						</div>
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
