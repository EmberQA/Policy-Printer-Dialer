/**
 * DialerSessionProvider — the shared, route-persistent dialer session.
 *
 * The Twilio `Device` (useDevice) and the presence heartbeat (useHeartbeat) MUST
 * outlive tab switches: they used to live inside the Dial page, so navigating to the
 * Activity tab unmounted Dial and destroyed the Device — silently dropping inbound
 * calls while the agent browsed history. Hoisting them here (mounted once, above the
 * <Routes>) keeps the Device + heartbeat alive for the whole authenticated session and
 * lets any page (Dial's dialpad, Activity's click-to-dial) reach `armOutbound`.
 *
 * This owns ONLY what must be shared — the device, heartbeat, and the bootstrap
 * profile/campaigns/presence. Page-local UI state (wrap-up, dialpad input, ready
 * toggles, debug call) stays in the pages that use it.
 *
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchDialerProfile,
  getPresence,
  listCampaigns,
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

  // --- derived flags both pages need ---
  /** Live call OR backend on_call flag. on_call stays true through wrap-up (backend
   *  clears it at release), so this blocks a second call during wrap-up too. Excludes
   *  Dial-local debug/wrap-up UI state on purpose. */
  onCall: boolean;
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

  const provisioned = Boolean(profile?.provisioned);

  // The single Device + heartbeat for the whole session. `enabled` gates both on
  // provisioning (profile loads async → both start disabled, enable once known).
  const device = useDevice({ enabled: provisioned });
  const heartbeat = useHeartbeat({
    enabled: provisioned,
    deviceStatus: device.deviceStatus,
  });

  // Bootstrap: profile + campaigns + presence (moved from Dial).
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDialerProfile(), listCampaigns(), getPresence()])
      .then(([prof, camps, pres]: any[]) => {
        if (cancelled) return;
        setProfile(prof);
        setCampaigns(camps?.campaigns ?? []);
        setPresence(pres?.presence ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setBootError(readError(err, "Failed to load dialer"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep local presence in sync with what the heartbeat observes (on_call flipping,
  // another tab changing status, etc.) — moved from Dial.
  useEffect(() => {
    if (heartbeat.presence) setPresence(heartbeat.presence);
  }, [heartbeat.presence]);

  const onCall = Boolean(device.activeCall) || Boolean(presence?.on_call);
  const canDialBase =
    provisioned && device.deviceStatus === "registered" && !onCall;

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
      onCall,
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
