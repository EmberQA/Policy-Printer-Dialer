import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Headphones,
  ListChecks,
  Loader2,
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
  fetchDialerProfile,
  getPresence,
  listCampaigns,
  setCampaignReady,
  setPresence,
  type DialerCampaign,
  type DialerPresence,
  type PresenceStatus,
} from "@/lib/api";
import { useHeartbeat } from "@/presence/useHeartbeat";
import { useDevice } from "@/twilio/useDevice";
import { ActiveCallBanner } from "@/twilio/ActiveCallBanner";
import { LeadForm } from "@/leads/LeadForm";
import { cn } from "@/lib/utils";

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
  const [busy, setBusy] = useState<"status" | string | null>(null);
  const [pendingReadyStatus, setPendingReadyStatus] =
    useState<PresenceStatus | null>(null);
  const [readyRequestSettled, setReadyRequestSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which campaign the active call's lead form is for. Defaults to the sole armed
  // campaign; when several are armed the agent picks (the call can be from any buyer).
  const [leadCampaignId, setLeadCampaignId] = useState<string>("");

  const provisioned = Boolean(profile?.provisioned);

  // The Twilio Device registers once the agent is provisioned; its status feeds
  // the heartbeat so the backend only advertises availability when the softphone
  // can actually receive a call. The active call (if any) drives the banner.
  const device = useDevice({ enabled: provisioned });

  // Heartbeat runs once we know the agent is provisioned (a usable session
  // exists by then — handoff already ran). It reports the live device status and
  // echoes back the recomputed availability.
  const heartbeat = useHeartbeat({
    enabled: provisioned,
    deviceStatus: device.deviceStatus,
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
        setError(readError(err, "Failed to load dialer"));
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

  // Prefer the live heartbeat value; fall back to the bootstrap presence read.
  const available =
    heartbeat.available ?? (status === "ready" && anyArmed ? null : 0);

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

  // On a call if the live Device says so, or the backend flag is set (covers the
  // brief window before the device 'accept' event lands).
  const onCall = Boolean(device.activeCall) || Boolean(presence?.on_call);
  const canGoReady = anyArmed; // must arm ≥1 campaign first
  const deviceError = device.error;

  return (
    <div className="relative min-h-[calc(100vh-7rem)] w-full space-y-6">
      {error && (
        <div className="mx-auto max-w-3xl rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {deviceError && (
        <div className="mx-auto max-w-3xl rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Softphone: {deviceError}
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
        </div>

        {!profile && !error && (
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
            {device.activeCall ? (
              <ActiveCallBanner
                call={device.activeCall}
                onMute={device.mute}
                onHangup={device.hangup}
              />
            ) : (
              <IdleCallPanel
                available={available}
                connected={heartbeat.connected}
                deviceStatus={device.deviceStatus}
                anyArmed={anyArmed}
                presence={presence}
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

      <DialSidebar
        status={status}
        busy={busy}
        onCall={onCall}
        provisioned={provisioned}
        canGoReady={canGoReady}
        onToggleReady={onToggleReady}
        campaigns={campaigns}
        onToggleCampaign={onToggleCampaign}
        available={available}
        connected={heartbeat.connected}
        deviceStatus={device.deviceStatus}
        armedCount={armedCampaigns.length}
        campaignCount={campaigns.length}
        anyArmed={anyArmed}
        presence={presence}
        readyStatePending={pendingReadyStatus !== null}
      />
    </div>
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
  available,
  connected,
  deviceStatus,
  armedCount,
  campaignCount,
  anyArmed,
  presence,
  readyStatePending,
}: {
  status: PresenceStatus;
  busy: "status" | string | null;
  onCall: boolean;
  provisioned: boolean;
  canGoReady: boolean;
  onToggleReady: () => void;
  campaigns: DialerCampaign[];
  onToggleCampaign: (campaignId: string, ready: boolean) => void;
  available: 0 | 1 | null;
  connected: boolean;
  deviceStatus: string;
  armedCount: number;
  campaignCount: number;
  anyArmed: boolean;
  presence: DialerPresence | null;
  readyStatePending: boolean;
}) {
  return (
    <aside className="mx-auto flex w-full max-w-3xl flex-col gap-3 2xl:absolute 2xl:right-0 2xl:top-0 2xl:mx-0 2xl:w-80">
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
          </div>
        </CardContent>
      </Card>

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

function IdleCallPanel({
  available,
  connected,
  deviceStatus,
  anyArmed,
  presence,
}: {
  available: 0 | 1 | null;
  connected: boolean;
  deviceStatus: string;
  anyArmed: boolean;
  presence: DialerPresence | null;
}) {
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
              {routable ? "Ready for routed calls" : "Not Ready"}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {routable
                ? "Keep this tab open. Incoming calls answer automatically."
                : "Check status and click Go Ready to start accepting calls."}
            </p>
          </div>
        </div>
      </CardContent>
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
            pending={readyStatePending}
          />
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <StatusRow
            icon={isAvailable ? CircleCheck : CircleAlert}
            label="Availability"
            value={isAvailable ? "Available" : "Unavailable"}
            helper={availabilityHelper}
            tone={isAvailable ? "success" : "destructive"}
          />
          <StatusRow
            icon={readyStatePending ? Loader2 : Power}
            label="Ready State"
            value={status === "ready" ? "Ready" : "Paused"}
            helper={
              status === "ready"
                ? "You are marked ready to accept calls."
                : "Click Go Ready when you are ready for calls."
            }
            tone={status === "ready" ? "success" : "destructive"}
            pending={readyStatePending}
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
  tone: "success" | "destructive";
  pending?: boolean;
}) {
  return (
    <div className={cn("flex gap-3", pending && "animate-pulse")}>
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          tone === "success"
            ? "bg-success/10 text-success"
            : "bg-destructive/10 text-destructive",
        )}
      >
        <Icon className={cn("size-4", pending && "animate-spin")} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{label}</p>
          <Badge
            variant="outline"
            className={
              tone === "success"
                ? cn(
                    "border-success/30 bg-success/5 text-success",
                    pending && "ring-2 ring-success/15",
                  )
                : cn(
                    "border-destructive/30 bg-destructive/5 text-destructive",
                    pending && "ring-2 ring-destructive/15",
                  )
            }
          >
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
  pending = false,
}: {
  available: 0 | 1 | null;
  connected: boolean;
  pending?: boolean;
}) {
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
