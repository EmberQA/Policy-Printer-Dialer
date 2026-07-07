import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Delete,
  Headphones,
  ListChecks,
  Loader2,
  PhoneCall,
  PhoneOutgoing,
  Power,
  RadioTower,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  setCampaignReady,
  setOnCall,
  setPresence,
  startOutboundCall,
  type DialerCampaign,
  type DialerPresence,
  type PresenceStatus,
} from "@/lib/api";
import { Input } from "@/components/ui/input";
import { useDialerSession } from "@/session/DialerSessionProvider";
import { type ActiveCall } from "@/twilio/useDevice";
import { ActiveCallBanner } from "@/twilio/ActiveCallBanner";
import { AudioSetupDialog } from "@/twilio/AudioSetupDialog";
import { LeadForm } from "@/leads/LeadForm";
import { ReturningCallerCard } from "@/leads/ReturningCallerCard";
import { useReturningCaller } from "@/leads/useReturningCaller";
import { cn } from "@/lib/utils";
import { normalizeDialInput } from "@/lib/phone";

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
  // Shared session: the single Device + heartbeat + bootstrap (profile/campaigns/
  // presence) live in the provider so they survive tab switches. Destructure using
  // the SAME local names this component already used, so the rest of the body is
  // unchanged.
  const session = useDialerSession();
  const { device, heartbeat, profile, provisioned, campaigns } = session;
  const presence = session.presence;
  const setCampaigns = session.setCampaigns;
  const setPresenceState = session.setPresence;

  const [busy, setBusy] = useState<"status" | string | null>(null);
  const [pendingReadyStatus, setPendingReadyStatus] =
    useState<PresenceStatus | null>(null);
  const [readyRequestSettled, setReadyRequestSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugIncomingCall, setDebugIncomingCall] = useState(false);
  const [debugCallMuted, setDebugCallMuted] = useState(false);
  const [debugCallStartedAt, setDebugCallStartedAt] = useState<number | null>(
    null,
  );
  // Which campaign the active call's lead form is for. Defaults to the sole armed
  // campaign; when several are armed the agent picks (the call can be from any buyer).
  const [leadCampaignId, setLeadCampaignId] = useState<string>("");
  const [wrapUpCall, setWrapUpCall] = useState<ActiveCall | null>(null);
  const [completedWrapUpCallKey, setCompletedWrapUpCallKey] = useState<
    string | null
  >(null);
  const [confirmedAvailable, setConfirmedAvailable] = useState<0 | 1 | null>(
    null,
  );
  // Returning-caller pane dismissal, keyed to the call it was dismissed on. A new
  // call has a different callKey, so the pane re-shows automatically (reset per call).
  const [dismissedCallerKey, setDismissedCallerKey] = useState<string | null>(
    null,
  );
  const [wrapUpReleasePending, setWrapUpReleasePending] = useState(false);
  // Outbound dialpad: the digits the agent has typed + an in-flight guard so the
  // Call button can't double-fire while startOutboundCall is resolving.
  const [dialInput, setDialInput] = useState("");
  const [dialPending, setDialPending] = useState(false);

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
      setBusy((current) => (current === "status" ? null : current));
    }
  }, [heartbeat.presence?.status, pendingReadyStatus, readyRequestSettled]);

  useEffect(() => {
    if (heartbeat.available !== null) {
      setConfirmedAvailable(heartbeat.available);
    }
  }, [heartbeat.available]);

  const status: PresenceStatus = presence?.status ?? "paused";
  const armedCampaigns = useMemo(
    () => campaigns.filter((c) => c.ready),
    [campaigns],
  );
  const anyArmed = armedCampaigns.length > 0;

  // Pick the campaign the active call's lead form is for, in priority order:
  //   1. reserved_campaign_id — AUTHORITATIVE: the campaign whose buyer won the ping
  //      that routed this call, even with several campaigns armed (no picker needed).
  //   2. the sole armed campaign (single-campaign agents — the common case).
  //   3. otherwise leave the agent's manual pick if still armed, else blank (they pick).
  const reservedCampaignId = presence?.reserved_campaign_id ?? null;
  useEffect(() => {
    if (
      reservedCampaignId &&
      campaigns.some((c) => c.id === reservedCampaignId)
    ) {
      setLeadCampaignId(reservedCampaignId);
    } else if (armedCampaigns.length === 1) {
      setLeadCampaignId(armedCampaigns[0].id);
    } else if (
      leadCampaignId &&
      !armedCampaigns.some((c) => c.id === leadCampaignId)
    ) {
      setLeadCampaignId("");
    }
  }, [reservedCampaignId, campaigns, armedCampaigns, leadCampaignId]);

  // Prefer the newest backend-computed availability: heartbeat responses and
  // presence mutation responses both return the same computeReady result.
  const available =
    confirmedAvailable ?? (status === "ready" && anyArmed ? null : 0);

  const onToggleReady = () => {
    const next: PresenceStatus = status === "ready" ? "paused" : "ready";
    // Pre-arm audio on the way to Ready. The dialer auto-answers, so this click is
    // our one chance to satisfy the browser's autoplay policy: armAudio() grants the
    // mic and resumes the SDK's AudioContext. Fire it synchronously from the gesture
    // (before any await); it self-reports mic errors via device.error.
    if (next === "ready") {
      void device.armAudio();
    }
    setPendingReadyStatus(next);
    setReadyRequestSettled(false);
    setBusy("status");
    setError(null);
    setPresence({ status: next })
      .then((res) => {
        if (res.statusCode !== "SP100") {
          throw new Error(res.statusMessage || "Could not update presence");
        }
        if (res.presence) setPresenceState(res.presence);
        if (res.available !== undefined) setConfirmedAvailable(res.available);
        setReadyRequestSettled(true);
      })
      .catch((err) => {
        setPendingReadyStatus(null);
        setReadyRequestSettled(false);
        setError(readError(err, "Could not update presence"));
        setBusy(null);
      });
  };

  const onToggleCampaign = (campaignId: string, ready: boolean) => {
    setBusy(campaignId);
    setError(null);
    // Optimistic: reflect the toggle immediately, revert on failure.
    setCampaigns((cur) =>
      cur.map((c) => (c.id === campaignId ? { ...c, ready } : c)),
    );
    setCampaignReady(campaignId, ready)
      .then((res) => {
        if (res.statusCode !== "SP100") {
          throw new Error(res.statusMessage || "Could not update campaign");
        }
        if (res.presence) setPresenceState(res.presence);
        if (res.available !== undefined) setConfirmedAvailable(res.available);
      })
      .catch((err) => {
        setError(readError(err, "Could not update campaign"));
        // Revert the optimistic flip.
        setCampaigns((cur) =>
          cur.map((c) => (c.id === campaignId ? { ...c, ready: !ready } : c)),
        );
      })
      .finally(() => setBusy(null));
  };

  const onToggleDebugIncomingCall = () => {
    setDebugIncomingCall((current) => {
      if (current) {
        setDebugCallStartedAt(null);
        setDebugCallMuted(false);
        return false;
      }
      setDebugCallStartedAt(Date.now());
      setDebugCallMuted(false);
      return true;
    });
  };

  // On a call if the live Device says so, the backend flag is set, or a disconnected
  // call still needs disposition/lead wrap-up before this agent can receive another.
  const liveOnCall = Boolean(device.activeCall) || Boolean(presence?.on_call);
  const debugCallActive = debugIncomingCall && !device.activeCall;
  const debugCall: ActiveCall | null = debugCallActive
    ? {
        from: "+15555550100",
        callSid: "debug-incoming-call",
        muted: debugCallMuted,
        startedAt: debugCallStartedAt ?? Date.now(),
        direction: "inbound",
      }
    : null;
  const activeCall = device.activeCall ?? debugCall;
  const workCall = activeCall ?? wrapUpCall;
  const wrapUpCallKey = workCall ? callKey(workCall) : null;

  // Direct-dial callback pull-up: the backend classifies the call (direct-dial vs
  // Retreaver-routed) and only returns prior history for a direct dial. Fire-and-forget
  // — it never blocks the blank New-Lead form. Keyed to the call's SID so it re-runs
  // per call. `editLead` (below) is the caller's most-recent prior lead, if any.
  const returningCaller = useReturningCaller(
    workCall?.from ?? null,
    workCall?.callSid ?? null,
  );
  const editLead = returningCaller.data?.is_direct_dial
    ? (returningCaller.data.most_recent_lead?.lead ?? null)
    : null;
  const wrapUpCompleted =
    Boolean(wrapUpCallKey) && completedWrapUpCallKey === wrapUpCallKey;
  const returningCallerDismissed =
    Boolean(wrapUpCallKey) && dismissedCallerKey === wrapUpCallKey;
  const onCall = liveOnCall || debugIncomingCall || Boolean(wrapUpCall);
  const displayAvailable = onCall ? 0 : available;
  const canGoReady = anyArmed; // must arm ≥1 campaign first
  const deviceError = device.error;
  // Local `error` is for action failures (presence/campaign/dial/wrap-up); bootstrap
  // (load) failures come from the shared session. Show either in the banner.
  const displayError = error || session.bootError;

  useEffect(() => {
    if (!activeCall) return;
    const nextCallKey = callKey(activeCall);
    if (!wrapUpCall || callKey(wrapUpCall) !== nextCallKey) {
      setCompletedWrapUpCallKey(null);
      setDismissedCallerKey(null);
    }
    setWrapUpCall(activeCall);
  }, [activeCall, wrapUpCall]);

  const releaseCallWrapUp = async () => {
    if (!wrapUpCall) return;
    setWrapUpReleasePending(true);
    setError(null);
    try {
      // Pause first so clearing on_call cannot immediately make the agent routable.
      const pauseRes = await setPresence({ status: "paused" });
      if (pauseRes.statusCode !== "SP100") {
        throw new Error(pauseRes.statusMessage || "Could not pause after call");
      }
      setPresenceState(pauseRes.presence ?? null);
      if (pauseRes.available !== undefined) {
        setConfirmedAvailable(pauseRes.available);
      }
      setPendingReadyStatus(null);
      setReadyRequestSettled(false);
      setBusy((current) => (current === "status" ? null : current));

      const res = await setOnCall(false);
      if (res.statusCode !== "SP100") {
        throw new Error(res.statusMessage || "Could not release call");
      }
      setPresenceState(res.presence ?? null);
      if (res.available !== undefined) setConfirmedAvailable(res.available);
      setWrapUpCall(null);
      setCompletedWrapUpCallKey(null);
    } catch (err) {
      setError(readError(err, "Could not release call"));
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

  // Place an outbound call from the dialpad. The backend originates the call and
  // bridges the answered customer to this browser (it arrives via the same incoming
  // path inbound uses), so we (1) arm audio from this click gesture — the bridged leg
  // auto-answers, so there's no per-call click to satisfy the browser's autoplay
  // policy — then (2) POST the number, then (3) arm the device so it tags that
  // incoming leg as outbound with the dialed number.
  const canDial =
    provisioned &&
    device.deviceStatus === "registered" &&
    !onCall &&
    !dialPending &&
    normalizeDialInput(dialInput) !== null;

  const onDialOut = async () => {
    const to = normalizeDialInput(dialInput);
    if (!to || dialPending) return;
    setDialPending(true);
    setError(null);
    try {
      await device.armAudio();
      const res = await startOutboundCall(to);
      if (res.statusCode !== "SP100") {
        throw new Error(res.statusMessage || "Could not place the call");
      }
      device.armOutbound(to);
      setDialInput("");
    } catch (err) {
      setError(readError(err, "Could not place the call"));
    } finally {
      setDialPending(false);
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
  }, [activeCall, completedWrapUpCallKey, wrapUpCall, wrapUpReleasePending]);

  return (
    <div className="min-h-[calc(100vh-7rem)] w-full">
      <DebugIncomingCallToggle
        active={debugIncomingCall}
        onToggle={onToggleDebugIncomingCall}
      />

      {/* 1-3-1 layout: LEFT (notifications), CENTER (call core / lead form),
          RIGHT (controls + status). Fixed, roomy side columns and a flexible center;
          side-by-side at xl, stacked below (center first). */}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[22rem_minmax(0,1fr)_22rem] xl:items-start">
        {/* LEFT — errors and returning-caller pane. */}
        <div className="order-2 flex flex-col items-stretch gap-4 xl:order-none">
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

          {profile && provisioned && (
            <>
              {/* Returning-caller callback notification + prior-history strip (direct
                  dials only; renders nothing otherwise). On an OUTBOUND call it re-labels
                  to a neutral "Prior history". Dismissable per call via the X. */}
              {workCall && !wrapUpCompleted && !returningCallerDismissed && (
                <ReturningCallerCard
                  result={returningCaller.data}
                  direction={workCall.direction}
                  onDismiss={() => setDismissedCallerKey(wrapUpCallKey)}
                />
              )}
            </>
          )}
        </div>

        {/* CENTER — the interactive call core (banners + lead form). Capped + centered
            in its track so cards aren't stretched edge-to-edge on wide screens. */}
        <div className="order-1 mx-auto flex w-full max-w-2xl flex-col gap-5 xl:order-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
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
                  onMute={device.activeCall ? device.mute : setDebugCallMuted}
                  onHangup={
                    device.activeCall
                      ? device.hangup
                      : onToggleDebugIncomingCall
                  }
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

              {/* Lead capture — held open after hangup until the call is dispositioned.
                  On a direct-dial callback, editLead switches this to update-in-place. */}
              {workCall && leadCampaignId && !wrapUpCompleted && (
                <LeadForm
                  key={`${workCall.callSid || "active-call"}:${editLead?.id ?? "new"}`}
                  campaignId={leadCampaignId}
                  callSid={workCall.callSid || null}
                  callerPhone={workCall.from}
                  onComplete={onWrapUpComplete}
                  showClear={false}
                  editLead={editLead}
                />
              )}
              {workCall && !leadCampaignId && !wrapUpCompleted && (
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
                        ),
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* RIGHT — controls (Go Ready / Campaigns / Audio) + status recap. */}
        <DialSidebar
          status={status}
          busy={busy}
          onCall={onCall}
          provisioned={provisioned}
          canGoReady={canGoReady}
          onToggleReady={onToggleReady}
          campaigns={campaigns}
          onToggleCampaign={onToggleCampaign}
          onInputDeviceChange={device.setInputDevice}
          onOutputDeviceChange={device.setOutputDevice}
          available={displayAvailable}
          connected={heartbeat.connected}
          deviceStatus={device.deviceStatus}
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
          dialPending={dialPending}
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
  onRelease,
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
              {completed ? "Call wrap-up complete" : "Finish call wrap-up"}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {completed
                ? "Releasing availability so another call can route."
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
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "destructive" : "outline"}
      size="sm"
      onClick={onToggle}
      aria-pressed={active}
      className="fixed left-2 top-2 z-50 h-7 px-2 text-[11px] opacity-25 hover:opacity-100"
    >
      {active ? "End call" : "Debug call"}
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
  onInputDeviceChange,
  onOutputDeviceChange,
  available,
  connected,
  deviceStatus,
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
  dialPending,
}: {
  status: PresenceStatus;
  busy: "status" | string | null;
  onCall: boolean;
  provisioned: boolean;
  canGoReady: boolean;
  onToggleReady: () => void;
  campaigns: DialerCampaign[];
  onToggleCampaign: (campaignId: string, ready: boolean) => void;
  onInputDeviceChange: (deviceId: string) => Promise<void>;
  onOutputDeviceChange: (deviceId: string) => Promise<void>;
  available: 0 | 1 | null;
  connected: boolean;
  deviceStatus: string;
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
}) {
  return (
    <aside className="order-3 flex w-full flex-col gap-3 xl:order-none">
      <Card className="shadow-xs">
        <CardContent className="space-y-3 p-4">
          {/* <div className="space-y-1">
            <p className="text-sm font-medium">Controls </p>
            <p className="text-xs leading-5 text-muted-foreground">
              Set readiness and choose which campaigns can reach you.
            </p>
          </div> */}
          <div className="grid gap-2">
            <Button
              className="w-full"
              variant={status === "ready" ? "outline" : "success"}
              onClick={onToggleReady}
              disabled={
                busy !== null ||
                onCall ||
                !provisioned ||
                (status !== "ready" && !canGoReady)
              }
            >
              {busy === "status" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Power className="size-4" />
              )}
              {busy === "status"
                ? "Saving…"
                : status === "ready"
                  ? "Pause Calls"
                  : "Go Ready"}
            </Button>
            <CampaignMenu
              campaigns={campaigns}
              busy={busy}
              onCall={onCall}
              onToggleCampaign={onToggleCampaign}
            />
            <AudioSetupDialog
              onInputDeviceChange={onInputDeviceChange}
              onOutputDeviceChange={onOutputDeviceChange}
            />
          </div>
        </CardContent>
      </Card>

      {showOutboundDialer && (
        <Dialpad
          value={dialInput}
          onChange={onDialInputChange}
          onDial={onDialOut}
          canDial={canDial}
          pending={dialPending}
          deviceRegistered={deviceStatus === "registered"}
        />
      )}

      <StatusPreview
        available={available}
        connected={connected}
        status={status}
        deviceStatus={deviceStatus}
        armedCount={armedCount}
        campaignCount={campaignCount}
        anyArmed={anyArmed}
        onCall={onCall}
        presence={presence}
        provisioned={provisioned}
        readyStatePending={readyStatePending}
      />
    </aside>
  );
}

