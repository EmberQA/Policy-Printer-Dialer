/**
 * Lookup (ENG-286): search a medication or a health condition and see its
 * first underwriting question (for a drug, the conditions it is prescribed
 * for) without touching the quote. "Add to quote" continues the same ITK
 * questionnaire and appends the finished item to the Quoter's list.
 */

import {useState} from 'react';
import {Check, HeartPulse, Loader2, Pill, Plus, Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {QS_SUCCESS, traversalStep} from './api';
import {EmptyState, Panel, Segmented} from './fields';
import {TraversalDialog, type TraversalTarget} from './TraversalDialog';
import {SearchBox} from './UnderwritingPanel';
import type {ItkTraversalResponse, ItkUnderwritingItem} from './types';

type Kind = 'drug' | 'condition';

export function LookupTab({onAddItem}: {onAddItem: (item: ItkUnderwritingItem) => void}) {
	const [kind, setKind] = useState<Kind>('drug');
	const [selected, setSelected] = useState<string | null>(null);
	const [first, setFirst] = useState<ItkTraversalResponse | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [target, setTarget] = useState<TraversalTarget | null>(null);
	const [added, setAdded] = useState<string | null>(null);
	const isDrug = kind === 'drug';

	const switchKind = (next: Kind) => {
		setKind(next);
		setSelected(null);
		setFirst(null);
		setError(null);
		setAdded(null);
	};

	const lookup = async (name: string) => {
		setSelected(name);
		setFirst(null);
		setAdded(null);
		setBusy(true);
		setError(null);
		try {
			const res = await traversalStep('start', {name, is_drug: isDrug});
			if (res.statusCode !== QS_SUCCESS || !res.traversal) {
				setError(res.statusMessage || 'Lookup failed');
				return;
			}
			setFirst(res.traversal);
		} catch (err: any) {
			setError(err?.message || 'Lookup failed');
		} finally {
			setBusy(false);
		}
	};

	const q = first?.question;
	const Icon = isDrug ? Pill : HeartPulse;

	return (
		<div className="mx-auto max-w-3xl space-y-5">
			<Panel bodyClassName="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold tracking-tight">Underwriting lookup</h2>
						<p className="text-sm text-muted-foreground">
							See how a {isDrug ? 'medication' : 'condition'} is underwritten before adding it.
						</p>
					</div>
					<Segmented
						value={kind}
						options={[
							{value: 'drug', label: 'Medication'},
							{value: 'condition', label: 'Condition'}
						]}
						onChange={switchKind}
					/>
				</div>
				<SearchBox
					key={kind}
					kind={kind}
					placeholder={isDrug ? 'Search medications, e.g. Lisinopril' : 'Search conditions, e.g. COPD'}
					onPick={lookup}
				/>
			</Panel>

			{error && <p className="text-sm text-destructive">{error}</p>}

			{busy ? (
				<div className="flex items-center justify-center gap-2 rounded-xl border bg-card py-12 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Looking up {selected}…
				</div>
			) : selected && first ? (
				<Panel
					title={
						<span className="flex items-center gap-2">
							<span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-primary">
								<Icon className="size-3.5" />
							</span>
							{selected}
						</span>
					}
					action={
						added ? (
							<span className="flex items-center gap-1 text-sm font-medium text-success">
								<Check className="size-4" /> Added to quote
							</span>
						) : (
							<Button
								size="sm"
								onClick={() => setTarget({name: selected, isDrug, resumeSessionId: first.session_id})}
							>
								<Plus className="size-4" /> Add to quote
							</Button>
						)
					}
				>
					{q ? (
						<div className="space-y-3">
							<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								{isDrug && q.type === 'indication' ? 'Commonly prescribed for' : q.text}
							</div>
							{q.options?.length ? (
								<div className="flex flex-wrap gap-2">
									{q.options.map((o) => (
										<span key={o} className="rounded-full border bg-muted/50 px-3 py-1 text-sm">
											{o}
										</span>
									))}
								</div>
							) : (
								<p className="text-sm">{q.text}</p>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">No underwriting questions for this item.</p>
					)}
				</Panel>
			) : (
				<EmptyState icon={<Search className="size-5" />} title={`Search a ${isDrug ? 'medication' : 'condition'}`}>
					Results show the first underwriting question carriers ask — add it to the quote to
					finish the questionnaire.
				</EmptyState>
			)}

			<TraversalDialog
				target={target}
				onClose={() => setTarget(null)}
				onSessionChange={() => {}}
				onComplete={(item) => {
					onAddItem(item);
					setAdded(item.name);
					setTarget(null);
				}}
			/>
		</div>
	);
}
