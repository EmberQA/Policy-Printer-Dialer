import {useEffect, useRef, useState} from 'react';
import {
	Navigate,
	NavLink,
	Route,
	Routes,
	matchPath,
	useLocation,
	useNavigate
} from 'react-router-dom';
import {Check, Copy, HelpCircle, Phone} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {runHandoff, HandoffResult} from '@/auth/handoff';
import {getUser, hasSession} from '@/auth/session';
import {cn} from '@/lib/utils';
import {
	DialerSessionProvider,
	useDialerSession
} from '@/session/DialerSessionProvider';
import {useTabLock} from '@/session/useTabLock';
import Dial from '@/pages/Dial';
import Crm from '@/pages/Crm';
import Leads from '@/pages/Leads';
import {LeadNotesProvider} from '@/leads/LeadNotesContext';
import policyPrinterLogo from '@/assets/policy-printer-logo.png';
import {AudioSetupDialog} from '@/twilio/AudioSetupDialog';
import {TrainingVideoDialog} from '@/onboarding/TrainingVideoDialog';
import {CreditNotificationDialog} from '@/components/CreditNotificationDialog';
import {
	CreditFlightAnimation,
	type CreditFlight
} from '@/components/CreditFlightAnimation';
import {acknowledgeCreditNotification} from '@/lib/api';

type BootState =
	| {phase: 'booting'}
	| {phase: 'ready'}
	| {phase: 'unauthenticated'; message?: string};

const THEME_KEY = 'pp_dialer_theme';
const TRAINING_HIDDEN_KEY_PREFIX = 'pp_dialer_training_video_hidden:';
const TRAINING_VIDEO_SRC =
	'https://www.loom.com/embed/9b8f5ea326e84e838e37feccbba71630';

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
		[user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
		'Unknown user';
	// Only one dialer tab per browser profile may run. A duplicate tab is held here,
	// BEFORE <DialerSessionProvider>, so it never registers a Twilio Device and can
	// never be handed the inbound invite the agent is waiting on in the other tab.
	const tabLock = useTabLock(user?.user_id ?? 'unknown-user');

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

	// Hold the shell until ownership is known. An uncontended lock is granted almost
	// immediately, so this is normally a single frame — but mounting the provider
	// first and unmounting it on 'blocked' would briefly register a second Device,
	// which is exactly what this guard exists to prevent.
	if (tabLock === 'acquiring') {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-muted-foreground">
				<div className="rounded-lg border bg-card px-4 py-3 text-sm shadow-xs">
					Starting the dialer…
				</div>
			</div>
		);
	}

	if (tabLock === 'blocked') {
		return <DuplicateTabScreen />;
	}

	return (
		<DialerSessionProvider>
			<LeadNotesProvider>
				<AuthenticatedDialerApp
					key={user?.user_id ?? 'unknown-user'}
					userId={user?.user_id ?? 'unknown-user'}
					userName={userName}
				/>
			</LeadNotesProvider>
		</DialerSessionProvider>
	);
}

/**
 * Shown in a second dialer tab. It stays queued on the tab lock, so closing the
 * other tab promotes this one automatically — no refresh, no button required.
 *
 * "Close this tab" works when the dialer was opened by the main app's Open Dialer
 * button (window.close() is only permitted for script-opened tabs); when the
 * browser refuses, the instructions above it still apply.
 */
function DuplicateTabScreen() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-6">
			<div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-xs">
				<Badge variant="secondary" className="mb-4">
					Dialer already open
				</Badge>
				<h1 className="text-xl font-semibold tracking-tight">
					The dialer is already open in another tab
				</h1>
				<p className="mt-2 text-sm leading-6 text-muted-foreground">
					Calls can only ring in one tab at a time, so this one is paused.
					Switch back to your original dialer tab to keep taking calls.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-5"
					onClick={() => window.close()}
				>
					Close this tab
				</Button>
			</div>
		</div>
	);
}

