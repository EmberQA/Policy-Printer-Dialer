import {useEffect, useState} from 'react';
import {Navigate, NavLink, Route, Routes} from 'react-router-dom';
import {runHandoff, HandoffResult} from '@/auth/handoff';
import {hasSession} from '@/auth/session';
import {cn} from '@/lib/utils';
import Dial from '@/pages/Dial';
import Leads from '@/pages/Leads';

type BootState =
	| {phase: 'booting'}
	| {phase: 'ready'}
	| {phase: 'unauthenticated'; message?: string};

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

	if (boot.phase === 'booting') {
		return (
			<div className="flex min-h-screen items-center justify-center text-muted-foreground">
				Signing you in…
			</div>
		);
	}

	if (boot.phase === 'unauthenticated') {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
				<h1 className="text-xl font-semibold">Open the dialer from Policy Printer</h1>
				<p className="max-w-md text-sm text-muted-foreground">
					Launch the dialer using the <span className="text-foreground">Open Dialer</span>{' '}
					button in the main Policy Printer app so we can sign you in automatically.
				</p>
				{boot.message && (
					<p className="text-xs text-destructive">{boot.message}</p>
				)}
			</div>
		);
	}

	return (
		<div className="min-h-screen">
			<header className="flex items-center gap-1 border-b border-border px-4 py-3">
				<span className="mr-4 font-semibold tracking-tight text-primary">
					Policy Printer Dialer
				</span>
				<NavTab to="/dial" label="Dial" />
				<NavTab to="/leads" label="Activity" />
			</header>
			<main className="p-4">
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
					'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
					isActive
						? 'bg-secondary text-secondary-foreground'
						: 'text-muted-foreground hover:text-foreground'
				)
			}
		>
			{label}
		</NavLink>
	);
}
