/**
 * DialerSessionProvider — the shared, route-persistent dialer session.
 *
 * The Twilio `Device` (useDevice) and the presence heartbeat (useHeartbeat) MUST
 * outlive tab switches: they used to live inside the Dial page, so navigating to the
 * Activity tab unmounted Dial and destroyed the Device — silently dropping inbound
 * calls while the agent browsed history. Hoisting them here (mounted once, above the
 * <Routes>) keeps the Device + heartbeat alive for the whole authenticated session and
 * lets any page share exact outbound pending/ringback/cancel state.
 *
 * This owns ONLY what must be shared — the device, heartbeat, and the bootstrap
 * profile/campaigns/presence. Page-local UI state (wrap-up, dialpad input, ready
 * toggles, debug call) stays in the pages that use it.
 *
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchDialerProfile,
  getPresence,
  listCampaignRemainingCalls,
  listCampaigns,
  OUTBOUND_LIFECYCLE_VERSION,
  type DialerCampaign,
  type DialerPresence,
} from "@/lib/api";
import { useDevice, type UseDeviceState } from "@/twilio/useDevice";
import { useHeartbeat, type HeartbeatState } from "@/presence/useHeartbeat";
import { readError } from "@/lib/errors";

export interface DialerSession {
  // --- bootstrap / gating ---
  profile: any;
  provisioned: boolean;
  /** True once the bootstrap Promise.all resolved (profile !== null). */
  bootstrapped: boolean;
  /** Bootstrap (load) failure, if any. Action errors stay local to each page. */
  bootError: string | null;

  // --- campaigns (Dial toggles them; both pages read them) ---
  campaigns: DialerCampaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<DialerCampaign[]>>;

  // --- presence (Dial mutates via API + setter; the heartbeat syncs it) ---
  presence: DialerPresence | null;
  setPresence: React.Dispatch<React.SetStateAction<DialerPresence | null>>;

  // --- the single live Device + heartbeat, exposed verbatim ---
  device: UseDeviceState;
  heartbeat: HeartbeatState;

  // --- required per-tab audio check ---
  /** Calls stay unavailable until this tab's required echo check is confirmed. */
  audioCheckComplete: boolean;
  completeAudioCheck: () => void;

  // --- derived flags both pages need ---
  /** Live call, backend on_call flag, or Calls-page debug/wrap-up state. */
  onCall: boolean;
  /** Lets the Calls page include its local debug/wrap-up state in the shared gate. */
  setCallUiBusy: React.Dispatch<React.SetStateAction<boolean>>;
  /** Base gate for placing a call, WITHOUT the per-number check: provisioned &&
   *  device registered && not on a call. Callers add normalizeDialInput + their own
   *  in-flight guard. */
  canDialBase: boolean;
}

const DialerSessionContext = createContext<DialerSession | null>(null);

