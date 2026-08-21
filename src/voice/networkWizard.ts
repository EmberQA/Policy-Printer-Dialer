/**
 * The on-machine network wizard (ENG-159 — Subplan 07).
 *
 * Decides, on the agent's own machine, which voice network they should be on, and moves
 * them. Two directions, and the second one is the reason this subplan grew:
 *
 *   DEMOTE   they are on Primary and this machine can't use it → move to Fallback
 *   PROMOTE  they are on Fallback, still hold Primary artifacts, and this machine CAN
 *            use Primary → move them back
 *
 * ⚠️ WHY PROMOTION EXISTS AT ALL. The obvious rule — "the wizard is only for Primary
 * agents" — keys on the carrier the agent is on RIGHT NOW, so the moment one falls back
 * they stop qualifying, the wizard never runs for them again, and the fallback becomes
 * PERMANENT. One bad afternoon on hotel wifi moves an agent to the more expensive carrier
 * for good. It is silent, it only ever ratchets one way, and it drains exactly the saving
 * the whole ticket exists for.
 *
 * An agent who was NEVER provisioned on Primary is still excluded and always will be —
 * they have nothing to test, and the flip refuses a target it would have to buy onto.
 * Promotion is only ever a RETURN to a carrier the agent already owns; the backend decides
 * that, not this file (see `getProbeToken`).
 *
 * ─── Three asymmetries, all deliberate ───────────────────────────────────────
 *
 * 1. RETRY IS DEMOTION-ONLY. A retry exists to avoid acting on a transient. For demotion
 *    the risk is acting too eagerly, so retry once before moving a working agent off
 *    Primary. For promotion, retrying would mean *keep trying until it passes* — which is
 *    precisely how you promote an agent whose network is marginal, and they will be
 *    demoted again within the hour. One clean pass or leave them alone.
 *
 * 2. PROMOTION IS BOOT-ONLY. Demotion also runs on a network change, because it answers
 *    "this agent is broken RIGHT NOW". Promotion answers "things look better", and running
 *    that on every network blip is how a flapping wifi swings an agent back and forth —
 *    each swing costing a Retreaver re-point and a window where our database and Retreaver
 *    disagree about which number to dial. A login is a deliberate, infrequent boundary.
 *
 * 3. DEMOTED THIS SESSION ⇒ NEVER PROMOTED THIS SESSION. The session marker is what stops
 *    one boot's demotion being undone by the same boot's promotion check.
 *
 * ⚠️ THE AGENT IS TOLD NOTHING. Not the vendor, not "Primary", not "Fallback", not that a
 * switch happened. There is no action for them to take on any of it, so the only thing
 * surfacing it can produce is a support ticket about a system that is working correctly.
 * The one string this feature owns is "Finding the best connection…". No carrier chip, no
 * fallback notice, and no modal — a blocking dialog between an agent and their queue is
 * exactly the overcooking the ticket warns against.
 */

import type {ProbeReport} from './networkProbe';
import type {VoiceProvider} from './VoiceTransport';

export type WizardDirection = 'stay' | 'promote' | 'demote';

/** What the wizard should attempt, given where the agent is and why we woke up. */
export type WizardPlan = 'test-primary' | 'test-promotion' | null;

export type WizardTrigger = 'boot' | 'network-change';

export interface WizardConditions {
	provider: VoiceProvider;
	/** An administrator pinned this agent's network. Outranks the wizard in BOTH
	 *  directions. The flip refuses independently, so honouring it here is an
	 *  optimization — it just avoids burning the agent's first seconds on a foregone
	 *  conclusion. */
	providerLocked: boolean;
	trigger: WizardTrigger;
	hasActiveCall: boolean;
	demotedThisSession: boolean;
	promotedThisSession: boolean;
}

/**
 * The entry gate, as a pure function so it can be read and tested as one rule rather than
 * inferred from a chain of early returns.
 */
export const wizardPlan = (conditions: WizardConditions): WizardPlan => {
	// Never move a live agent mid-call, in either direction: the flip changes which browser
	// the next inbound bridges to and re-points the buyers under a live conversation.
	if (conditions.hasActiveCall) return null;
	if (conditions.providerLocked) return null;

	if (conditions.provider === 'telnyx') {
		// Already moved off Primary once this session; a second demotion is meaningless and
		// a re-test would only produce noise.
		if (conditions.demotedThisSession) return null;
		return 'test-primary';
	}

	// On Fallback: promotion only, and only at a login boundary.
	if (conditions.trigger !== 'boot') return null;
	if (conditions.demotedThisSession) return null;
	if (conditions.promotedThisSession) return null;
	return 'test-promotion';
};

/** Per-tab, matching the outbound-attempt recovery pattern already in `useDevice`. */
const SESSION_KEY = 'pp_dialer_network_wizard';

interface SessionMarker {
	demoted?: boolean;
	promoted?: boolean;
}

export const readWizardMarker = (): SessionMarker => {
	try {
		const raw = sessionStorage.getItem(SESSION_KEY);
		return raw ? (JSON.parse(raw) as SessionMarker) : {};
	} catch {
		return {};
	}
};

