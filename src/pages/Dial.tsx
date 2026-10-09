import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {
	ChevronDown,
	CircleAlert,
	CircleCheck,
	Delete,
	Headphones,
	ListChecks,
	Loader2,
	Mic,
	PanelLeftClose,
	PanelLeftOpen,
	PhoneCall,
	PhoneOutgoing,
	Power,
	Radar,
	RadioTower,
	ScrollText,
	Wifi,
	WifiOff,
	Zap
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {Separator} from '@/components/ui/separator';
import {Switch} from '@/components/ui/switch';
import {
	listCampaignRemainingCalls,
	setCampaignReady,
	setOnCall,
	setPresence,
	type DialerCampaign,
	type DialerPresence,
	type HotStateCount,
	type PresenceStatus
} from '@/lib/api';
import {
	formatAllowanceCount,
	resolveCampaignAllowance
} from '@/lib/campaignAllowance';
import {getReadyBalanceWarning} from '@/lib/readyBalanceWarning';
import {Input} from '@/components/ui/input';
import {useDialerSession} from '@/session/DialerSessionProvider';
import {type ActiveCall} from '@/twilio/useDevice';
import {ActiveCallBanner} from '@/twilio/ActiveCallBanner';
import {CallParticipantBanner} from '@/twilio/CallParticipantBanner';
import {OutboundCallBanner} from '@/twilio/OutboundCallBanner';
import {AudioSetupDialog} from '@/twilio/AudioSetupDialog';
import {useLiveEchoControls} from '@/voice/useLiveEchoControls';
import {MicLevelMeter, useMicLevelMeter} from '@/twilio/MicLevelMeter';
import {LeadForm} from '@/leads/LeadForm';
import {LeadNotesPanel} from '@/leads/LeadNotesContext';
import {ScriptDoc} from '@/scriptDoc/ScriptDoc';
import {showsScriptDoc} from '@/scriptDoc/campaigns';
import {useLeadFormBridge} from '@/leads/LeadFormBridgeContext';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {ReturningCallerCard} from '@/leads/ReturningCallerCard';
import {useReturningCaller} from '@/leads/useReturningCaller';
import {cn} from '@/lib/utils';
import {normalizeDialInput} from '@/lib/phone';
import {getUser} from '@/auth/session';
import {CampaignAllowanceDisplay} from '@/components/CampaignAllowanceDisplay';
import {HotStatesCard} from '@/hotStates/HotStatesCard';
import {useHotStates} from '@/hotStates/useHotStates';

/**
 * Dial page (Subplan 02 + 03) — presence, heartbeat, per-campaign ready toggles, and
 * the Twilio softphone (device registration, auto-answer, active-call UI).
 *
 * The agent ARMS one or more campaigns (a Ready switch per campaign — CTV and/or
 * Social), then flips the global Ready master switch. While Ready + at least one armed
 * campaign + a fresh heartbeat + a registered Twilio device all hold, the backend
 * reports `available: 1` and Retreaver may route an inbound call from any armed buyer.
 * Each armed buyer is evaluated independently; Retreaver owns winner selection.
 *
 * On an inbound call the Device auto-answers (Retreaver already chose this ready agent);
 * the active-call banner shows caller/timer/mute/hangup, and the toggles are disabled
 * while on the call. The lead form uses the call's campaign (auto when a single campaign
 * is armed, otherwise the agent picks it).
 */
// ENG-298: all three script views share one column, matching the training workspace.
const SCRIPT_DOC_COLS = 'xl:grid-cols-[minmax(30rem,2fr)_minmax(0,3fr)]';

export default function Dial() {
	// Shared session: the single Device + heartbeat + bootstrap (profile/campaigns/
	// presence) live in the provider so they survive tab switches. Destructure using
	// the SAME local names this component already used, so the rest of the body is
	// unchanged.
	const session = useDialerSession();
	const {device, heartbeat, profile, provisioned, campaigns} = session;
	const user = getUser();
	const userName = [user?.first_name, user?.last_name]
		.filter(Boolean)
		.join(' ');
	const showDebugCall = userName === 'dialer-test user';
	const presence = session.presence;
	const setCampaigns = session.setCampaigns;
	const setPresenceState = session.setPresence;
	// Where the org's calls have been coming from lately (ENG-201). Polled, decorative,
	// and independent of the call machinery — a failure here never affects dialing.
	const {states: hotStates, windowHours: hotStatesWindowHours} = useHotStates();

	const [busy, setBusy] = useState<'status' | string | null>(null);
	const [pendingReadyStatus, setPendingReadyStatus] =
		useState<PresenceStatus | null>(null);
	const [readyRequestSettled, setReadyRequestSettled] = useState(false);
	const [balanceWarning, setBalanceWarning] = useState<string | null>(null);
	const readyBalanceRequest = useRef(0);
	useEffect(
		() => () => {
			readyBalanceRequest.current += 1;
		},
		[]
	);
	const [error, setError] = useState<string | null>(null);
	const [debugIncomingCall, setDebugIncomingCall] = useState(false);
	const [debugCallMuted, setDebugCallMuted] = useState(false);
	const [debugCallHeld, setDebugCallHeld] = useState(false);
	const [debugCallSid, setDebugCallSid] = useState<string | null>(null);
	const [debugCallStartedAt, setDebugCallStartedAt] = useState<number | null>(
		null
	);
	// Which campaign the active call's lead form is for. Defaults to the sole armed
	// campaign; when several are armed the agent picks (the call can be from any buyer).
	const [leadCampaignId, setLeadCampaignId] = useState<string>('');
	// Whitelisted campaign whose script the agent opened from the Campaigns menu while idle (ENG-298).
	const [scriptPreviewCampaign, setScriptPreviewCampaign] =
		useState<DialerCampaign | null>(null);
	const [wrapUpCall, setWrapUpCall] = useState<ActiveCall | null>(null);
	const [completedWrapUpCallKey, setCompletedWrapUpCallKey] = useState<
		string | null
	>(null);
	const [confirmedAvailable, setConfirmedAvailable] = useState<0 | 1 | null>(
		null
	);
	// Returning-caller pane dismissal, keyed to the call it was dismissed on. A new
	// call has a different callKey, so the pane re-shows automatically (reset per call).
	const [dismissedCallerKey, setDismissedCallerKey] = useState<string | null>(
		null
	);
	const [wrapUpReleasePending, setWrapUpReleasePending] = useState(false);
	// Outbound dialpad digits. In-flight/pending state lives with the route-persistent
	// Device so navigation cannot orphan ringback or cancellation.
	const [dialInput, setDialInput] = useState('');

	// device, heartbeat, profile, provisioned, campaigns, presence + bootstrap and the
	// presence-sync effect now live in DialerSessionProvider (destructured above), so
	// the Device survives tab switches. The effects below still run here because they
	// depend on Dial-local UI state.

	useEffect(() => {
		if (
			pendingReadyStatus &&
			readyRequestSettled &&
			heartbeat.presence?.status === pendingReadyStatus
		) {
			setPendingReadyStatus(null);
			setReadyRequestSettled(false);
			setBusy((current) => (current === 'status' ? null : current));
		}
	}, [heartbeat.presence?.status, pendingReadyStatus, readyRequestSettled]);

	useEffect(() => {
		if (heartbeat.available !== null) {
			setConfirmedAvailable(heartbeat.available);
		}
	}, [heartbeat.available]);

	const status: PresenceStatus = presence?.status ?? 'paused';
	const armedCampaigns = useMemo(
		() => campaigns.filter((c) => c.ready),
		[campaigns]
	);
	const anyArmed = armedCampaigns.length > 0;

	// Preselect the sole armed campaign. With several campaigns armed, preserve the
	// agent's manual choice while it remains valid. A campaign carried on an inbound
	// voice invite is call-specific and overrides this below.
	useEffect(() => {
		if (armedCampaigns.length === 1) {
			setLeadCampaignId(armedCampaigns[0].id);
		} else if (
			leadCampaignId &&
			!armedCampaigns.some((c) => c.id === leadCampaignId)
		) {
			setLeadCampaignId('');
		}
	}, [armedCampaigns, leadCampaignId]);

	// Prefer the newest backend-computed availability: heartbeat responses and
	// presence mutation responses both return the same computeReady result.
	const available =
		confirmedAvailable ?? (status === 'ready' && anyArmed ? null : 0);

	const onToggleReady = () => {
		const next: PresenceStatus = status === 'ready' ? 'paused' : 'ready';
		const balanceRequest = ++readyBalanceRequest.current;
		setBalanceWarning(null);
		if (next === 'ready') {
			const selected = armedCampaigns.map(({id, name}) => ({id, name}));
			// Best effort only: readiness never waits on or depends on Retreaver.
			void listCampaignRemainingCalls()
				.then((response) => {
					if (readyBalanceRequest.current !== balanceRequest) return;
					setBalanceWarning(getReadyBalanceWarning(response, selected));
				})
				.catch(() => {
					// Network failures / HTTP 4xx or 5xx: skip the warning and continue.
				});
		}
		setPendingReadyStatus(next);
		setReadyRequestSettled(false);
		setBusy('status');
		setError(null);
		session.changePresence(next)
			.then((res) => {
				if (res.statusCode !== 'SP100') {
					throw new Error(res.statusMessage || 'Could not update presence');
				}
				if (res.presence) setPresenceState(res.presence);
				if (res.available !== undefined) setConfirmedAvailable(res.available);
				setReadyRequestSettled(true);
			})
			.catch((err) => {
				readyBalanceRequest.current += 1;
				setBalanceWarning(null);
				setPendingReadyStatus(null);
				setReadyRequestSettled(false);
				setError(readError(err, 'Could not update presence'));
				setBusy(null);
			});
	};

	const onToggleCampaign = (campaignId: string, ready: boolean) => {
		setBusy(campaignId);
		setError(null);
		// Optimistic: reflect the toggle immediately, revert on failure.
		setCampaigns((cur) =>
			cur.map((c) => (c.id === campaignId ? {...c, ready} : c))
		);
		setCampaignReady(campaignId, ready)
			.then((res) => {
				if (res.statusCode !== 'SP100') {
					throw new Error(res.statusMessage || 'Could not update campaign');
				}
				if (res.presence) setPresenceState(res.presence);
				if (res.available !== undefined) setConfirmedAvailable(res.available);
			})
			.catch((err) => {
				setError(readError(err, 'Could not update campaign'));
				// Revert the optimistic flip.
				setCampaigns((cur) =>
					cur.map((c) => (c.id === campaignId ? {...c, ready: !ready} : c))
				);
			})
			.finally(() => setBusy(null));
	};

	const onToggleDebugIncomingCall = () => {
		setDebugIncomingCall((current) => {
			if (current) {
				setDebugCallStartedAt(null);
				setDebugCallMuted(false);
				setDebugCallHeld(false);
				setDebugCallSid(null);
				return false;
			}
			const startedAt = Date.now();
			setDebugCallStartedAt(startedAt);
			setDebugCallMuted(false);
			setDebugCallHeld(false);
			// Use a fresh SID per simulated call so the real persistence path can
			// materialize an agent-owned call row without colliding with an older
			// debug session from another user/org.
			setDebugCallSid(
				`debug-incoming-call-${startedAt}-${Math.random().toString(36).slice(2)}`
			);
			return true;
		});
	};

	// On a call if the live Device says so, the backend flag is set, or a disconnected
	// call still needs disposition/lead wrap-up before this agent can receive another.
	const liveOnCall = session.onCall;
	const debugCallActive =
		debugIncomingCall && !device.activeCall && Boolean(debugCallSid);
	const debugCall: ActiveCall | null = debugCallActive
		? {
				from: '+15555550100',
				callSid: debugCallSid!,
				campaignId: null,
				retreaverUuid: null,
				muted: debugCallMuted,
				held: debugCallHeld,
				holdPending: false,
				startedAt: debugCallStartedAt ?? Date.now(),
				direction: 'inbound'
			}
		: null;
	const activeCall = device.activeCall ?? debugCall;
	const workCall = activeCall ?? wrapUpCall;
	// A real call takes over the script column: drop any open preview.
	const hasWorkCall = Boolean(workCall);
	useEffect(() => {
		if (hasWorkCall) setScriptPreviewCampaign(null);
	}, [hasWorkCall]);
	const wrapUpCallKey = workCall ? callKey(workCall) : null;
	const attributedCampaign = workCall?.campaignId
		? campaigns.find((campaign) => campaign.id === workCall.campaignId)
		: undefined;
	// A campaign attached to the Twilio invite is call-specific and authoritative.
	// Ordinary unattributed/direct calls retain the existing presence/manual fallback.
	let effectiveLeadCampaignId = leadCampaignId;
	if (workCall?.direction === 'inbound' && attributedCampaign) {
		effectiveLeadCampaignId = attributedCampaign.id;
	}
	const effectiveCampaign = effectiveLeadCampaignId
		? campaigns.find((campaign) => campaign.id === effectiveLeadCampaignId)
		: undefined;
	const campaignDisplayPhase = activeCall ? 'active' : 'wrap_up';

	useEffect(() => {
		if (!workCall) return;
		console.info('[dialer][campaign] displayed', {
			callSid: workCall.callSid || null,
			clientCallSid: workCall.clientCallSid || null,
			phase: campaignDisplayPhase,
			callAttributedCampaignId: workCall.campaignId,
			callAttributedCampaignName: attributedCampaign?.name ?? null,
			manualCampaignId: leadCampaignId || null,
			effectiveCampaignId: effectiveLeadCampaignId || null,
			effectiveCampaignName: effectiveCampaign?.name ?? null
		});
	}, [
		attributedCampaign?.name,
		campaignDisplayPhase,
		effectiveCampaign?.name,
		effectiveLeadCampaignId,
		leadCampaignId,
		workCall?.callSid,
		workCall?.campaignId,
		workCall?.clientCallSid
	]);

	// Keep prior-history pull-up for agent-originated outbound calls only. Inbound
	// calls always start a new lead: they do not run the returning-caller classifier,
	// render its notice, or update an older lead in place.
	const outboundHistory = useReturningCaller(
		workCall?.direction === 'outbound' ? workCall.from : null,
		workCall?.direction === 'outbound' ? workCall.callSid : null
	);
	const editLead =
		workCall?.direction === 'outbound' && outboundHistory.data?.is_direct_dial
			? (outboundHistory.data.most_recent_lead?.lead ?? null)
			: null;
	const wrapUpCompleted =
		Boolean(wrapUpCallKey) && completedWrapUpCallKey === wrapUpCallKey;
	const priorHistoryDismissed =
		Boolean(wrapUpCallKey) && dismissedCallerKey === wrapUpCallKey;
	const onCall = liveOnCall || debugIncomingCall || Boolean(wrapUpCall);
	const displayAvailable = onCall ? 0 : available;
	const canGoReady = anyArmed; // must arm ≥1 campaign first
	const deviceError = device.error;
	// Local `error` is for action failures (presence/campaign/dial/wrap-up); bootstrap
	// (load) failures come from the shared session. Show either in the banner.
	const displayError = error || session.bootError;

	// Debug calls and local wrap-up do not exist in Twilio/backend state. Mirror that
	// local busy state into the shared session so app-level UI (including credit
	// notifications) stays out of the way until the call workflow is finished.
	useEffect(() => {
		session.setCallUiBusy(debugIncomingCall || Boolean(wrapUpCall));
		return () => session.setCallUiBusy(false);
	}, [debugIncomingCall, wrapUpCall, session.setCallUiBusy]);

	useEffect(() => {
		if (!activeCall) return;
		const nextCallKey = callKey(activeCall);
		if (!wrapUpCall || callKey(wrapUpCall) !== nextCallKey) {
			setCompletedWrapUpCallKey(null);
			setDismissedCallerKey(null);
			// A manual campaign pick is scoped to the call it was made for — an
			// unattributed call must show the picker, not inherit the last pick.
			setLeadCampaignId('');
		}
		setWrapUpCall(activeCall);
	}, [activeCall, wrapUpCall]);

	const releaseCallWrapUp = async () => {
		if (device.participant) return;
		if (!wrapUpCall) return;
		setWrapUpReleasePending(true);
		setError(null);
		try {
			// Pause first so clearing on_call cannot immediately make the agent routable.
			const pauseRes = await setPresence({status: 'paused'});
			if (pauseRes.statusCode !== 'SP100') {
				throw new Error(pauseRes.statusMessage || 'Could not pause after call');
			}
			setPresenceState(pauseRes.presence ?? null);
			if (pauseRes.available !== undefined) {
				setConfirmedAvailable(pauseRes.available);
			}
			setPendingReadyStatus(null);
			setReadyRequestSettled(false);
			setBusy((current) => (current === 'status' ? null : current));

			const res = await setOnCall(false);
			if (res.statusCode !== 'SP100') {
				throw new Error(res.statusMessage || 'Could not release call');
			}
			setPresenceState(res.presence ?? null);
			if (res.available !== undefined) setConfirmedAvailable(res.available);
			setWrapUpCall(null);
			setCompletedWrapUpCallKey(null);
			setLeadCampaignId('');
		} catch (err) {
			setError(readError(err, 'Could not release call'));
			throw err;
		} finally {
			setWrapUpReleasePending(false);
		}
	};

	const onWrapUpComplete = async () => {
		if (!workCall) return;
		setCompletedWrapUpCallKey(callKey(workCall));
		if (!activeCall) {
			await releaseCallWrapUp();
		}
	};

	// Place an outbound call through the persistent device/session layer. It primes
	// audio synchronously, starts local ringback, owns the exact parent SID, and keeps
	// cancellation available across route changes.
	const canDial =
		provisioned &&
		device.deviceStatus === 'registered' &&
		(!onCall || device.canAddParticipant) &&
		!device.participant &&
		normalizeDialInput(dialInput) !== null;

	const onDialOut = async () => {
		const to = normalizeDialInput(dialInput);
		if (!to || !canDial || device.outboundStarting) return;
		setError(null);
		try {
			await device.startOutbound(to);
			setDialInput('');
		} catch (err) {
			setError(readError(err, 'Could not place the call'));
		}
	};

	useEffect(() => {
		if (
			!wrapUpCall ||
			activeCall ||
			!completedWrapUpCallKey ||
			completedWrapUpCallKey !== callKey(wrapUpCall) ||
			wrapUpReleasePending
		) {
			return;
		}

		void releaseCallWrapUp().catch(() => undefined);
	}, [
		activeCall,
		completedWrapUpCallKey,
		wrapUpCall,
		wrapUpReleasePending,
		device.participant
	]);

	// With the script doc up (a call on a script-doc campaign) the script + form
	// split the width; otherwise the call column sits centered on the page.
	const {view: leadFormView} = useLeadFormBridge();
	const scriptCollapsedKey = `pp_dialer_script_collapsed:${user?.user_id ?? 'default'}`;
	const [scriptCollapsed, setScriptCollapsed] = useState(() => {
		try {
			return localStorage.getItem(scriptCollapsedKey) === 'true';
		} catch {
			return false;
		}
	});
	useEffect(() => {
		try {
			localStorage.setItem(scriptCollapsedKey, String(scriptCollapsed));
		} catch {
			// Keep the toggle usable when browser storage is unavailable.
		}
	}, [scriptCollapsed, scriptCollapsedKey]);
	// ENG-298: the script doc's linked blanks read the live lead form + agent name.
	const scriptValues = useMemo(
		() => ({
			agentName: userName || null,
			formData: leadFormView?.formData,
			formSchema: leadFormView?.schema
		}),
		[userName, leadFormView?.formData, leadFormView?.schema]
	);
	// Whitelisted campaigns only (src/scriptDoc/campaigns.ts): on a call, the
	// call's campaign decides; idle, a preview opened from the Campaigns menu.
	const scriptOpen = workCall
		? showsScriptDoc(effectiveCampaign?.name)
		: Boolean(scriptPreviewCampaign);

	return (
		<div
			className={cn(
				'w-full',
				scriptOpen &&
					'xl:flex xl:h-[calc(100dvh-7rem)] xl:min-h-0 xl:flex-col'
			)}
		>
			{balanceWarning && (
				<div
					role="alert"
					className="mb-4 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
				>
					<CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
					<p className="flex-1">
						{balanceWarning} Your ready status is not blocked.
					</p>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setBalanceWarning(null)}
					>
						Dismiss
					</Button>
				</div>
			)}
			{showDebugCall && (
				<DebugIncomingCallToggle
					active={debugIncomingCall}
					onToggle={onToggleDebugIncomingCall}
				/>
			)}

			{/* Controls toolbar across the top (dropdowns open over the page), then
          two columns: LEFT (script) and CENTER (call core / lead form).
          Side-by-side at xl, stacked below (center first). */}
			<div
				className={cn(
					'flex flex-col gap-8',
					scriptOpen
						? cn(
								'xl:grid xl:min-h-0 xl:flex-1 xl:grid-rows-[auto_minmax(0,1fr)] xl:items-start xl:gap-3',
								SCRIPT_DOC_COLS
							)
						: 'xl:gap-3'
				)}
			>
				{/* LEFT — errors, prominent active-lead notes, then returning-caller pane. */}
				<div
					className={cn(
						'order-2 flex flex-col items-stretch gap-5 empty:hidden xl:order-none',
						scriptOpen
							? 'xl:col-start-1 xl:row-start-2 xl:h-full xl:min-h-0 xl:min-w-0'
							: 'mx-auto w-full max-w-3xl'
					)}
				>
					{scriptOpen && (
						<div className="flex min-h-8 shrink-0 items-center">
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-controls="call-script"
								aria-expanded={!scriptCollapsed}
								onClick={() => setScriptCollapsed((collapsed) => !collapsed)}
							>
								{scriptCollapsed ? (
									<PanelLeftOpen className="size-4" />
								) : (
									<PanelLeftClose className="size-4" />
								)}
								{scriptCollapsed ? 'Show script' : 'Hide script'}
							</Button>
						</div>
					)}
					{displayError && (
						<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
							{displayError}
						</div>
					)}
					{deviceError && (
						<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
							Softphone: {deviceError}
						</div>
					)}

					{scriptOpen && (
						<div
							id="call-script"
							className={scriptCollapsed ? 'hidden' : 'contents'}
						>
							<ScriptDoc
								key={wrapUpCallKey ?? 'call'}
								onClose={workCall ? undefined : () => setScriptPreviewCampaign(null)}
								values={scriptValues}
							/>
						</div>
					)}
					{scriptOpen &&
						scriptCollapsed &&
						profile &&
						provisioned &&
						workCall &&
						effectiveLeadCampaignId &&
						!wrapUpCompleted && <LeadNotesPanel />}

					{profile && provisioned && (
						<>
							{/* Outbound-only prior-history strip. Inbound calls deliberately skip
                  the lookup and always use a fresh lead form. */}
							{workCall?.direction === 'outbound' &&
								!wrapUpCompleted &&
								!priorHistoryDismissed && (
									<ReturningCallerCard
										result={outboundHistory.data}
										direction="outbound"
										onDismiss={() => setDismissedCallerKey(wrapUpCallKey)}
									/>
								)}
						</>
					)}
				</div>

				{/* CENTER — the interactive call core (banners + lead form). */}
				<div
					className={cn(
						'order-1 flex w-full flex-col gap-5 xl:order-none xl:min-w-0',
						scriptOpen
							? 'xl:col-start-2 xl:row-start-2 xl:h-full xl:min-h-0'
							: 'mx-auto max-w-3xl'
					)}
				>
					<div className="flex min-h-8 shrink-0 flex-wrap items-center gap-4">
						<h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
						<CallsMicMeter
							enabled={provisioned}
							deviceId={device.inputDeviceId}
						/>
					</div>

					{!session.bootstrapped && !displayError && (
						<Card className="shadow-xs">
							<CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading dialer…
							</CardContent>
						</Card>
					)}

					{profile && !provisioned && (
						<Card className="shadow-xs">
							<CardHeader>
								<CardTitle>Agent setup required</CardTitle>
							</CardHeader>
							<CardContent className="text-sm leading-6 text-muted-foreground">
								Your dialer agent is not provisioned yet. An admin must set your
								phone number and buyer id before you can go ready.
							</CardContent>
						</Card>
					)}

					{profile && provisioned && (
						<>
							{activeCall ? (
								<ActiveCallBanner
									call={activeCall}
									participantPhase={device.participant?.phase}
									whisperNotice={session.whisperNotice}
									campaignName={
										activeCall.campaignId
											? (campaigns.find(
													(campaign) => campaign.id === activeCall.campaignId
												)?.name ?? null)
											: null
									}
									onMute={device.activeCall ? device.mute : setDebugCallMuted}
									onHold={
										device.activeCall
											? device.setHold
											: async (held) => setDebugCallHeld(held)
									}
									onHangup={
										device.activeCall
											? device.hangup
											: onToggleDebugIncomingCall
									}
								/>
							) : device.pendingOutbound || device.outboundStarting ? (
								<OutboundCallBanner
									toNumber={
										device.pendingOutbound?.toNumber ??
										device.outboundStarting?.toNumber ??
										''
									}
									pending={device.pendingOutbound}
									starting={device.outboundStarting}
									onCancel={device.cancelPendingOutbound}
								/>
							) : wrapUpCall ? (
								<WrapUpCallPanel
									call={wrapUpCall}
									completed={wrapUpCompleted}
									releasePending={wrapUpReleasePending}
									onRelease={releaseCallWrapUp}
								/>
							) : (
								<IdleCallPanel available={displayAvailable} />
							)}

							{device.participant && (
								<CallParticipantBanner
									participant={device.participant}
									onMerge={device.mergeParticipant}
									onEnd={device.endParticipant}
								/>
							)}
							{device.participantNotice && !device.participant && (
								<p role="status" className="text-sm text-muted-foreground">
									{device.participantNotice}
								</p>
							)}

							{/* Lead capture — held open after hangup until the call is dispositioned.
                  Inbound always creates a new lead; outbound may update prior history. */}
							{workCall && effectiveLeadCampaignId && !wrapUpCompleted && (
								// Notes move to the script column while the script is hidden.
								<section
									aria-label="Lead notes and form"
									className="flex max-h-[calc(100dvh-19rem)] min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-1 xl:max-h-none xl:flex-1"
								>
									{!(scriptOpen && scriptCollapsed) && (
										<div className="min-w-0 empty:hidden">
											<LeadNotesPanel />
										</div>
									)}
									<div className="min-w-0">
										<LeadForm
											key={`${workCall.callSid || 'active-call'}:${editLead?.id ?? 'new'}`}
											campaignId={effectiveLeadCampaignId}
											callSid={workCall.callSid || null}
											callerPhone={workCall.from}
											onComplete={onWrapUpComplete}
											showClear={false}
											editLead={editLead}
											publishToScriptDoc
										/>
									</div>
								</section>
							)}
							{workCall && !effectiveLeadCampaignId && !wrapUpCompleted && (
								<Card className="shadow-xs">
									<CardHeader>
										<CardTitle>Choose a campaign</CardTitle>
									</CardHeader>
									<CardContent className="space-y-3 text-sm">
										<p className="text-muted-foreground">
											Pick the campaign to log this lead under.
										</p>
										<div className="grid gap-2">
											{(armedCampaigns.length ? armedCampaigns : campaigns).map(
												(c) => (
													<Button
														key={c.id}
														type="button"
														variant="outline"
														className="justify-start"
														onClick={() => setLeadCampaignId(c.id)}
													>
														{c.name}
													</Button>
												)
											)}
										</div>
									</CardContent>
								</Card>
							)}
						</>
					)}
				</div>

				{/* RIGHT — controls (Go Ready / Campaigns / Audio), status recap,
				    then the hot-states ranking. */}
				<DialSidebar
					status={status}
					busy={busy}
					onCall={onCall}
					provisioned={provisioned}
					canGoReady={canGoReady}
					onToggleReady={onToggleReady}
					campaigns={campaigns}
					onToggleCampaign={onToggleCampaign}
					onPreviewScript={(campaign) => {
						setScriptCollapsed(false);
						setScriptPreviewCampaign(campaign);
					}}
					inputDeviceId={device.inputDeviceId}
					outputDeviceId={device.outputDeviceId}
					onInputDeviceChange={device.setInputDevice}
					onOutputDeviceChange={device.setOutputDevice}
					available={displayAvailable}
					connected={heartbeat.connected}
					deviceStatus={device.deviceStatus}
					networkChecking={device.networkChecking}
					armedCount={armedCampaigns.length}
					campaignCount={campaigns.length}
					anyArmed={anyArmed}
					presence={presence}
					readyStatePending={pendingReadyStatus !== null}
					showOutboundDialer={Boolean(profile && provisioned)}
					dialInput={dialInput}
					onDialInputChange={setDialInput}
					onDialOut={onDialOut}
					canDial={canDial}
					dialPending={
						Boolean(device.outboundStarting) ||
						['preparing', 'dialing', 'ringing'].includes(
							device.participant?.phase ?? ''
						)
					}
					addingToCall={Boolean(device.activeCall)}
					hotStates={hotStates}
					hotStatesWindowHours={hotStatesWindowHours}
				/>
			</div>
		</div>
	);
}

