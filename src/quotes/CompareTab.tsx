/**
 * Quote Compare (ENG-286): one carrier plan at up to three face amounts or
 * premiums, side by side. Companies and their coverage labels come from ITK
 * for the client's state; the coverage label must be one of those exactly.
 */

import {useEffect, useState} from 'react';
import {Columns3, ExternalLink, Loader2} from 'lucide-react';
import {Button, buttonVariants} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {QS_SUCCESS, getCompareOptions, runCompare} from './api';
import {
	ClientFields,
	EmptyState,
	Field,
	NumberInput,
	Panel,
	Segmented,
	SimpleSelect,
	isQuotable,
	money,
	wholeMoney
} from './fields';
import {CarrierLogo, hasEapp} from './QuoteResults';
import {emptySessionState, type ItkCompareOptions, type QuoteSessionState} from './types';

const OPTION_LABELS = ['Option A', 'Option B', 'Option C'];

export function CompareTab({
	state,
	update
}: {
	state: QuoteSessionState;
	update: (fn: (s: QuoteSessionState) => QuoteSessionState) => void;
}) {
	const {client, compare} = state;
	const [options, setOptions] = useState<ItkCompareOptions>({});
	const [optionsBusy, setOptionsBusy] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!client.state) {
			setOptions({});
			return;
		}
		let cancelled = false;
		setOptionsBusy(true);
		getCompareOptions(client.state)
			.then((res) => {
				if (!cancelled) setOptions(res.statusCode === QS_SUCCESS ? (res.options ?? {}) : {});
			})
			.finally(() => !cancelled && setOptionsBusy(false));
		return () => {
			cancelled = true;
		};
	}, [client.state]);

	const companies = Object.keys(options).sort();
	const coverageLabels = compare.company ? (options[compare.company] ?? []) : [];
	const setCompare = (patch: Partial<QuoteSessionState['compare']>) =>
		update((s) => ({...s, compare: {...s.compare, ...patch}}));
	const canCompare =
		isQuotable(client) &&
		!!compare.company &&
		!!compare.coverageType &&
		compare.values.some((v) => v.value);

	const go = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await runCompare(state);
			if (res.statusCode !== QS_SUCCESS) {
				setError(res.statusMessage || 'Compare failed');
				return;
			}
			update((s) => ({...s, lastCompare: {at: new Date().toISOString(), data: res.data ?? []}}));
		} catch (err: any) {
			setError(err?.message || 'Compare failed');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="grid items-start gap-4 lg:grid-cols-5">
			<aside className="space-y-3 lg:sticky lg:top-20 lg:col-span-2">
				<Panel title="Plan">
					<div className="space-y-3">
						<Field label="Carrier">
							<SimpleSelect
								value={compare.company}
								disabled={!client.state}
								onChange={(company) =>
									setCompare({company, coverageType: (options[company] ?? [])[0] ?? null})
								}
								options={
									compare.company && !companies.includes(compare.company)
										? [compare.company, ...companies]
										: companies
								}
								placeholder={
									!client.state ? 'Choose a state first' : optionsBusy ? 'Loading…' : 'Select carrier'
								}
							/>
						</Field>
						<Field label="Coverage type">
							<SimpleSelect
								value={compare.coverageType}
								disabled={!compare.company}
								onChange={(coverageType) => setCompare({coverageType})}
								options={
									compare.coverageType && !coverageLabels.includes(compare.coverageType)
										? [compare.coverageType, ...coverageLabels]
										: coverageLabels
								}
								placeholder="Select coverage"
							/>
						</Field>
					</div>
				</Panel>

				<Panel
					title="Amounts"
					action={
						<button
							type="button"
							className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
							onClick={() =>
								update((s) => ({...s, compare: emptySessionState().compare, lastCompare: null}))
							}
						>
							Reset
						</button>
					}
				>
					<div className="space-y-2">
						{compare.values.map((v, i) => (
							<div key={i} className="grid grid-cols-[4.5rem_auto_1fr] items-center gap-2">
								<span className="text-xs font-medium text-muted-foreground">{OPTION_LABELS[i]}</span>
								<Segmented
									size="sm"
									value={v.type}
									options={[
										{value: 'FACE_AMOUNT', label: 'Face'},
										{value: 'PREMIUM', label: 'Premium'}
									]}
									onChange={(type) =>
										setCompare({values: compare.values.map((x, j) => (j === i ? {...x, type} : x))})
									}
								/>
								<NumberInput
									prefix="$"
									value={v.value}
									placeholder={v.type === 'PREMIUM' ? '50' : '10,000'}
									onChange={(value) =>
										setCompare({values: compare.values.map((x, j) => (j === i ? {...x, value} : x))})
									}
								/>
							</div>
						))}
					</div>
				</Panel>

				<Panel title="Client">
					<ClientFields
						client={client}
						showBuild={false}
						onChange={(patch) => update((s) => ({...s, client: {...s.client, ...patch}}))}
					/>
				</Panel>

				<div className="space-y-2">
					<Button className="w-full" onClick={go} disabled={busy || !canCompare}>
						{busy ? <Loader2 className="size-4 animate-spin" /> : <Columns3 className="size-4" />}
						Compare options
					</Button>
					{error && <p className="text-center text-sm text-destructive">{error}</p>}
				</div>
			</aside>

			<section className="min-w-0 space-y-3 lg:col-span-3">
				<div>
					<h2 className="text-lg font-semibold tracking-tight">Side-by-side</h2>
					<p className="text-sm text-muted-foreground">
						{compare.company
							? `${compare.company}${compare.coverageType ? ` · ${compare.coverageType}` : ''}`
							: 'One plan at up to three amounts.'}
					</p>
				</div>
				{state.lastCompare && state.lastCompare.data.length > 0 ? (
					<div className={cn('grid gap-4 md:grid-cols-3', busy && 'opacity-50')}>
						{state.lastCompare.data.map((q, i) => (
							<div
								key={i}
								className="flex flex-col rounded-xl border bg-card p-5 shadow-xs"
							>
								<div className="flex items-center justify-between">
									<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
										{OPTION_LABELS[i] ?? `Option ${i + 1}`}
									</span>
									<CarrierLogo src={q.logo} name={q.company} className="h-9 w-24" />
								</div>
								<div className="mt-5">
									<div className="text-3xl font-semibold tracking-tight tabular-nums">
										{money(q.monthly)}
									</div>
									<div className="text-xs text-muted-foreground">per month</div>
								</div>
								<dl className="mt-5 space-y-2.5 border-t pt-4 text-sm">
									<div className="flex justify-between">
										<dt className="text-muted-foreground">Face amount</dt>
										<dd className="font-medium tabular-nums">{wholeMoney(q.face_amount)}</dd>
									</div>
									<div className="flex justify-between">
										<dt className="text-muted-foreground">Yearly</dt>
										<dd className="font-medium tabular-nums">{money(q.yearly)}</dd>
									</div>
									<div className="flex justify-between">
										<dt className="text-muted-foreground">With accidental death</dt>
										<dd className="font-medium tabular-nums">{q.addnd ? money(q.addnd) : '—'}</dd>
									</div>
								</dl>
								{q.warning && (
									<p className="mt-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
										{q.warning}
									</p>
								)}
								{hasEapp(q) && (
									<a
										href={q.eapp_link}
										target="_blank"
										rel="noopener noreferrer"
										className={buttonVariants({variant: 'outline', className: 'mt-4 w-full'})}
									>
										Start E-App <ExternalLink className="size-3.5" />
									</a>
								)}
							</div>
						))}
					</div>
				) : (
					<EmptyState icon={<Columns3 className="size-5" />} title="Nothing to compare yet">
						{state.lastCompare
							? 'No results for these inputs.'
							: 'Pick a carrier and coverage type, set up to three amounts, then compare. Tip: use Compare on any Quoter result.'}
					</EmptyState>
				)}
			</section>
		</div>
	);
}