const writeWizardMarker = (patch: SessionMarker): void => {
	try {
		sessionStorage.setItem(
			SESSION_KEY,
			JSON.stringify({...readWizardMarker(), ...patch})
		);
	} catch {
		/* the in-memory outcome still holds for this mount */
	}
};

/** Short enough that an agent does not notice, long enough to outlast the blip a retry
 *  exists to absorb. */
const RETRY_DELAY_MS = 1_500;

export interface WizardIo {
	/** Mint a Primary token for an agent on Fallback. Resolves to null when the backend
	 *  says this agent is not a promotion candidate — that refusal IS the eligibility
	 *  answer, so there is no separate capability check. */
	getProbeToken: () => Promise<string | null>;
	runProbe: (token: string) => Promise<ProbeReport>;
	/** Move the agent. Resolves true when they landed on `provider`. */
	postFallback: (
		provider: VoiceProvider,
		diagnostics: Record<string, unknown>
	) => Promise<boolean>;
	/** Record an outcome that did NOT end in a flip. Flips record themselves. */
	recordTest: (payload: {
		passed: boolean;
		direction: WizardDirection;
		failedStage?: string | null;
		detail?: Record<string, unknown>;
	}) => Promise<void>;
	delay?: (ms: number) => Promise<void>;
}

export interface WizardOutcome {
	/** False when the entry gate said no — the common case for most agents. */
	ran: boolean;
	direction: WizardDirection | null;
	/** Set only when the agent actually moved; the caller must re-fetch their token. */
	flippedTo: VoiceProvider | null;
}

const skipped: WizardOutcome = {ran: false, direction: null, flippedTo: null};

const probeDetail = (report: ProbeReport, extra: Record<string, unknown> = {}) => ({
	ice_type: report.iceType,
	stage_timings: report.timings,
	user_agent: report.userAgent,
	...(report.error ? {error: report.error} : {}),
	...extra
});

/**
 * Run the wizard.
 *
 * `activeToken` is the token the caller already fetched for the agent's CURRENT carrier —
 * it is what the demotion path tests with, so the demotion path costs no extra round trip.
 * The promotion path cannot use it (it is a Fallback token) and asks the backend for a
 * probe token instead.
 *
 * Never throws: a wizard that throws would take out the dialer boot it sits in front of,
 * which is a far worse outcome than a missed re-test.
 */
export const runNetworkWizard = async (
	conditions: WizardConditions,
	activeToken: string,
	io: WizardIo
): Promise<WizardOutcome> => {
	const plan = wizardPlan(conditions);
	if (!plan) return skipped;
	const delay = io.delay ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

	try {
		if (plan === 'test-primary') {
			const first = await io.runProbe(activeToken);
			if (first.passed) {
				await io.recordTest({
					passed: true,
					direction: 'stay',
					detail: probeDetail(first, {attempt: 1})
				});
				return {ran: true, direction: 'stay', flippedTo: null};
			}

			// Retry once. Do not demote on a blip.
			await delay(RETRY_DELAY_MS);
			const second = await io.runProbe(activeToken);
			if (second.passed) {
				// A pass that had to flap is the early warning that this agent is about to
				// start bouncing, and it leaves no other trace anywhere.
				await io.recordTest({
					passed: true,
					direction: 'stay',
					detail: probeDetail(second, {
						attempt: 2,
						flapped: true,
						first_failed_stage: first.failedStage
					})
				});
				return {ran: true, direction: 'stay', flippedTo: null};
			}

			// The flip records its own diagnostic (carrying this detail as context), so
			// there is no recordTest on this branch — a second row would double-count every
			// demotion in the rollout numbers.
			const moved = await io.postFallback('twilio', {
				direction: 'demote',
				failed_stage: second.failedStage,
				attempt: 2,
				first_failed_stage: first.failedStage,
				...probeDetail(second)
			});
			if (moved) writeWizardMarker({demoted: true});
			return {
				ran: true,
				direction: 'demote',
				flippedTo: moved ? 'twilio' : null
			};
		}

		// ── promotion ────────────────────────────────────────────────────────────
		const probeToken = await io.getProbeToken();
		// Not a promotion candidate. The overwhelmingly common answer, and not an event:
		// recording it would write a row per boot for every agent who was never on Primary.
		if (!probeToken) return skipped;

		const report = await io.runProbe(probeToken);
		if (!report.passed) {
			await io.recordTest({
				passed: false,
				direction: 'promote',
				failedStage: report.failedStage,
				detail: probeDetail(report, {attempt: 1})
			});
			return {ran: true, direction: 'promote', flippedTo: null};
		}

		const moved = await io.postFallback('telnyx', {
			direction: 'promote',
			attempt: 1,
			...probeDetail(report)
		});
		if (moved) writeWizardMarker({promoted: true});
		return {
			ran: true,
			direction: 'promote',
			flippedTo: moved ? 'telnyx' : null
		};
	} catch {
		// Leave the agent exactly where they are. Their current carrier is, by definition,
		// the one they were already working on.
		return skipped;
	}
};