function callKey(call: ActiveCall): string {
	return call.callSid || `${call.from}-${call.startedAt}`;
}

function WrapUpCallPanel({
	call,
	completed,
	releasePending,
	onRelease
}: {
	call: ActiveCall;
	completed: boolean;
	releasePending: boolean;
	onRelease: () => Promise<void>;
}) {
	return (
		<Card className="border-amber-200 bg-amber-50/50 shadow-xs dark:border-amber-400/30 dark:bg-amber-400/10">
			<CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
						{completed ? (
							<CircleCheck className="size-5" />
						) : (
							<PhoneCall className="size-5" />
						)}
					</div>
					<div className="min-w-0">
						<p className="font-medium">
							{completed ? 'Call wrap-up complete' : 'Finish call wrap-up'}
						</p>
						<p className="mt-1 text-sm leading-6 text-muted-foreground">
							{completed
								? 'Releasing availability so another call can route.'
								: `Select a disposition for ${call.from} before taking another call.`}
						</p>
					</div>
				</div>
				{completed && (
					<Button
						type="button"
						variant="outline"
						disabled={releasePending}
						onClick={() => void onRelease().catch(() => undefined)}
					>
						{releasePending && <Loader2 className="size-4 animate-spin" />}
						Finalize
					</Button>
				)}
			</CardContent>
		</Card>
	);
}

