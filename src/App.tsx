import {useEffect, useRef, useState} from 'react';
import {
	Navigate,
	NavLink,
	Route,
	Routes,
	useLocation,
	useNavigate
} from 'react-router-dom';
import {Check, Copy, Phone} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {runHandoff, HandoffResult} from '@/auth/handoff';
import {getUser, hasSession} from '@/auth/session';
import {cn} from '@/lib/utils';
import {
	DialerSessionProvider,
	useDialerSession
} from '@/session/DialerSessionProvider';
import Dial from '@/pages/Dial';
import Leads from '@/pages/Leads';
import policyPrinterLogo from '@/assets/policy-printer-logo.png';

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
	const user = getUser();
	const userName =
		[user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Unknown user';

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
		<DialerSessionProvider>
			<div className="min-h-screen bg-background">
				<header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
					<div className="mx-auto flex min-h-24 max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-2 sm:px-6">
						<div className="flex min-w-0 flex-wrap items-center gap-5">
							<img
								src={policyPrinterLogo}
								alt="Policy Printer"
								className="h-20 w-auto shrink-0 object-contain"
							/>
							<nav className="flex items-center gap-1" aria-label="Primary">
								<NavTab to="/dial" label="Calls" />
								<NavTab to="/leads" label="Activity" />
							</nav>
						</div>
						<HeaderUserBlock userName={userName} />
					</div>
				</header>
				<main className="px-4 py-6 sm:px-6">
					<InboundCallAutoNav />
					<Routes>
						<Route path="/dial" element={<Dial />} />
						<Route path="/leads" element={<Leads />} />
						<Route path="*" element={<Navigate to="/dial" replace />} />
					</Routes>
				</main>
			</div>
		</DialerSessionProvider>
	);
}

function HeaderUserBlock({userName}: {userName: string}) {
	const {profile, provisioned} = useDialerSession();
	const callbackNumber = profile?.agent?.twilio_phone_number;

	return (
		<div className="flex shrink-0 flex-col items-end gap-2">
			<p className="hidden text-sm text-muted-foreground sm:block">
				Logged in as: {userName}
			</p>
			{provisioned && callbackNumber && (
				<CallbackNumber number={callbackNumber} />
			)}
		</div>
	);
}

/**
 * When a call STARTS while the agent is on another tab, swap them to the Dial page
 * where the active-call banner / wrap-up / lead form live. Fires only on the
 * null→non-null edge of the active call (tracked by CallSid ref, so one call ending
 * and another starting still triggers), and only for INBOUND — outbound paths (dialpad
 * on Dial, click-to-dial on Activity) navigate imperatively from their click handlers.
 * Renders nothing; must live inside both the provider and the Router.
 */
function InboundCallAutoNav() {
	const {device} = useDialerSession();
	const navigate = useNavigate();
	const location = useLocation();
	const prevSid = useRef<string | null>(null);

	useEffect(() => {
		const call = device.activeCall;
		if (
			call &&
			prevSid.current === null &&
			call.direction === 'inbound' &&
			location.pathname !== '/dial'
		) {
			navigate('/dial');
		}
		prevSid.current = call?.callSid ?? null;
	}, [device.activeCall, navigate, location.pathname]);

	return null;
}

/**
 * The agent's own direct callback number (their Twilio DID). A direct dial back to
 * this number bypasses Retreaver routing and triggers the returning-caller pull-up.
 */
function CallbackNumber({number}: {number: string}) {
	const [copied, setCopied] = useState(false);
	const onCopy = () => {
		void navigator.clipboard
			?.writeText(number)
			.then(() => {
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => undefined);
	};

	return (
		<button
			type="button"
			onClick={onCopy}
			title="Copy your phone number"
			className="group flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm transition-colors hover:bg-muted"
		>
			<Phone className="size-4 text-muted-foreground" />
			<span className="flex flex-col items-start leading-tight">
				<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
					Your phone number
				</span>
				<span className="font-mono font-medium">{formatDid(number)}</span>
			</span>
			{copied ? (
				<Check className="size-4 text-success" />
			) : (
				<Copy className="size-4 text-muted-foreground opacity-60 group-hover:opacity-100" />
			)}
		</button>
	);
}

/** Format a +1 E.164 US DID as +1 (555) 123-4567; leave anything else as-is. */
function formatDid(did: string): string {
	const digits = did.replace(/\D/g, '');
	const ten =
		digits.length === 11 && digits.startsWith('1')
			? digits.slice(1)
			: digits.length === 10
				? digits
				: null;
	if (!ten) return did;
	return `+1 (${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
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
