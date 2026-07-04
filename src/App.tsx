import {useEffect, useState} from 'react';
import {Navigate, NavLink, Route, Routes} from 'react-router-dom';
import {Badge} from '@/components/ui/badge';
import {runHandoff, HandoffResult} from '@/auth/handoff';
import {hasSession} from '@/auth/session';
import {cn} from '@/lib/utils';
import Dial from '@/pages/Dial';
import Leads from '@/pages/Leads';

type BootState =
	| {phase: 'booting'}
	| {phase: 'ready'}
	| {phase: 'unauthenticated'; message?: string};

const THEME_KEY = 'pp_dialer_theme';

/**
 * App boot: run the one-time handoff (or fall back to a stored session), then
 * either render the authenticated shell or the "relaunch from the main app"
 * screen. There is NO login form here by design — entry is always via the main
 * EmberQA app's "Open Dialer" button.
 */
export default function App() {
	const [boot, setBoot] = useState<BootState>({phase: 'booting'});

	useEffect(() => {
		let cancelled = false;
		runHandoff().then((result: HandoffResult) => {
			if (cancelled) return;
			if (result.status === 'authenticated' || result.status === 'exchanged') {
				setBoot({phase: 'ready'});
			} else if (result.status === 'failed') {
				setBoot({phase: 'unauthenticated', message: result.message});
			} else {
				setBoot({
					phase: hasSession() ? 'ready' : 'unauthenticated'
				});
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		document.documentElement.classList.remove('dark');
		localStorage.setItem(THEME_KEY, 'light');
	}, []);

	if (boot.phase === 'booting') {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-muted-foreground">
				<div className="rounded-lg border bg-card px-4 py-3 text-sm shadow-xs">
					Signing you in…
				</div>
			</div>
		);
	}

	if (boot.phase === 'unauthenticated') {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6">
				<div className="relative w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-xs">
					<Badge variant="secondary" className="mb-4">
						Dialer access
					</Badge>
					<h1 className="text-xl font-semibold tracking-tight">
						Open the dialer from Policy Printer
					</h1>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						Launch this page with the Open Dialer button in the main Policy
						Printer app so we can sign you in automatically.
					</p>
					{boot.message && (
						<p className="mt-3 text-xs text-destructive">{boot.message}</p>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
				<div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
					<div className="flex min-w-0 items-center gap-5">
						<span className="truncate font-semibold tracking-tight">
							Policy Printer Dialer
						</span>
						<nav className="flex items-center gap-1" aria-label="Primary">
							<NavTab to="/dial" label="Calls" />
							<NavTab to="/leads" label="Activity" />
						</nav>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Badge variant="outline" className="hidden sm:inline-flex">
							Signed in
						</Badge>
					</div>
				</div>
			</header>
			<main className="px-4 py-6 sm:px-6">
				<Routes>
					<Route path="/dial" element={<Dial />} />
					<Route path="/leads" element={<Leads />} />
					<Route path="*" element={<Navigate to="/dial" replace />} />
				</Routes>
			</main>
		</div>
	);
}

function NavTab({to, label}: {to: string; label: string}) {
	return (
		<NavLink
			to={to}
			className={({isActive}) =>
				cn(
					'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
					isActive
						? 'bg-secondary text-foreground'
						: 'text-muted-foreground hover:text-foreground'
				)
			}
		>
			{label}
		</NavLink>
	);
}