function DebugIncomingCallToggle({
	active,
	onToggle
}: {
	active: boolean;
	onToggle: () => void;
}) {
	return (
		<Button
			type="button"
			variant={active ? 'destructive' : 'outline'}
			size="sm"
			onClick={onToggle}
			aria-pressed={active}
			className="fixed bottom-28 right-4 z-50 h-7 px-2 text-[11px] opacity-25 hover:opacity-100"
		>
			{active ? 'End call' : 'Debug call'}
		</Button>
	);
}

function DialSidebar({
	status,
	busy,
	onCall,
	provisioned,
	canGoReady,
	onToggleReady,
	campaigns,
	onToggleCampaign,
	onPreviewScript,
	inputDeviceId,
	outputDeviceId,
	onInputDeviceChange,
	onOutputDeviceChange,
	available,
	connected,
	deviceStatus,
	networkChecking,
	armedCount,
	campaignCount,
	anyArmed,
	presence,
	readyStatePending,
	showOutboundDialer,
	dialInput,
	onDialInputChange,
	onDialOut,
	canDial,
	addingToCall,
	dialPending,
	hotStates,
	hotStatesWindowHours
}: {
	status: PresenceStatus;
	busy: 'status' | string | null;
	onCall: boolean;
	provisioned: boolean;
	canGoReady: boolean;
	onToggleReady: () => void;
	campaigns: DialerCampaign[];
	onToggleCampaign: (campaignId: string, ready: boolean) => void;
	onPreviewScript: (campaign: DialerCampaign) => void;
	inputDeviceId: string;
	outputDeviceId: string;
	onInputDeviceChange: (deviceId: string) => Promise<void>;
	onOutputDeviceChange: (deviceId: string) => Promise<void>;
	available: 0 | 1 | null;
	connected: boolean;
	deviceStatus: string;
	networkChecking: boolean;
	armedCount: number;
	campaignCount: number;
	anyArmed: boolean;
	presence: DialerPresence | null;
	readyStatePending: boolean;
	showOutboundDialer: boolean;
	dialInput: string;
	onDialInputChange: (value: string) => void;
	onDialOut: () => void;
	canDial: boolean;
	dialPending: boolean;
	addingToCall: boolean;
	hotStates: HotStateCount[];
	hotStatesWindowHours: number | null;
}) {
	const liveEcho = useLiveEchoControls();
	const selectedCampaigns = campaigns.filter((campaign) => campaign.ready);
	const showCampaignAllowancePopup =
		selectedCampaigns.length > 0 && status !== 'ready' && busy !== 'status';

	const readyControl = (
		<div className="group/ready relative min-w-36 flex-1">
			<Button
				className="w-full"
				variant={status === 'ready' ? 'outline' : 'success'}
				onClick={onToggleReady}
				aria-describedby={
					showCampaignAllowancePopup ? 'campaign-allowance-popup' : undefined
				}
				disabled={
					busy !== null ||
					onCall ||
					!provisioned ||
					(status !== 'ready' && !canGoReady)
				}
			>
				{busy === 'status' ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Power className="size-4" />
				)}
				{busy === 'status'
					? 'Saving…'
					: status === 'ready'
						? 'Pause Calls'
						: 'Go Ready'}
			</Button>

			{showCampaignAllowancePopup && (
				<div
					id="campaign-allowance-popup"
					role="tooltip"
					className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 text-popover-foreground opacity-0 shadow-lg transition duration-150 group-focus-within/ready:opacity-100 group-hover/ready:opacity-100"
				>
					<CampaignAllowanceDisplay campaigns={selectedCampaigns} />
				</div>
			)}
		</div>
	);

	return (
		<aside className="order-first flex w-full basis-full flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-xs xl:col-span-2 xl:col-start-1 xl:row-start-1">
			{readyControl}
			<div className="min-w-36 flex-1">
				<CampaignMenu
					campaigns={campaigns}
					busy={busy}
					onCall={onCall}
					onToggleCampaign={onToggleCampaign}
					onPreviewScript={onPreviewScript}
				/>
			</div>
			<div className="min-w-36 flex-1">
				<AudioSetupDialog
					inputDeviceId={inputDeviceId}
					outputDeviceId={outputDeviceId}
					onInputDeviceChange={onInputDeviceChange}
					onOutputDeviceChange={onOutputDeviceChange}
					liveEcho={liveEcho}
				/>
			</div>
			{showOutboundDialer && (
				<ToolbarPopover
					label="Outbound Dialer"
					icon={<PhoneOutgoing className="size-4" />}
					className="w-80"
				>
					<Dialpad
						value={dialInput}
						onChange={onDialInputChange}
						onDial={onDialOut}
						canDial={canDial}
						pending={dialPending}
						addingToCall={addingToCall}
						deviceRegistered={deviceStatus === 'registered'}
					/>
				</ToolbarPopover>
			)}
			<ToolbarPopover
				label="Current Status"
				trailing={
					<AvailabilityBadge
						available={available}
						connected={connected}
						onCall={onCall}
						pending={readyStatePending}
					/>
				}
				className="w-96"
			>
				<StatusPreview
					available={available}
					connected={connected}
					status={status}
					deviceStatus={deviceStatus}
					networkChecking={networkChecking}
					armedCount={armedCount}
					campaignCount={campaignCount}
					anyArmed={anyArmed}
					onCall={onCall}
					presence={presence}
					provisioned={provisioned}
					readyStatePending={readyStatePending}
				/>
			</ToolbarPopover>
			{hotStates.length > 0 && (
				<ToolbarPopover label="Hot States 🔥" className="w-80 p-0">
					<HotStatesCard
						states={hotStates}
						windowHours={hotStatesWindowHours}
					/>
				</ToolbarPopover>
			)}
		</aside>
	);
}

