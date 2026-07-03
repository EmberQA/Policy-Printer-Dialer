import {useEffect, useMemo, useState} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {
	fetchDialerProfile,
	getPresence,
	listCampaigns,
	setCampaignReady,
	setPresence,
	type DialerCampaign,
	type DialerPresence,
	type PresenceStatus
} from '@/lib/api';
import {useHeartbeat} from '@/presence/useHeartbeat';
import {useDevice} from '@/twilio/useDevice';
import {ActiveCallBanner} from '@/twilio/ActiveCallBanner';
import {LeadForm} from '@/leads/LeadForm';

/**
 * Dial page (Subplan 02 + 03) — presence, heartbeat, per-campaign ready toggles, and
 * the Twilio softphone (device registration, auto-answer, active-call UI).
 *
 * The agent ARMS one or more campaigns (a Ready switch per campaign — CTV and/or
 * Social), then flips the global Ready master switch. While Ready + at least one armed
 * campaign + a fresh heartbeat + a registered Twilio device all hold, the backend
 * reports `available: 1` and Retreaver may route an inbound call from any armed buyer.
 * Each armed buyer's availability ping also RESERVES the agent briefly so a second
 * buyer's call in the window is skipped (call-reservation window).
 *
 * On an inbound call the Device auto-answers (Retreaver already chose this ready agent);
 * the active-call banner shows caller/timer/mute/hangup, and the toggles are disabled
 * while on the call. The lead form uses the call's campaign (auto when a single campaign
 * is armed, otherwise the agent picks it).
 */
