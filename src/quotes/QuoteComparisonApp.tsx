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
	Calculator,
	CheckCircle2,
	CloudOff,
	Check,
	Loader2,
	Phone,
	TriangleAlert
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {runHandoff} from '@/auth/handoff';
import {getDialerBranding, isPlainBranding} from '@/branding';
import {cn} from '@/lib/utils';
import {takeFormPrefill, type FormQuotePrefill} from './formPrefill';
import {CompareTab} from './CompareTab';
import {QuoterTab} from './QuoterTab';
import {useQuoteSession, type QuoteSessionApi, type QuoteTarget} from './useQuoteSession';

/**
 * Two STEPS, not views: 1) Carriers — quote every carrier for the client;
 * 2) Plans — one carrier's plan at three coverage amounts. Step 2 unlocks once
 * a carrier is picked (See plans on a step-1 result). `value` is the persisted
 * `activeTab` key, kept as 'quoter'/'compare' so saved quotes still open.
 */
const STEPS = [
	{value: 'quoter', label: 'Carriers', hint: 'Quote every carrier'},
	{value: 'compare', label: 'Plans', hint: 'Compare coverage amounts'}
] as const;
type TabValue = (typeof STEPS)[number]['value'];

/** Coverage amounts step 2 opens with when a carrier is picked. */
const PLAN_AMOUNTS = [5_000, 10_000, 15_000];

/** Unknown / retired tabs ('presentation', 'lookup', 'drug', …) open step 1. */
const normalizeTab = (raw: string): TabValue =>
	STEPS.some((t) => t.value === raw) ? (raw as TabValue) : 'quoter';

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

/** Per-tab memory of the caller number, so a refresh (which has no handoff
 *  key any more) reopens the same quote. sessionStorage = this tab only. */
const TAB_PHONE_KEY = 'pp_quote_phone';

const readTarget = (form: FormQuotePrefill | null): QuoteTarget => {
	const leadId = readLeadId();
	let phone = form?.phone ?? null;
	try {
		if (phone) sessionStorage.setItem(TAB_PHONE_KEY, phone);
		else if (!leadId) phone = sessionStorage.getItem(TAB_PHONE_KEY);
	} catch {
		/* storage blocked: the quote still opens, a refresh just won't resume it */
	}
	return {leadId, phone};
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
	const formPrefill = readFormPrefill();
	return <QuotePage target={readTarget(formPrefill)} formPrefill={formPrefill} />;
}

function SaveIndicator({session}: {session: QuoteSessionApi}) {
	const base = 'flex items-center gap-1.5 text-xs';
	if (!session.persisted) {
		return (
			<span className={cn(base, 'text-muted-foreground')}>
				<CloudOff className="size-3.5" /> Not saved — no phone number
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

/** +16035550142 → (603) 555-0142; anything else as typed. */
const formatPhone = (raw: string): string => {
	const d = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
	return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};

const initials = (name: string | null) =>
	(name || '')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]!.toUpperCase())
		.join('') || '?';

function QuotePage({
	target,
	formPrefill
}: {
	target: QuoteTarget;
	formPrefill: FormQuotePrefill | null;
}) {
	const session = useQuoteSession(target, formPrefill);
	const {state, update, prefill} = session;
	const branding = getDialerBranding();
	const clientName = [prefill?.firstName, prefill?.lastName].filter(Boolean).join(' ') || null;
	const tab = normalizeTab(state.activeTab);
	/** Set by step 1's Compare: step 2 runs the comparison once on arrival. */
	const [autoRunPlans, setAutoRunPlans] = useState(false);

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
		// Desktop: the page is exactly the window height and each workspace column
		// scrolls on its own. Narrow screens fall back to one normal page scroll.
		<div className="flex min-h-screen flex-col bg-background lg:h-screen lg:overflow-hidden">
			<header className="sticky top-0 z-40 shrink-0 border-b bg-card/90 backdrop-blur">
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
					</div>
				</div>
			</header>

			<main className="mx-auto flex w-full min-h-0 max-w-[1440px] flex-1 flex-col gap-4 px-6 pt-5">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div className="flex items-center gap-3">
						<div className="flex size-11 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
							{clientName ? initials(clientName) : <Calculator className="size-5" />}
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								{clientName ?? (session.persisted ? 'Unnamed caller' : 'New quote')}
							</h1>
							<div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
								{(session.phone ?? prefill?.phone) && (
									<span className="flex items-center gap-1">
										<Phone className="size-3.5" />
										{formatPhone(session.phone ?? prefill?.phone ?? '')}
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

					<nav className="flex items-center gap-3" aria-label="Quote steps">
						{STEPS.map((step, i) => {
							const active = tab === step.value;
							const done = step.value === 'quoter' && tab === 'compare';
							const locked = step.value === 'compare' && !state.compare.company;
							return (
								<div key={step.value} className="flex items-center gap-3">
									{i > 0 && (
										<span
											className={cn(
												'h-px w-10 transition-colors',
												done || active ? 'bg-primary' : 'bg-border'
											)}
										/>
									)}
									<button
										type="button"
										disabled={locked}
										onClick={() => setTab(step.value)}
										title={locked ? 'Pick a carrier in step 1 (See plans)' : undefined}
										className={cn(
											'group flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors disabled:cursor-not-allowed',
											!active && !locked && 'hover:bg-muted'
										)}
									>
										<span
											className={cn(
												'flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
												active
													? 'border-primary bg-primary text-primary-foreground'
													: done
														? 'border-primary bg-secondary text-primary'
														: 'border-border bg-card text-muted-foreground'
											)}
										>
											{done ? <Check className="size-4" /> : i + 1}
										</span>
										<span className="leading-tight">
											<span
												className={cn(
													'block text-sm font-semibold',
													active ? 'text-foreground' : 'text-muted-foreground'
												)}
											>
												{step.label}
											</span>
											<span className="block text-xs text-muted-foreground">{step.hint}</span>
										</span>
									</button>
								</div>
							);
						})}
					</nav>
				</div>

				{session.resumedFrom && (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-secondary px-4 py-3">
						<p className="text-sm">
							<span className="font-medium">This number already has a quote</span>
							<span className="text-muted-foreground">
								{' '}
								· last updated{' '}
								{new Date(session.resumedFrom).toLocaleString([], {
									dateStyle: 'medium',
									timeStyle: 'short'
								})}
							</span>
						</p>
						<div className="flex gap-2">
							<Button size="sm" variant="ghost" onClick={session.dismissResumed}>
								Keep it
							</Button>
							<Button size="sm" onClick={session.startNewQuote}>
								Start new quote
							</Button>
						</div>
					</div>
				)}

				<div className="min-h-0 flex-1">
				{tab === 'quoter' && (
					<QuoterTab
						state={state}
						update={update}
						onCompare={(q) => {
							update((s) => ({
								...s,
								activeTab: 'compare',
								compare: {
									company: q.company,
									coverageType: q.tier_name,
									values: PLAN_AMOUNTS.map((value) => ({type: 'FACE_AMOUNT' as const, value}))
								}
							}));
							// Step 2 runs the comparison as soon as it mounts.
							setAutoRunPlans(true);
						}}
					/>
				)}
				{tab === 'compare' && (
					<CompareTab
						state={state}
						update={update}
						autoRun={autoRunPlans}
						onAutoRunDone={() => setAutoRunPlans(false)}
					/>
				)}
				</div>
			</main>

		</div>
	);
}