/** Live mic level beside the Calls heading while the controls are a toolbar. */
function CallsMicMeter({
	enabled,
	deviceId
}: {
	enabled: boolean;
	deviceId: string;
}) {
	const meter = useMicLevelMeter({enabled, deviceId});
	return (
		<div
			className="flex w-56 items-center gap-2 self-center"
			title="Live microphone level"
		>
			<Mic className="size-4 shrink-0 text-muted-foreground" />
			<MicLevelMeter segments={meter.segments} className="min-w-0 flex-1" />
		</div>
	);
}

/** A top-toolbar button whose panel drops down over the page (script mode). */
function ToolbarPopover({
	label,
	icon,
	trailing,
	className,
	children
}: {
	label: string;
	icon?: ReactNode;
	trailing?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" className="min-w-36 flex-1 justify-between">
					{icon}
					<span className="mr-auto truncate">{label}</span>
					{trailing}
					<ChevronDown className="size-4 opacity-60" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className={className}>
				{children}
			</PopoverContent>
		</Popover>
	);
}

const CAMPAIGN_SPEED_LABELS: Record<DialerCampaign['speed'], string> = {
	1: 'Average',
	2: 'Quick',
	3: 'Fast',
	4: 'Fastest'
};

function CampaignSpeedIndicator({speed}: {speed: DialerCampaign['speed']}) {
	const label = CAMPAIGN_SPEED_LABELS[speed];

	return (
		<span
			className="inline-flex shrink-0 items-center gap-1"
			aria-label={`Speed: ${label}`}
		>
			<span className="inline-flex items-center" aria-hidden="true">
				{Array.from({length: 4}, (_, index) => (
					<Zap
						key={index}
						className={cn(
							'size-3.5',
							index < speed
								? 'fill-primary text-primary'
								: 'fill-muted-foreground/20 text-muted-foreground/20'
						)}
						strokeWidth={2.4}
					/>
				))}
			</span>
			<span className="font-medium text-foreground/75">{label}</span>
		</span>
	);
}