export function DialerSessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
  const [presence, setPresence] = useState<DialerPresence | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [audioCheckComplete, setAudioCheckComplete] = useState(false);
  const [callUiBusy, setCallUiBusy] = useState(false);
  const hadActiveCallRef = useRef(false);

  const provisioned = Boolean(profile?.provisioned);
  const outboundLifecycleEnabled =
    Number(profile?.capabilities?.outbound_lifecycle_version ?? 0) >=
    OUTBOUND_LIFECYCLE_VERSION;

  // The single Device + heartbeat for the whole session. `enabled` gates both on
  // provisioning (profile loads async → both start disabled, enable once known).
  const device = useDevice({
    enabled: provisioned,
    outboundLifecycleEnabled,
  });
  const heartbeat = useHeartbeat({
    enabled: provisioned,
    // Keep backend-computed availability at zero until the user confirms that
    // this tab's microphone and speaker work. The Device still registers so the
    // setup dialog can apply real input/output selections before confirmation.
    deviceStatus: audioCheckComplete ? device.deviceStatus : "offline",
  });

  const refreshCampaignRemainingCalls = useCallback(async (
    shouldSkip?: () => boolean,
  ) => {
    const usage = await listCampaignRemainingCalls();
    if (shouldSkip?.()) return;
    const usageByCampaign = new Map(
      (usage.campaigns ?? []).map((item) => [item.campaign_id, item]),
    );
    setCampaigns((current) =>
      current.map((campaign) => {
        const campaignUsage = usageByCampaign.get(campaign.id);
        return campaignUsage
          ? {
              ...campaign,
              calls_used: campaignUsage.calls_used,
              calls_allotted: campaignUsage.calls_allotted,
              calls_remaining: campaignUsage.calls_remaining,
              calls_remaining_status: campaignUsage.calls_remaining_status,
            }
          : campaign;
      }),
    );
  }, []);

  // Bootstrap: profile + campaigns + presence (moved from Dial).
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDialerProfile(), listCampaigns(), getPresence()])
      .then(([prof, camps, pres]: any[]) => {
        if (cancelled) return;
        setProfile(prof);
        setCampaigns(camps?.campaigns ?? []);
        setPresence(pres?.presence ?? null);

        // Usage is deliberately best-effort and is not part of the bootstrap
        // Promise.all. A slow/unavailable Retreaver read must not block the dialer.
        void refreshCampaignRemainingCalls(() => cancelled)
          .catch(() => {
            if (cancelled) return;
            setCampaigns((current) =>
              current.map((campaign) => ({
                ...campaign,
                calls_remaining: null,
                calls_remaining_status: "retreaver_unavailable",
              })),
            );
          });
      })
      .catch((err) => {
        if (cancelled) return;
        setBootError(readError(err, "Failed to load dialer"));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshCampaignRemainingCalls]);

  // Retreaver updates its target cap as calls route. Re-read every campaign count
  // on the active -> ended edge so the dropdown and Go Ready hover show the latest
  // allowance without requiring a page refresh. A transient refresh failure keeps
  // the last known counts rather than replacing useful values with "Unavailable".
  useEffect(() => {
    const hasActiveCall = Boolean(device.activeCall);
    if (hadActiveCallRef.current && !hasActiveCall) {
      void refreshCampaignRemainingCalls().catch(() => undefined);
    }
    hadActiveCallRef.current = hasActiveCall;
  }, [device.activeCall, refreshCampaignRemainingCalls]);

  // Keep local presence in sync with what the heartbeat observes (on_call flipping,
  // another tab changing status, etc.) — moved from Dial.
  useEffect(() => {
    if (heartbeat.presence) setPresence(heartbeat.presence);
  }, [heartbeat.presence]);

  const onCall =
    Boolean(device.activeCall) ||
    Boolean(device.outboundStarting) ||
    Boolean(device.pendingOutbound) ||
    Boolean(presence?.on_call) ||
    callUiBusy;
  const canDialBase =
    audioCheckComplete &&
    provisioned &&
    outboundLifecycleEnabled &&
    device.deviceStatus === "registered" &&
    !onCall;

  const value = useMemo<DialerSession>(
    () => ({
      profile,
      provisioned,
      bootstrapped: profile !== null,
      bootError,
      campaigns,
      setCampaigns,
      presence,
      setPresence,
      device,
      heartbeat,
      audioCheckComplete,
      completeAudioCheck: () => setAudioCheckComplete(true),
      onCall,
      setCallUiBusy,
      canDialBase,
    }),
    [
      profile,
      provisioned,
      bootError,
      campaigns,
      presence,
      device,
      heartbeat,
      audioCheckComplete,
      onCall,
      canDialBase,
    ],
  );

  return (
    <DialerSessionContext.Provider value={value}>
      {children}
    </DialerSessionContext.Provider>
  );
}

export function useDialerSession(): DialerSession {
  const ctx = useContext(DialerSessionContext);
  if (!ctx) {
    throw new Error(
      "useDialerSession must be used inside <DialerSessionProvider>",
    );
  }
  return ctx;
}