export default function Dial() {
	const [profile, setProfile] = useState<any>(null);
	const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
	const [presence, setPresenceState] = useState<DialerPresence | null>(null);
	const [busy, setBusy] = useState<'status' | string | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Which campaign the active call's lead form is for. Defaults to the sole armed
	// campaign; when several are armed the agent picks (the call can be from any buyer).
	const [leadCampaignId, setLeadCampaignId] = useState<string>('');

	const provisioned = Boolean(profile?.provisioned);

	// The Twilio Device registers once the agent is provisioned; its status feeds
	// the heartbeat so the backend only advertises availability when the softphone
	// can actually receive a call. The active call (if any) drives the banner.
	const device = useDevice({enabled: provisioned});

	// Heartbeat runs once we know the agent is provisioned (a usable session
	// exists by then — handoff already ran). It reports the live device status and
	// echoes back the recomputed availability.
	const heartbeat = useHeartbeat({
		enabled: provisioned,
		deviceStatus: device.deviceStatus
	});

	useEffect(() => {
		let cancelled = false;
		Promise.all([fetchDialerProfile(), listCampaigns(), getPresence()])
			.then(([prof, camps, pres]: any[]) => {
				if (cancelled) return;
				setProfile(prof);
				setCampaigns(camps?.campaigns ?? []);
				setPresenceState(pres?.presence ?? null);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(readError(err, 'Failed to load dialer'));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Keep the local presence row in sync with what the heartbeat observes (e.g.
	// on_call flipping, or another tab changing status).
	useEffect(() => {
		if (heartbeat.presence) setPresenceState(heartbeat.presence);
	}, [heartbeat.presence]);

	const status: PresenceStatus = presence?.status ?? 'paused';
	const armedCampaigns = useMemo(
		() => campaigns.filter((c) => c.ready),
		[campaigns]
	);
	const anyArmed = armedCampaigns.length > 0;

	// Pick the campaign the active call's lead form is for, in priority order:
	//   1. reserved_campaign_id — AUTHORITATIVE: the campaign whose buyer won the ping
	//      that routed this call, even with several campaigns armed (no picker needed).
	//   2. the sole armed campaign (single-campaign agents — the common case).
	//   3. otherwise leave the agent's manual pick if still armed, else blank (they pick).
	const reservedCampaignId = presence?.reserved_campaign_id ?? null;
	useEffect(() => {
		if (reservedCampaignId && campaigns.some((c) => c.id === reservedCampaignId)) {
			setLeadCampaignId(reservedCampaignId);
		} else if (armedCampaigns.length === 1) {
			setLeadCampaignId(armedCampaigns[0].id);
		} else if (
			leadCampaignId &&
			!armedCampaigns.some((c) => c.id === leadCampaignId)
		) {
			setLeadCampaignId('');
		}
	}, [reservedCampaignId, campaigns, armedCampaigns, leadCampaignId]);

	// Prefer the live heartbeat value; fall back to the bootstrap presence read.
	const available =
		heartbeat.available ?? (status === 'ready' && anyArmed ? null : 0);

	const onToggleReady = () => {
		const next: PresenceStatus = status === 'ready' ? 'paused' : 'ready';
		// Pre-arm audio on the way to Ready. The dialer auto-answers, so this click is
		// our one chance to satisfy the browser's autoplay policy: armAudio() grants the
		// mic and resumes the SDK's AudioContext. Fire it synchronously from the gesture
		// (before any await); it self-reports mic errors via device.error.
		if (next === 'ready') {
			void device.armAudio();
		}
		setBusy('status');
		setError(null);
		setPresence({status: next})
			.then((res) => {
				if (res.statusCode !== 'SP100') {
					throw new Error(res.statusMessage || 'Could not update presence');
				}
				setPresenceState(res.presence ?? null);
			})
			.catch((err) => setError(readError(err, 'Could not update presence')))
			.finally(() => setBusy(null));
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

	// On a call if the live Device says so, or the backend flag is set (covers the
	// brief window before the device 'accept' event lands).
	const onCall = Boolean(device.activeCall) || Boolean(presence?.on_call);
	const canGoReady = anyArmed; // must arm ≥1 campaign first
	const deviceError = device.error;

	return (
		<div className="mx-auto max-w-xl space-y-4">
			{device.activeCall && (
				<ActiveCallBanner
					call={device.activeCall}
					onMute={device.mute}
					onHangup={device.hangup}
				/>
			)}

			{/* Lead capture — shown while on a call once a campaign is chosen for it.
			    Keyed by CallSid so each new call starts a fresh, blank form. */}
			{device.activeCall && leadCampaignId && (
				<LeadForm
					key={device.activeCall.callSid}
					campaignId={leadCampaignId}
					callSid={device.activeCall.callSid || null}
					callerPhone={device.activeCall.from}
				/>
			)}
			{device.activeCall && !leadCampaignId && (
				<Card>
					<CardHeader>
						<CardTitle>Which campaign is this call for?</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2 text-sm">
						<p className="text-muted-foreground">
							Pick the campaign to log this lead under.
						</p>
						<select
							value={leadCampaignId}
							onChange={(e) => setLeadCampaignId(e.target.value)}
							className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<option value="">Select a campaign…</option>
							{(armedCampaigns.length ? armedCampaigns : campaigns).map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between">
						<span>Softphone</span>
						<AvailabilityBadge
							available={available}
							connected={heartbeat.connected}
						/>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4 text-sm">
					{error && <p className="text-destructive">{error}</p>}
					{deviceError && (
						<p className="text-destructive">Softphone: {deviceError}</p>
					)}

					{!error && !profile && (
						<p className="text-muted-foreground">Loading…</p>
					)}

					{profile && !provisioned && (
						<p className="text-muted-foreground">
							Your dialer agent is not provisioned yet (an admin must set your
							phone number and Retreaver buyer id). You can’t go ready until then.
						</p>
					)}

					{profile && provisioned && (
						<>
							{/* Per-campaign ready toggles — arm the buyers you'll answer. */}
							<div className="space-y-2">
								<span className="text-muted-foreground">Campaigns</span>
								{campaigns.length === 0 && (
									<p className="text-xs text-muted-foreground">
										No campaigns linked to you yet. An admin links you to a
										campaign’s Retreaver buyer before you can go ready.
									</p>
								)}
								<ul className="space-y-1">
									{campaigns.map((c) => (
										<li
											key={c.id}
											className="flex items-center justify-between rounded-md border border-border px-3 py-2"
										>
											<span className="font-medium">{c.name}</span>
											<Button
												variant={c.ready ? 'success' : 'default'}
												onClick={() => onToggleCampaign(c.id, !c.ready)}
												disabled={busy !== null || onCall}
											>
												{busy === c.id
													? 'Saving…'
													: c.ready
														? 'Ready'
														: 'Off'}
											</Button>
										</li>
									))}
								</ul>
							</div>

							{/* Global Ready / Paused master switch (over all armed campaigns). */}
							<div className="flex items-center gap-3">
								<Button
									variant={status === 'ready' ? 'success' : 'default'}
									onClick={onToggleReady}
									disabled={
										busy !== null || onCall || (status !== 'ready' && !canGoReady)
									}
								>
									{busy === 'status'
										? 'Saving…'
										: status === 'ready'
											? 'Go on break'
											: 'Go ready'}
								</Button>
								<span className="text-muted-foreground">
									Status: <span className="font-medium">{status}</span>
									{onCall && ' · on a call'}
								</span>
							</div>

							{status === 'ready' && available === 0 && (
								<p className="text-xs text-muted-foreground">
									You’re marked ready but not currently routable —{' '}
									{reasonNotAvailable(
										presence,
										anyArmed,
										heartbeat.connected,
										device.deviceStatus,
										Boolean(device.activeCall)
									)}
									.
								</p>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function AvailabilityBadge({
	available,
	connected
}: {
	available: 0 | 1 | null;
	connected: boolean;
}) {
	if (!connected || available === null) {
		return (
			<span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
				connecting…
			</span>
		);
	}
	return available === 1 ? (
		<span className="rounded-full bg-success px-2 py-0.5 text-xs text-success-foreground">
			available
		</span>
	) : (
		<span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
			unavailable
		</span>
	);
}

function reasonNotAvailable(
	presence: DialerPresence | null,
	anyArmed: boolean,
	connected: boolean,
	deviceStatus: string,
	onCall: boolean
): string {
	if (!connected) return 'reconnecting to the server';
	if (onCall || presence?.on_call) return 'you’re on a call';
	if (!anyArmed) return 'no campaign toggled ready';
	if (deviceStatus !== 'registered')
		return 'your softphone device isn’t connected yet';
	return 'waiting on a fresh heartbeat';
}

function readError(err: any, fallback: string): string {
	return err?.response?.data?.statusMessage || err?.message || fallback;
}