function AuthenticatedDialerApp({
	userId,
	userName
}: {
	userId: string;
	userName: string;
}) {
	const {
		bootstrapped,
		accessPaused,
		device,
		creditNotification,
		onCall,
		audioCheckComplete,
		completeAudioCheck
	} = useDialerSession();
	const trainingStorageKey = `${TRAINING_HIDDEN_KEY_PREFIX}${userId}`;
	const [dontShowTraining, setDontShowTraining] = useState(() =>
		readTrainingPreference(trainingStorageKey)
	);
	const [trainingOpen, setTrainingOpen] = useState(() => !dontShowTraining);
	const [hiddenCreditId, setHiddenCreditId] = useState<string | null>(null);
	const [creditFlight, setCreditFlight] = useState<CreditFlight | null>(null);
	const creditFlightIdRef = useRef(0);
	const audioCheckOpen =
		bootstrapped && !accessPaused && !trainingOpen && !audioCheckComplete;
	const pendingCredit = creditNotification;
	const creditOpen = Boolean(
		pendingCredit &&
		hiddenCreditId !== pendingCredit.id &&
		!trainingOpen &&
		!audioCheckOpen &&
		!onCall
	);

	const acknowledgePendingCredit = () => {
		if (!pendingCredit) return;
		const notificationId = pendingCredit.id;
		setHiddenCreditId(notificationId);
		const campaignTarget = document.querySelector<HTMLElement>(
			'[data-credit-animation-target="campaigns"]'
		);
		if (campaignTarget) {
			const targetRect = campaignTarget.getBoundingClientRect();
			creditFlightIdRef.current += 1;
			setCreditFlight({
				id: creditFlightIdRef.current,
				startX: window.innerWidth / 2,
				startY: window.innerHeight / 2,
				endX: targetRect.left + targetRect.width / 2,
				endY: targetRect.top + targetRect.height / 2
			});
		}
		void acknowledgeCreditNotification(notificationId).catch(() => {
			setHiddenCreditId((current) =>
				current === notificationId ? null : current
			);
		});
	};

	const updateTrainingPreference = (hidden: boolean) => {
		setDontShowTraining(hidden);
		try {
			if (hidden) localStorage.setItem(trainingStorageKey, 'true');
			else localStorage.removeItem(trainingStorageKey);
		} catch {
			/* The prompt can still work when browser storage is unavailable. */
		}
	};

	if (accessPaused) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6">
				<div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-lg">
					<Badge variant="destructive" className="mb-4">
						Access paused
					</Badge>
					<h1 className="text-xl font-semibold tracking-tight">
						Dialer access is paused
					</h1>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						An administrator has paused your dialer access. You can still use
						the rest of the Policy Printer app.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
				<div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-1 sm:px-6">
					<div className="flex min-w-0 flex-wrap items-center gap-4">
						<img
							src={policyPrinterLogo}
							alt="Policy Printer"
							className="h-14 w-auto shrink-0 object-contain"
						/>
						<nav className="flex items-center gap-1" aria-label="Primary">
							<NavTab to="/dial" label="Calls" />
							<NavTab to="/crm" label="CRM" />
							<NavTab to="/callbacks" label="Callbacks" />
							<NavTab to="/leads" label="Activity" />
						</nav>
					</div>
					<HeaderUserBlock
						userName={userName}
						onShowTraining={() => setTrainingOpen(true)}
					/>
				</div>
			</header>
			<main className="px-4 py-6 sm:px-6">
				<InboundCallAutoNav />
				<DialerPageRoutes />
			</main>
			<TrainingVideoDialog
				open={trainingOpen}
				onOpenChange={setTrainingOpen}
				dontShowAgain={dontShowTraining}
				onDontShowAgainChange={updateTrainingPreference}
				videoSrc={TRAINING_VIDEO_SRC}
			/>
			<AudioSetupDialog
				open={audioCheckOpen}
				required
				showTrigger={false}
				onRequiredComplete={completeAudioCheck}
				onInputDeviceChange={device.setInputDevice}
				onOutputDeviceChange={device.setOutputDevice}
			/>
			<CreditNotificationDialog
				open={creditOpen}
				notification={pendingCredit}
				onAcknowledge={acknowledgePendingCredit}
			/>
			<CreditFlightAnimation
				flight={creditFlight}
				onComplete={() => setCreditFlight(null)}
			/>
		</div>
	);
}

function readTrainingPreference(storageKey: string): boolean {
	try {
		return localStorage.getItem(storageKey) === 'true';
	} catch {
		return false;
	}
}

/**
 * Keep the Calls page mounted while a real call is active, even if the user
 * temporarily navigates to CRM or Activity. Dial owns the lead form's local
 * draft state, so hiding (rather than unmounting) it prevents a tab change from
 * discarding fields already typed during that live call. Once no call is active,
 * the inactive route unmounts normally and returns to the usual fresh-load flow.
 */
function DialerPageRoutes() {
	const {onCall} = useDialerSession();
	const location = useLocation();
	// Use the router's matcher so URL variants it accepts (notably `/dial/`)
	// mount the Calls UI too. NavLink already treated those variants as active,
	// which could otherwise leave an active Calls tab above an empty page.
	const showingDial = Boolean(matchPath('/dial', location.pathname));
	const keepDialMounted = showingDial || onCall;

	return (
		<>
			<Routes>
				<Route path="/dial" element={null} />
				<Route path="/crm" element={<Crm key="crm" />} />
				<Route
					path="/callbacks"
					element={<Crm key="callbacks" callbacksOnly />}
				/>
				<Route path="/leads" element={<Leads />} />
				<Route path="*" element={<Navigate to="/dial" replace />} />
			</Routes>
			{keepDialMounted && (
				<div
					className={showingDial ? undefined : 'hidden'}
					aria-hidden={!showingDial}
				>
					<Dial />
				</div>
			)}
		</>
	);
}

function HeaderUserBlock({
	userName,
	onShowTraining
}: {
	userName: string;
	onShowTraining: () => void;
}) {
	const {profile, provisioned, device} = useDialerSession();
	const callbackNumber = profile?.agent?.twilio_phone_number;
	const pingMs = device.activeCall ? device.twilioRttMs : device.apiPingMs;

	return (
		<div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
			<span
				className="hidden max-w-40 truncate text-xs font-medium text-muted-foreground sm:block"
				title={`Logged in as ${userName}`}
			>
				{userName}
			</span>
			{provisioned && callbackNumber && (
				<CallbackNumber number={callbackNumber} />
			)}
			<span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
				{pingMs === null ? '— ms' : `${pingMs} ms`}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-7"
				onClick={onShowTraining}
				title="Watch dialer training"
				aria-label="Watch dialer training"
			>
				<HelpCircle className="size-3.5" />
			</Button>
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
			title={`Your phone number: ${formatDid(number)}. Click to copy.`}
			aria-label={`Copy your phone number ${formatDid(number)}`}
			className="group flex h-7 items-center gap-1.5 rounded-md bg-muted/60 px-2 text-xs transition-colors hover:bg-muted"
		>
			<Phone className="size-3.5 text-muted-foreground" />
			<span className="whitespace-nowrap font-mono font-medium">
				{formatDid(number)}
			</span>
			{copied ? (
				<Check className="size-3.5 text-success" />
			) : (
				<Copy className="size-3.5 text-muted-foreground opacity-50 group-hover:opacity-100" />
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
