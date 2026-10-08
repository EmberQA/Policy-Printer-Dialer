/**
 * /quotecomparison?lead_id=<uuid> — the final-expense quote comparison page
 * (ENG-286), opened in its own browser tab from the dialer.
 *
 * Rendered straight from main.tsx, NOT inside <App/>: no tab lock, no
 * DialerSessionProvider, no device registration — just the stored dialer JWTs
 * (shared localStorage, same origin) and the quote API. The EmberQA palette is
 * applied to <html> so portalled popovers/dialogs pick it up too.
 */

import {useEffect, useState} from 'react';
import {
	Building2,
	Calculator,
	CheckCircle2,
	CloudOff,
	Columns3,
	Loader2,
	Phone,
	Presentation,
	Search,
	TriangleAlert
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {runHandoff} from '@/auth/handoff';
import {getDialerBranding, isPlainBranding} from '@/branding';
import {cn} from '@/lib/utils';
import {CarriersDialog} from './CarriersDialog';
import {takeFormPrefill, type FormQuotePrefill} from './formPrefill';
import {CompareTab} from './CompareTab';
import {LookupTab} from './LookupTab';
import {PresentationTab} from './PresentationTab';
import {QuoterTab} from './QuoterTab';
import {useQuoteSession, type QuoteSessionApi} from './useQuoteSession';

const TABS = [
	{value: 'quoter', label: 'Quoter', icon: Calculator},
	{value: 'compare', label: 'Compare', icon: Columns3},
	{value: 'lookup', label: 'Lookup', icon: Search},
	{value: 'presentation', label: 'Presentation', icon: Presentation}
] as const;
type TabValue = (typeof TABS)[number]['value'];

/** Sessions saved before the tab consolidation used 'drug' / 'condition' / 'carriers'. */
const normalizeTab = (raw: string): TabValue =>
	raw === 'drug' || raw === 'condition'
		? 'lookup'
		: TABS.some((t) => t.value === raw)
			? (raw as TabValue)
			: 'quoter';

const readLeadId = (): string | null => {
	const id = new URLSearchParams(window.location.search).get('lead_id');
	return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
};

/**
 * The lead form's one-time handoff ("Get a quote"). Read ONCE per page load at
 * module level — StrictMode double-runs initializers and the handoff is
 * deleted on read — then the key is stripped from the URL.
 */
let formPrefillCache: {value: FormQuotePrefill | null} | null = null;
const readFormPrefill = (): FormQuotePrefill | null => {
	if (!formPrefillCache) {
		const url = new URL(window.location.href);
		formPrefillCache = {value: takeFormPrefill(url.searchParams.get('prefill'))};
		if (url.searchParams.has('prefill')) {
			url.searchParams.delete('prefill');
			window.history.replaceState({}, '', url.toString());
		}
	}
	return formPrefillCache.value;
};

function CenteredMessage({title, children}: {title: string; children?: React.ReactNode}) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
			<div className="max-w-sm space-y-2 rounded-xl border bg-card px-8 py-10 shadow-xs">
				<h1 className="text-base font-semibold">{title}</h1>
				{children && <p className="text-sm text-muted-foreground">{children}</p>}
			</div>
		</div>
	);
}

export default function QuoteComparisonApp() {
	const [auth, setAuth] = useState<'checking' | 'ok' | 'none'>('checking');

	useEffect(() => {
		document.documentElement.classList.add('emberqa-quote');
		document.title = 'Quotes';
		runHandoff().then((r) =>
			setAuth(r.status === 'authenticated' || r.status === 'exchanged' ? 'ok' : 'none')
		);
	}, []);

	if (auth === 'checking') {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
				<Loader2 className="size-5 animate-spin" />
			</div>
		);
	}
	if (auth === 'none') {
		return (
			<CenteredMessage title="Open quotes from the dialer">
				Sign in to the dialer first, then use the Quotes tab or a lead's Quote button.
			</CenteredMessage>
		);
	}
	return <QuotePage leadId={readLeadId()} formPrefill={readFormPrefill()} />;
}

function SaveIndicator({session}: {session: QuoteSessionApi}) {
	const base = 'flex items-center gap-1.5 text-xs';
	if (!session.persisted) {
		return (
			<span className={cn(base, 'text-muted-foreground')}>
				<CloudOff className="size-3.5" /> Not saved — save the lead to keep progress
			</span>
		);
	}
	const {saveStatus, saveMessage} = session;
	if (saveStatus === 'saving') {
		return (
			<span className={cn(base, 'text-muted-foreground')}>
				<Loader2 className="size-3.5 animate-spin" /> Saving
			</span>
		);
	}
	if (saveStatus === 'error' || saveStatus === 'conflict') {
		return (
			<span className={cn(base, 'text-amber-700')} title={saveMessage ?? undefined}>
				<TriangleAlert className="size-3.5" />
				{saveStatus === 'conflict' ? 'Reloaded latest' : 'Not saved'}
			</span>
		);
	}
	return (
		<span className={cn(base, 'text-muted-foreground')}>
			<CheckCircle2 className="size-3.5 text-success" /> {saveStatus === 'saved' ? 'Saved' : 'Up to date'}
		</span>
	);
}

