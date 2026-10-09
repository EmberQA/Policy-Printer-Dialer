/**
 * Round-trip time out of a raw `RTCStatsReport` (ENG-159 — Subplan 05).
 *
 * Twilio publishes an `RTCSample` every second with `rtt` already computed. Telnyx has
 * no equivalent event, and its `call.getStats(callback, constraints)` is a void,
 * callback-shaped API — so the transport polls the public `call.peer.instance`
 * (an ordinary `RTCPeerConnection`) and reduces the report here.
 *
 * Kept pure and separate so the selection rule is testable without a browser: the
 * connection-quality chip in App.tsx reads this value for the whole duration of every
 * Telnyx call, and a wrong candidate-pair reads as a plausible-but-false latency
 * rather than as an error.
 */

/** The subset of `RTCIceCandidatePairStats` we rely on. */
interface CandidatePairLike {
	type?: string;
	state?: string;
	nominated?: boolean;
	currentRoundTripTime?: number;
}

/** Anything iterable the way an `RTCStatsReport` is (it is a Map at runtime). */
export type StatsReportLike = {
	forEach(cb: (value: unknown, key: string) => void): void;
};

/**
 * Pick the in-use candidate pair's RTT and return it in milliseconds.
 *
 * A connection accumulates candidate pairs that were tried and lost, and several may
 * still carry an `currentRoundTripTime` from when they were probed. Preferring
 * `nominated` + `succeeded` is what keeps us from reporting a stale loser's latency;
 * a succeeded-but-unnominated pair is the fallback, because Chrome has shipped
 * versions that leave `nominated` unset on the active pair.
 *
 * Returns null when no pair carries a usable measurement — the caller renders that as
 * "no reading" rather than as zero.
 */
export const readRttMs = (report: StatsReportLike | null | undefined): number | null => {
	if (!report || typeof report.forEach !== 'function') return null;

	let nominated: number | null = null;
	let succeeded: number | null = null;

	report.forEach((value) => {
		const stat = value as CandidatePairLike;
		if (stat?.type !== 'candidate-pair') return;
		const rtt = stat.currentRoundTripTime;
		if (typeof rtt !== 'number' || !Number.isFinite(rtt) || rtt < 0) return;
		if (stat.state !== 'succeeded') return;

		if (stat.nominated) {
			if (nominated === null) nominated = rtt;
		} else if (succeeded === null) {
			succeeded = rtt;
		}
	});

	const seconds = nominated ?? succeeded;
	if (seconds === null) return null;
	// WebRTC reports seconds; the UI and Twilio's RTCSample.rtt are both milliseconds.
	return Math.max(0, Math.round(seconds * 1000));
};

/** How much of the far end's audio actually reached this browser. */
export interface InboundAudioSample {
	packetsReceived: number;
	bytesReceived: number;
	/** Chrome-only; null where the browser does not report it. */
	totalAudioEnergy: number | null;
}

/** The subset of `RTCInboundRtpStreamStats` we rely on. */
interface InboundRtpLike {
	type?: string;
	kind?: string;
	mediaType?: string;
	packetsReceived?: number;
	bytesReceived?: number;
	totalAudioEnergy?: number;
}

/**
 * The incoming audio stream's counters, or null when the report has none yet.
 *
 * This is what separates "the call's audio never reached the computer" (network or
 * carrier) from "it arrived and did not come out of the speaker" (output routing) — the
 * question the live audio test exists to answer. `mediaType` is the pre-standard name
 * older Chrome builds still use for `kind`.
 */
export const readInboundAudio = (
	report: StatsReportLike | null | undefined
): InboundAudioSample | null => {
	if (!report || typeof report.forEach !== 'function') return null;
	let sample: InboundAudioSample | null = null;
	report.forEach((value) => {
		const stat = value as InboundRtpLike;
		if (sample || stat?.type !== 'inbound-rtp') return;
		if ((stat.kind ?? stat.mediaType) !== 'audio') return;
		sample = {
			packetsReceived: finiteOr(stat.packetsReceived, 0),
			bytesReceived: finiteOr(stat.bytesReceived, 0),
			totalAudioEnergy:
				typeof stat.totalAudioEnergy === 'number' && Number.isFinite(stat.totalAudioEnergy)
					? stat.totalAudioEnergy
					: null
		};
	});
	return sample;
};

const finiteOr = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback;
