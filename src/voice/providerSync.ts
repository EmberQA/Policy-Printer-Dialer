/**
 * Keeping a running softphone on the carrier the SERVER says this agent is on
 * (ENG-159 Subplan 08).
 *
 * The transport is built once, at boot, from whatever carrier the token came back for.
 * An administrator can move an agent between networks at any moment afterwards, from a
 * different machine entirely — and when they do, the agent's DID changes and their
 * Retreaver buyers are re-pointed at the new one. A browser still registered on the old
 * carrier is then reachable by nothing: the bridge dials an address nobody is listening
 * on, and every call routed to that agent fails.
 *
 * The backend pauses the agent at the moment of the switch, which stops calls being
 * routed at all during the gap. This is the other half: it is what makes going Ready
 * again safe, instead of putting the agent straight back into the broken state.
 *
 * The signal arrives on the ~5s heartbeat, so it REPEATS. That is what lets the rule
 * below stay a pure predicate with no queue: a decision deferred is simply re-offered a
 * few seconds later, against fresh inputs. Queueing a pending rebuild would mean acting
 * on a carrier that may have changed again while the call ran.
 */

import type {VoiceProvider} from './VoiceTransport';

export interface ProviderSyncInput {
	/** The carrier the LIVE transport was actually built against; null before boot. */
	built: VoiceProvider | null;
	/** What the server reports on the heartbeat; null when it hasn't said yet. */
	reported: VoiceProvider | null;
	hasActiveCall: boolean;
}

/**
 * Should the transport be torn down and rebuilt?
 *
 * Never mid-call: a rebuild destroys the transport, which would drop the very call the
 * switch was explicitly forbidden from interrupting. Never before boot either — there is
 * no transport to be wrong yet, and the boot path picks the carrier up on its own.
 */
export const shouldRebuildTransport = (input: ProviderSyncInput): boolean => {
	if (!input.reported) return false;
	if (!input.built) return false;
	if (input.built === input.reported) return false;
	return !input.hasActiveCall;
};