function CampaignMenu({
  campaigns,
  busy,
  onCall,
  onToggleCampaign,
}: {
  campaigns: DialerCampaign[];
  busy: "status" | string | null;
  onCall: boolean;
  onToggleCampaign: (campaignId: string, ready: boolean) => void;
}) {
  const readyCount = campaigns.filter((c) => c.ready).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
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
      <DropdownMenuContent align="end" className="w-80 p-3">
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
          <div className="space-y-2">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="flex items-center justify-between gap-3 rounded-md px-1 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {campaign.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {campaign.ready ? "Routing enabled" : "Not routing"}
                  </p>
                </div>
                {busy === campaign.id ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
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

function IdleCallPanel({ available }: { available: 0 | 1 | null }) {
  const routable = available === 1;

  return (
    <Card className="shadow-xs">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Headphones className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="font-medium">
              {routable ? "Ready For Calls" : "Not Ready"}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {routable
                ? "Searching for a call... \n Incoming calls will answer automatically."
                : "Click Go Ready on the right-side panel to recieve a call."}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Outbound dialpad — the agent types a US/CA number and places a call. The backend
 * originates it (presenting the agent's own DID) and bridges the answered customer
 * back to this browser as an incoming leg. Rendered in the idle state only; `canDial`
 * folds in the on-call / device-registered / valid-number gates. In V1 the dialpad is
 * the only way to populate the number (autofill/click-to-dial are future work that
 * will call the same startOutboundCall).
 */
function Dialpad({
  value,
  onChange,
  onDial,
  canDial,
  pending,
  deviceRegistered,
}: {
  value: string;
  onChange: (v: string) => void;
  onDial: () => void;
  canDial: boolean;
  pending: boolean;
  deviceRegistered: boolean;
}) {
  const [open, setOpen] = useState(false);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  const preview = normalizeDialInput(value);

  return (
    <Card className="shadow-xs">
      <CardHeader className={cn("pb-3", !open && "pb-4")}>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="inline-flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={open}
          >
            <PhoneOutgoing className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Outbound Dialer</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              value={value}
              inputMode="tel"
              placeholder="(555) 123-4567"
              className="h-12 font-mono text-lg"
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canDial) onDial();
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
            {pending ? "Calling…" : "Call"}
          </Button>

          {!deviceRegistered ? (
            <p className="text-center text-xs text-muted-foreground">
              Softphone connecting… you can place a call once it's ready.
            </p>
          ) : value && !preview ? (
            <p className="text-center text-xs text-muted-foreground">
              Enter a valid US or Canada number.
            </p>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

function StatusPreview({
  available,
  connected,
  status,
  deviceStatus,
  armedCount,
  campaignCount,
  anyArmed,
  onCall,
  presence,
  provisioned,
  readyStatePending,
}: {
  available: 0 | 1 | null;
  connected: boolean;
  status: PresenceStatus;
  deviceStatus: string;
  armedCount: number;
  campaignCount: number;
  anyArmed: boolean;
  onCall: boolean;
  presence: DialerPresence | null;
  provisioned: boolean;
  readyStatePending: boolean;
}) {
  const [open, setOpen] = useState(true);
  const deviceRegistered = deviceStatus === "registered";
  const isAvailable = available === 1;
  const availabilityHelper = !provisioned
    ? "Provisioning is required before calls can be routed."
    : isAvailable
      ? "Currently available for calls from the Policy Printer network."
      : reasonNotAvailable(presence, anyArmed, connected, deviceStatus, onCall);

  return (
    <Card className="w-full shadow-xs">
      <CardHeader className={cn("pb-3", !open && "pb-4")}>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="inline-flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={open}
          >
            <span className="truncate">Current Status</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
          <AvailabilityBadge
            available={available}
            connected={connected}
            onCall={onCall}
            pending={readyStatePending}
          />
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <StatusRow
            icon={onCall ? PhoneCall : isAvailable ? CircleCheck : CircleAlert}
            label="Availability"
            value={
              onCall ? "On Call" : isAvailable ? "Available" : "Unavailable"
            }
            helper={availabilityHelper}
            tone={onCall ? "warning" : isAvailable ? "success" : "destructive"}
          />
          <StatusRow
            icon={onCall ? PhoneCall : readyStatePending ? Loader2 : Power}
            label="Ready State"
            value={onCall ? "On Call" : status === "ready" ? "Ready" : "Paused"}
            helper={
              onCall
                ? "Currently on a call."
                : status === "ready"
                  ? "You are marked ready to accept calls."
                  : "Click Go Ready when you are ready for calls."
            }
            tone={
              onCall
                ? "warning"
                : status === "ready"
                  ? "success"
                  : "destructive"
            }
            pending={!onCall && readyStatePending}
          />
          <StatusRow
            icon={deviceRegistered ? Wifi : WifiOff}
            label="Phone Registration"
            value={deviceRegistered ? "Registered" : deviceStatus}
            helper={
              deviceRegistered
                ? "Device registered with Policy Printer phone network."
                : "Not registered with Policy Printer phone network."
            }
            tone={deviceRegistered ? "success" : "destructive"}
          />
          <StatusRow
            icon={RadioTower}
            label="Call Network"
            value={connected ? "Connected" : "Reconnecting"}
            helper={
              connected
                ? "Device connected to PolicyPrinter call publishing network."
                : "Device not connected to PolicyPrinter call publishing network."
            }
            tone={connected ? "success" : "destructive"}
          />
          <StatusRow
            icon={ListChecks}
            label="Campaign Routing"
            value={`${armedCount} of ${campaignCount}`}
            helper={
              armedCount > 0
                ? `Active on ${armedCount} campaign${armedCount === 1 ? "" : "s"}.`
                : "Turn on at least one campaign to take calls."
            }
            tone={armedCount > 0 ? "success" : "destructive"}
          />
        </CardContent>
      )}
    </Card>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  helper,
  tone,
  pending = false,
}: {
  icon: typeof CircleCheck;
  label: string;
  value: string;
  helper: string;
  tone: "success" | "destructive" | "warning";
  pending?: boolean;
}) {
  const toneClass = {
    success: {
      icon: "bg-success/10 text-success",
      badge: cn(
        "border-success/30 bg-success/5 text-success",
        pending && "ring-2 ring-success/15",
      ),
    },
    destructive: {
      icon: "bg-destructive/10 text-destructive",
      badge: cn(
        "border-destructive/30 bg-destructive/5 text-destructive",
        pending && "ring-2 ring-destructive/15",
      ),
    },
    warning: {
      icon: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
      badge: cn(
        "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
        pending && "ring-2 ring-amber-300/25",
      ),
    },
  }[tone];

  return (
    <div className={cn("flex gap-3", pending && "animate-pulse")}>
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          toneClass.icon,
        )}
      >
        <Icon className={cn("size-4", pending && "animate-spin")} />
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
  pending = false,
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
          "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
          pending && "ring-2 ring-amber-300/25",
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
        variant={connected ? "secondary" : "outline"}
        className={
          connected
            ? undefined
            : "border-destructive/30 bg-destructive/5 text-destructive"
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
        "bg-success text-success-foreground",
        pending && "ring-2 ring-success/20",
      )}
    >
      {pending && <Loader2 className="animate-spin" />}
      Available
    </Badge>
  ) : (
    <Badge
      variant="destructive"
      className={cn(pending && "ring-2 ring-destructive/20")}
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
  onCall: boolean,
): string {
  if (!connected) return "Reconnecting to the Policy Printer network";
  if (onCall || presence?.on_call) return "Currently on a call";
  if (!anyArmed) return "No campaign enabled";
  if (deviceStatus !== "registered")
    return "Your device isn’t connected to the Policy Printer network";
  return "Waiting on a ping from the Policy Printer network";
}

function readError(err: any, fallback: string): string {
  return err?.response?.data?.statusMessage || err?.message || fallback;
}