function CampaignMenu({
	campaigns,
	busy,
	onCall,
	onToggleCampaign,
	onPreviewScript
}: {
	campaigns: DialerCampaign[];
	busy: 'status' | string | null;
	onCall: boolean;
	onToggleCampaign: (campaignId: string, ready: boolean) => void;
	onPreviewScript: (campaign: DialerCampaign) => void;
}) {
	const readyCount = campaigns.filter((c) => c.ready).length;
	// Controlled so opening a script preview closes the menu first.
	const [open, setOpen] = useState(false);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					className="w-full justify-between"
					data-credit-animation-target="campaigns"
				>
					<ListChecks className="size-4" />
					<span className="mr-auto">Campaigns</span>
					{readyCount > 0 && (
						<Badge variant="secondary" className="ml-1 px-1.5">
							{readyCount}
						</Badge>
					)}
					<ChevronDown className="size-4 opacity-60" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-96 p-3">
				<div className="space-y-1 px-1 pb-2">
					<p className="text-sm font-medium">Campaigns</p>
					<p className="text-xs leading-5 text-muted-foreground">
						Choose which campaigns to answer calls for.
					</p>
				</div>
				<Separator className="my-2" />
				{campaigns.length === 0 ? (
					<p className="px-1 py-3 text-sm leading-6 text-muted-foreground">
						No campaigns are linked to you yet.
					</p>
				) : (
					<div className="space-y-1.5">
						{campaigns.map((campaign) => (
							<div
								key={campaign.id}
								className="flex items-start justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-muted/60"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">
										{campaign.name}
									</p>
									{campaign.description && (
										<p className="mt-1 text-xs leading-4 text-muted-foreground">
											{campaign.description}
										</p>
									)}
									<div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
										<CampaignSpeedIndicator speed={campaign.speed} />
										<span aria-hidden="true">·</span>
										<span className="tabular-nums text-foreground/75">
											{formatCampaignRemainingCalls(campaign)}
										</span>
									</div>
								</div>
								{showsScriptDoc(campaign.name) && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="-my-1 size-7 shrink-0 text-muted-foreground"
												aria-label={`Preview script for ${campaign.name}`}
												onClick={() => {
													setOpen(false);
													onPreviewScript(campaign);
												}}
											>
												<ScrollText className="size-4" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="left">Preview script</TooltipContent>
									</Tooltip>
								)}
								{busy === campaign.id ? (
									<Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
								) : (
									<Switch
										className="mt-0.5"
										checked={campaign.ready}
										disabled={busy !== null || onCall}
										onCheckedChange={(ready) =>
											onToggleCampaign(campaign.id, ready)
										}
										aria-label={`${campaign.name} ready`}
									/>
								)}
							</div>
						))}
					</div>
				)}
				{onCall && (
					<p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
						Campaigns are locked while a call is active.
					</p>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function formatCampaignRemainingCalls(campaign: DialerCampaign): string {
	const allowance = resolveCampaignAllowance(campaign);
	if (allowance.state === 'loading') return 'Loading calls remaining…';
	if (allowance.state === 'available') {
		const count = formatAllowanceCount(allowance.remaining, allowance.dailyCap);
		return `${count} call${allowance.remaining === 1 && allowance.dailyCap === null ? '' : 's'} remaining`;
	}

	const status = campaign.calls_remaining_status;
	if (status === 'buyer_id_not_configured') {
		return 'Buyer ID not configured';
	}
	if (status === 'hard_cap_not_configured') return 'No call limit configured';
	if (status === 'retreaver_not_configured') return 'Retreaver not configured';
	if (status === 'invalid_hard_cap') return 'Invalid call limit';
	return 'Calls remaining unavailable';
}

function IdleCallPanel({available}: {available: 0 | 1 | null}) {
	const routable = available === 1;

	return (
		<Card
			className={cn(
				'relative overflow-hidden shadow-xs',
				routable &&
					'border-primary/15 bg-gradient-to-br from-primary/[0.07] via-card to-violet-500/[0.06]'
			)}
		>
			{routable && (
				<div
					aria-hidden="true"
					className="absolute -right-16 -top-24 size-56 rounded-full bg-primary/10 blur-3xl"
				/>
			)}
			<CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative flex min-w-0 items-center gap-4">
					{routable ? <CallSearchAnimation /> : <IdleCallIcon />}
					<div className="min-w-0">
						<p className="font-medium">
							{routable ? 'Ready For Calls' : 'Not Ready'}
						</p>
						<p className="mt-1 text-sm leading-6 text-muted-foreground">
							{routable
								? 'Searching for a call. Incoming calls will answer automatically.'
								: 'Click Go Ready on the right-side panel to recieve a call.'}
						</p>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function IdleCallIcon() {
	return (
		<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
			<Headphones className="size-5" />
		</div>
	);
}

function CallSearchAnimation() {
	return (
		<div
			aria-hidden="true"
			className="relative flex size-16 shrink-0 items-center justify-center"
		>
			<div className="absolute inset-0 rounded-full border border-primary/15" />
			<div className="absolute inset-2 rounded-full border border-primary/20 motion-reduce:animate-none animate-[ping_2.8s_cubic-bezier(0,0,0.2,1)_infinite]" />
			<div className="absolute inset-5 rounded-full border border-primary/30 motion-reduce:animate-none animate-[ping_2.8s_cubic-bezier(0,0,0.2,1)_infinite] [animation-delay:900ms]" />
			<div className="absolute inset-0 motion-reduce:animate-none animate-[spin_7s_linear_infinite]">
				<span className="absolute left-1/2 -top-1 size-2 -translate-x-1/2 rounded-full bg-sky-400 ring-4 ring-card shadow-[0_0_10px_rgba(56,189,248,0.85)]" />
			</div>
			<div className="absolute inset-0 motion-reduce:animate-none animate-[spin_7s_linear_infinite_reverse]">
				<span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-indigo-400 ring-4 ring-card shadow-[0_0_10px_rgba(129,140,248,0.8)]" />
			</div>
			<div className="absolute inset-0 motion-reduce:animate-none animate-[spin_5s_linear_infinite]">
				<span className="absolute -right-1 top-1/2 size-2 -translate-y-1/2 rounded-full bg-violet-400 ring-4 ring-card shadow-[0_0_10px_rgba(167,139,250,0.8)]" />
			</div>
			<div className="absolute inset-0 motion-reduce:animate-none animate-[spin_5s_linear_infinite_reverse]">
				<span className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rounded-full bg-purple-400 ring-4 ring-card shadow-[0_0_10px_rgba(192,132,252,0.8)]" />
			</div>
			<div className="relative flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-primary via-indigo-500 to-violet-500 text-primary-foreground shadow-[0_0_30px_rgba(99,102,241,0.4)]">
				<Radar className="size-5" />
			</div>
		</div>
	);
}

/**
 * Outbound dialpad — the agent types a US/CA number and places a call. The backend
 * originates it (presenting the agent's own DID) and bridges the answered customer
 * back to this browser as an incoming leg. Rendered in the idle state only; `canDial`
 * folds in the on-call / device-registered / valid-number gates. Activity and CRM
 * click-to-dial use the same shared device action.
 */
function Dialpad({
	value,
	onChange,
	onDial,
	canDial,
	pending,
	addingToCall,
	deviceRegistered
}: {
	value: string;
	onChange: (v: string) => void;
	onDial: () => void;
	canDial: boolean;
	pending: boolean;
	addingToCall: boolean;
	deviceRegistered: boolean;
}) {
	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
	const preview = normalizeDialInput(value);

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2">
				<Input
					value={value}
					inputMode="tel"
					placeholder="(555) 123-4567"
					className="h-12 font-mono text-lg"
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && canDial) onDial();
					}}
				/>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Delete last digit"
					disabled={!value}
					onClick={() => onChange(value.slice(0, -1))}
				>
					<Delete className="size-4" />
				</Button>
			</div>

			<div className="grid grid-cols-3 gap-2.5">
				{keys.map((k) => (
					<Button
						key={k}
						variant="outline"
						className="h-14 text-xl font-medium"
						onClick={() => onChange(value + k)}
					>
						{k}
					</Button>
				))}
			</div>

			<Button
				variant="success"
				className="h-12 w-full text-base"
				disabled={!canDial}
				onClick={onDial}
			>
				{pending ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<PhoneCall className="size-4" />
				)}
				{pending ? 'Calling…' : addingToCall ? 'Hold & call' : 'Call'}
			</Button>

			{addingToCall && (
				<p className="text-center text-xs text-muted-foreground">
					Call another person privately, then merge when you're ready. Your
					current caller will hear hold music.
				</p>
			)}
			{!deviceRegistered ? (
				<p className="text-center text-xs text-muted-foreground">
					Softphone connecting… you can place a call once it's ready.
				</p>
			) : value && !preview ? (
				<p className="text-center text-xs text-muted-foreground">
					Enter a valid US or Canada number.
				</p>
			) : null}
		</div>
	);
}