const initials = (name: string | null) =>
	(name || '')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]!.toUpperCase())
		.join('') || '?';

function QuotePage({
	leadId,
	formPrefill
}: {
	leadId: string | null;
	formPrefill: FormQuotePrefill | null;
}) {
	const session = useQuoteSession(leadId, formPrefill);
	const {state, update, prefill} = session;
	const [carriersOpen, setCarriersOpen] = useState(false);
	const branding = getDialerBranding();
	const clientName = [prefill?.firstName, prefill?.lastName].filter(Boolean).join(' ') || null;
	const tab = normalizeTab(state.activeTab);

	if (session.loading) {
		return (
			<div className="flex min-h-screen items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading lead…
			</div>
		);
	}
	if (session.loadError) {
		return <CenteredMessage title="Couldn't open this quote">{session.loadError}</CenteredMessage>;
	}

	const setTab = (activeTab: TabValue) => update((s) => ({...s, activeTab}));
	const meta = [
		session.leadSource === 'outbound' ? 'Purchased lead' : session.leadSource === 'dialer' ? 'Inbound lead' : null,
		state.underwritingItems.length
			? `${state.underwritingItems.length} health item${state.underwritingItems.length === 1 ? '' : 's'}`
			: null,
		session.carriers?.length ? `${session.carriers.length} carriers` : null
	].filter(Boolean);

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-6">
					<div className="flex items-center gap-3">
						{!isPlainBranding() && (
							<img src={branding.logoUrl} alt={branding.appName} className="h-9 w-auto" />
						)}
						<span className="h-6 w-px bg-border" />
						<span className="text-sm font-semibold">Quotes</span>
						<span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
							Final expense
						</span>
					</div>
					<div className="flex items-center gap-4">
						<SaveIndicator session={session} />
						<Button variant="outline" size="sm" onClick={() => setCarriersOpen(true)}>
							<Building2 className="size-4" />
							My carriers
						</Button>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-[1440px] space-y-4 px-6 py-5">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div className="flex items-center gap-3">
						<div className="flex size-11 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
							{clientName ? initials(clientName) : <Calculator className="size-5" />}
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								{clientName ?? (leadId ? 'Unnamed lead' : 'New quote')}
							</h1>
							<div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
								{prefill?.phone && (
									<span className="flex items-center gap-1">
										<Phone className="size-3.5" />
										{prefill.phone}
									</span>
								)}
								{meta.map((m) => (
									<span key={m} className="before:mr-2 before:content-['·'] first:before:hidden">
										{m}
									</span>
								))}

							</div>
						</div>
					</div>

					<nav className="inline-flex rounded-xl border bg-card p-1 shadow-xs" aria-label="Quote tools">
						{TABS.map((t) => {
							const Icon = t.icon;
							const active = tab === t.value;
							return (
								<button
									key={t.value}
									type="button"
									onClick={() => setTab(t.value)}
									className={cn(
										'flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
										active
											? 'bg-primary text-primary-foreground shadow-sm'
											: 'text-muted-foreground hover:bg-muted hover:text-foreground'
									)}
								>
									<Icon className="size-4" />
									{t.label}
									{t.value === 'presentation' && state.presentation.length > 0 && (
										<span
											className={cn(
												'rounded-full px-1.5 text-[11px] tabular-nums',
												active ? 'bg-white/20' : 'bg-secondary text-primary'
											)}
										>
											{state.presentation.length}
										</span>
									)}
								</button>
							);
						})}
					</nav>
				</div>

				{tab === 'quoter' && (
					<QuoterTab
						state={state}
						update={update}
						onCompare={(q) =>
							update((s) => ({
								...s,
								activeTab: 'compare',
								compare: {...s.compare, company: q.company, coverageType: q.tier_name}
							}))
						}
					/>
				)}
				{tab === 'compare' && <CompareTab state={state} update={update} />}
				{tab === 'lookup' && (
					<LookupTab
						onAddItem={(item) =>
							update((s) => ({...s, underwritingItems: [...s.underwritingItems, item]}))
						}
					/>
				)}
				{tab === 'presentation' && (
					<PresentationTab state={state} update={update} clientName={clientName} />
				)}
			</main>

			<CarriersDialog open={carriersOpen} onOpenChange={setCarriersOpen} onSaved={session.setCarriers} />
		</div>
	);
}
