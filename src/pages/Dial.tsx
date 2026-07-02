import {useEffect, useState} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {
	fetchDialerProfile,
	getPresence,
	listCampaigns,
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
 * Dial page (Subplan 02 + 03) — presence, heartbeat, campaign selection, and the
 * Twilio softphone (device registration, auto-answer, active-call UI).
 *
 * The agent picks a campaign, then toggles Ready. While Ready + a fresh heartbeat
 * + a selected campaign + a registered Twilio device all hold, the backend reports
 * `available: 1` and Retreaver may route an inbound call to this buyer. The device
 * registers via useDevice and its status flows into the heartbeat, so availability
 * reflects the real softphone state.
 *
 * On an inbound call the Device auto-answers (Retreaver already chose this ready
 * agent); the active-call banner shows caller/timer/mute/hangup, and the campaign
 * switch + ready toggle are disabled while on the call.
 */
export default function Dial() {
	const [profile, setProfile] = useState<any>(null);
	const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
	const [presence, setPresenceState] = useState<DialerPresence | null>(null);
	const [busy, setBusy] = useState<'status' | 'campaign' | null>(null);
	const [error, setError] = useState<string | null>(null);

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
	const selectedCampaignId = presence?.selected_campaign_id ?? '';
	// Prefer the live heartbeat value; fall back to the bootstrap presence read.
	const available =
		heartbeat.available ??
		(status === 'ready' && presence?.selected_campaign_id ? null : 0);

	const applyPresence = async (
		input: {status?: PresenceStatus; campaign_id?: string | null},
		which: 'status' | 'campaign'
	) => {
		setBusy(which);
		setError(null);
		try {
			const res = await setPresence(input);
			if (res.statusCode !== 'SP100') {
				throw new Error(res.statusMessage || 'Could not update presence');
			}
			setPresenceState(res.presence ?? null);
		} catch (err) {
			setError(readError(err, 'Could not update presence'));
		} finally {
			setBusy(null);
		}
	};

	const onToggleReady = () => {
		const next: PresenceStatus = status === 'ready' ? 'paused' : 'ready';
		// Pre-arm audio on the way to Ready. The dialer auto-answers, so this
		// click is our one chance to satisfy the browser's autoplay policy:
		// armAudio() grants the mic and resumes the SDK's AudioContext so the
		// auto-answered call can play/capture audio. Fire it synchronously from
		// the gesture (before any await) — it self-reports mic errors via
		// device.error, so we don't block going Ready on it.
		if (next === 'ready') {
			void device.armAudio();
		}
		void applyPresence({status: next}, 'status');
	};

	const onSelectCampaign = (campaignId: string) => {
		void applyPresence({campaign_id: campaignId || null}, 'campaign');
	};

	// On a call if the live Device says so, or the backend flag is set (covers the
	// brief window before the device 'accept' event lands).
	const onCall = Boolean(device.activeCall) || Boolean(presence?.on_call);
	const canGoReady = !!selectedCampaignId; // must pick a campaign first
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

			{/* Lead capture — shown while on a call with a campaign selected. Keyed by
			    CallSid so each new call starts a fresh, blank form for that caller. */}
			{device.activeCall && selectedCampaignId && (
				<LeadForm
					key={device.activeCall.callSid}
					campaignId={selectedCampaignId}
					callSid={device.activeCall.callSid || null}
					callerPhone={device.activeCall.from}
				/>
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
							Your dialer agent is not provisioned yet (an admin must set your SIP
							username and Retreaver buyer id). You can’t go ready until then.
						</p>
					)}

					{profile && provisioned && (
						<>
							{/* Campaign selection — required before going ready. */}
							<div className="space-y-1">
								<label className="text-muted-foreground" htmlFor="campaign">
									Campaign
								</label>
								<select
									id="campaign"
									value={selectedCampaignId}
									disabled={busy !== null || onCall}
									onChange={(e) => onSelectCampaign(e.target.value)}
									className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
								>
									<option value="">Select a campaign…</option>
									{campaigns.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name}
										</option>
									))}
								</select>
								{campaigns.length === 0 && (
									<p className="text-xs text-muted-foreground">
										No active campaigns configured for your org yet.
									</p>
								)}
							</div>

							{/* Ready / Paused toggle. */}
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
	connected: boolean,
	deviceStatus: string,
	onCall: boolean
): string {
	if (!connected) return 'reconnecting to the server';
	if (onCall || presence?.on_call) return 'you’re on a call';
	if (!presence?.selected_campaign_id) return 'no campaign selected';
	if (deviceStatus !== 'registered')
		return 'your softphone device isn’t connected yet';
	return 'waiting on a fresh heartbeat';
}

function readError(err: any, fallback: string): string {
	return (
		err?.response?.data?.statusMessage || err?.message || fallback
	);
}