function StatusPreview({
	available,
	connected,
	status,
	deviceStatus,
	networkChecking,
	armedCount,
	campaignCount,
	anyArmed,
	onCall,
	presence,
	provisioned,
	readyStatePending
}: {
	available: 0 | 1 | null;
	connected: boolean;
	status: PresenceStatus;
	deviceStatus: string;
	networkChecking: boolean;
	armedCount: number;
	campaignCount: number;
	anyArmed: boolean;
	onCall: boolean;
	presence: DialerPresence | null;
	provisioned: boolean;
	readyStatePending: boolean;
}) {
	const deviceRegistered = deviceStatus === 'registered';
	const isAvailable = available === 1;
	const availabilityHelper = !provisioned
		? 'Provisioning is required before calls can be routed.'
		: isAvailable
			? 'Currently available for calls.'
			: reasonNotAvailable(presence, anyArmed, connected, deviceStatus, onCall);

	return (
		<div className="space-y-4">
			<StatusRow
				icon={onCall ? PhoneCall : isAvailable ? CircleCheck : CircleAlert}
				label="Availability"
				value={onCall ? 'On Call' : isAvailable ? 'Available' : 'Unavailable'}
				helper={availabilityHelper}
				tone={onCall ? 'warning' : isAvailable ? 'success' : 'destructive'}
			/>
			<StatusRow
				icon={onCall ? PhoneCall : readyStatePending ? Loader2 : Power}
				label="Ready State"
				value={onCall ? 'On Call' : status === 'ready' ? 'Ready' : 'Paused'}
				helper={
					onCall
						? 'Currently on a call.'
						: status === 'ready'
							? 'You are marked ready to accept calls.'
							: 'Click Go Ready when you are ready for calls.'
				}
				tone={
					onCall ? 'warning' : status === 'ready' ? 'success' : 'destructive'
				}
				pending={!onCall && readyStatePending}
			/>
			{/*
			 * ENG-159 Subplan 07. While the wizard runs, the softphone is
			 * deliberately not built yet, so this row would otherwise read
			 * "Not registered" in red for a second or two of every boot —
			 * alarming, and about a state that is entirely normal.
			 *
			 * ⚠️ THE ONE STRING THIS FEATURE OWNS. It names no carrier, no
			 * "Primary"/"Fallback", and never says a switch happened: the agent has
			 * no action to take on any of it, so the only thing surfacing it could
			 * produce is a support ticket about a system that is working correctly.
			 */}
			<StatusRow
				icon={networkChecking ? Loader2 : deviceRegistered ? Wifi : WifiOff}
				label="Phone Registration"
				value={
					networkChecking
						? 'Checking'
						: deviceRegistered
							? 'Registered'
							: deviceStatus
				}
				helper={
					networkChecking
						? 'Finding the best connection…'
						: deviceRegistered
							? 'Device registered with the phone network.'
							: 'Not registered with the phone network.'
				}
				tone={
					networkChecking
						? 'warning'
						: deviceRegistered
							? 'success'
							: 'destructive'
				}
				pending={networkChecking}
			/>
			<StatusRow
				icon={RadioTower}
				label="Call Network"
				value={connected ? 'Connected' : 'Reconnecting'}
				helper={
					connected
						? 'Device connected to the call network.'
						: 'Device not connected to the call network.'
				}
				tone={connected ? 'success' : 'destructive'}
			/>
			<StatusRow
				icon={ListChecks}
				label="Campaign Routing"
				value={`${armedCount} of ${campaignCount}`}
				helper={
					armedCount > 0
						? `Active on ${armedCount} campaign${armedCount === 1 ? '' : 's'}.`
						: 'Turn on at least one campaign to take calls.'
				}
				tone={armedCount > 0 ? 'success' : 'destructive'}
			/>
		</div>
	);
}

