/**
 * Quoter (ENG-286): coverage + client on the left, drug & health on the right,
 * "Get Quote" runs the all-carrier quote (an ITK-metered call — only ever on
 * this click). The last results are kept in the session so a reopened lead
 * shows them without re-quoting.
 */

import {useState} from 'react';
import {FileSearch, Loader2, Sparkles} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {QS_SUCCESS, runQuote} from './api';
import {
	ClientFields,
	CoverageAmountField,
	EmptyState,
	Field,
	NumberInput,
	Panel,
	Segmented,
	SimpleSelect,
	isQuotable
} from './fields';
import {QuoteResults} from './QuoteResults';
import {UnderwritingPanel} from './UnderwritingPanel';
import {
	DEFAULT_COVERAGE_AMOUNT,
	ITK_COVERAGE_TYPES,
	type ItkQuoteResult,
	type QuoteSessionState
} from './types';

export function QuoterTab({
	state,
	update,
	onCompare
}: {
	state: QuoteSessionState;
	update: (fn: (s: QuoteSessionState) => QuoteSessionState) => void;
	onCompare: (q: ItkQuoteResult) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
	const {client, coverage} = state;

	const getQuote = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await runQuote(state);
			if (res.statusCode !== QS_SUCCESS) {
				setError(res.statusMessage || 'Quote failed');
				return;
			}
			update((s) => ({
				...s,
				lastQuote: {
					at: new Date().toISOString(),
					quotes: res.quotes ?? [],
					excluded: res.excluded ?? []
				}
			}));
		} catch (err: any) {
			setError(err?.message || 'Quote failed');
		} finally {
			setBusy(false);
		}
	};

	const quotable = isQuotable(client);

	return (
		<div className="grid items-start gap-4 lg:h-full lg:grid-cols-5">
			<aside className="space-y-3 lg:col-span-2 lg:h-full lg:overflow-y-auto lg:pb-6 lg:pr-1 [scrollbar-gutter:stable]">
				<Panel title="Coverage">
					<div className="grid grid-cols-2 gap-x-3 gap-y-3">
						<Field label="Quote by" className="col-span-2">
							<Segmented
								className="w-full"
								value={coverage.mode}
								options={[
									{value: 'face', label: 'Coverage amount'},
									{value: 'premium', label: 'Monthly premium'}
								]}
								// The amount means something different in each mode: switching
								// resets it (coverage → the $10,000 preset, premium → blank).
								onChange={(mode) =>
									update((s) =>
										mode === s.coverage.mode
											? s
											: {
													...s,
													coverage: {
														...s.coverage,
														mode,
														amount: mode === 'face' ? DEFAULT_COVERAGE_AMOUNT : null
													}
												}
									)
								}
							/>
						</Field>
						<Field label={coverage.mode === 'face' ? 'Coverage amount' : 'Monthly premium'}>
							{coverage.mode === 'face' ? (
								<CoverageAmountField
									value={coverage.amount}
									onChange={(amount) => update((s) => ({...s, coverage: {...s.coverage, amount}}))}
								/>
							) : (
								<NumberInput
									prefix="$"
									placeholder="50"
									value={coverage.amount}
									onChange={(amount) => update((s) => ({...s, coverage: {...s.coverage, amount}}))}
								/>
							)}
						</Field>
						<Field label="Coverage type">
							<SimpleSelect
								value={coverage.coverageType}
								onChange={(coverageType) =>
									update((s) => ({...s, coverage: {...s.coverage, coverageType}}))
								}
								options={ITK_COVERAGE_TYPES}
							/>
						</Field>
					</div>
				</Panel>

				<Panel title="Client">
					<ClientFields
						client={client}
						onChange={(patch) => update((s) => ({...s, client: {...s.client, ...patch}}))}
					/>
				</Panel>

				<Panel
					title="Health & medications"
					description="Each item runs a short underwriting questionnaire."
				>
					<UnderwritingPanel
						items={state.underwritingItems}
						pending={state.pendingTraversal}
						onItemsChange={(underwritingItems) => update((s) => ({...s, underwritingItems}))}
						onPendingChange={(pendingTraversal) => update((s) => ({...s, pendingTraversal}))}
					/>
				</Panel>

				<div className="space-y-2">
					<Button className="w-full" onClick={getQuote} disabled={busy || !quotable}>
						{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
						{state.lastQuote ? 'Re-run quotes' : 'Get quotes'}
					</Button>
					{!quotable && (
						<p className="text-center text-xs text-muted-foreground">
							Sex, state, and date of birth or age are required.
						</p>
					)}
					{error && <p className="text-center text-sm text-destructive">{error}</p>}
				</div>
			</aside>

			<section className="min-w-0 space-y-3 pb-6 lg:col-span-3 lg:h-full lg:overflow-y-auto lg:pr-1 [scrollbar-gutter:stable]">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold tracking-tight">Carriers</h2>
						<p className="text-sm text-muted-foreground">
							{state.lastQuote
								? `${state.lastQuote.quotes.length} plans · updated ${new Date(state.lastQuote.at).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'})}`
								: 'Results appear here, cheapest first.'}
						</p>
					</div>
					{state.lastQuote && (
						<Segmented
							size="sm"
							value={period}
							options={[
								{value: 'monthly', label: 'Monthly'},
								{value: 'yearly', label: 'Yearly'}
							]}
							onChange={setPeriod}
						/>
					)}
				</div>
				{busy && !state.lastQuote ? (
					<div className="space-y-2">
						{[0, 1, 2, 3].map((i) => (
							<div key={i} className="h-20 animate-pulse rounded-xl border bg-card" />
						))}
					</div>
				) : state.lastQuote ? (
					<div className={cn('transition-opacity', busy && 'opacity-50')}>
						<QuoteResults
							quotes={state.lastQuote.quotes}
							excluded={state.lastQuote.excluded}
							period={period}
							onCompare={onCompare}
						/>
					</div>
				) : (
					<EmptyState icon={<FileSearch className="size-5" />} title="No quotes yet">
						Fill in the client profile and add any health conditions or medications, then
						run quotes across every carrier.
					</EmptyState>
				)}
			</section>
		</div>
	);
}