function StatusRow({
	icon: Icon,
	label,
	value,
	helper,
	tone,
	pending = false
}: {
	icon: typeof CircleCheck;
	label: string;
	value: string;
	helper: string;
	tone: 'success' | 'destructive' | 'warning';
	pending?: boolean;
}) {
	const toneClass = {
		success: {
			icon: 'bg-success/10 text-success',
			badge: cn(
				'border-success/30 bg-success/5 text-success',
				pending && 'ring-2 ring-success/15'
			)
		},
		destructive: {
			icon: 'bg-destructive/10 text-destructive',
			badge: cn(
				'border-destructive/30 bg-destructive/5 text-destructive',
				pending && 'ring-2 ring-destructive/15'
			)
		},
		warning: {
			icon: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
			badge: cn(
				'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
				pending && 'ring-2 ring-amber-300/25'
			)
		}
	}[tone];

	return (
		<div className={cn('flex gap-3', pending && 'animate-pulse')}>
			<div
				className={cn(
					'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
					toneClass.icon
				)}
			>
				<Icon className={cn('size-4', pending && 'animate-spin')} />
			</div>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex items-center justify-between gap-3">
					<p className="text-sm font-medium">{label}</p>
					<Badge variant="outline" className={toneClass.badge}>
						{value}
					</Badge>
				</div>
				<p className="text-xs leading-5 text-muted-foreground">{helper}</p>
			</div>
		</div>
	);
}

function AvailabilityBadge({
	available,
	connected,
	onCall,
	pending = false
}: {
	available: 0 | 1 | null;
	connected: boolean;
	onCall: boolean;
	pending?: boolean;
}) {
	if (onCall) {
		return (
			<Badge
				variant="outline"
				className={cn(
					'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
					pending && 'ring-2 ring-amber-300/25'
				)}
			>
				{pending && <Loader2 className="animate-spin" />}
				On Call
			</Badge>
		);
	}

	if (!connected || available === null) {
		return (
			<Badge
				variant={connected ? 'secondary' : 'outline'}
				className={
					connected
						? undefined
						: 'border-destructive/30 bg-destructive/5 text-destructive'
				}
			>
				{pending && <Loader2 className="animate-spin" />}
				Connecting…
			</Badge>
		);
	}
	return available === 1 ? (
		<Badge
			className={cn(
				'bg-success text-success-foreground',
				pending && 'ring-2 ring-success/20'
			)}
		>
			{pending && <Loader2 className="animate-spin" />}
			Available
		</Badge>
	) : (
		<Badge
			variant="destructive"
			className={cn(pending && 'ring-2 ring-destructive/20')}
		>
			{pending && <Loader2 className="animate-spin" />}
			Unavailable
		</Badge>
	);
}

function reasonNotAvailable(
	presence: DialerPresence | null,
	anyArmed: boolean,
	connected: boolean,
	deviceStatus: string,
	onCall: boolean
): string {
	if (!connected) return 'Reconnecting to the call network';
	if (onCall || presence?.on_call) return 'Currently on a call';
	if (!anyArmed) return 'No campaign enabled';
	if (deviceStatus !== 'registered')
		return 'Your device isn’t connected to the call network';
	return 'Waiting on a ping from the call network';
}

function readError(err: any, fallback: string): string {
	return err?.response?.data?.statusMessage || err?.message || fallback;
}
