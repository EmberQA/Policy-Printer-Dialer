/**
 * Can this machine actually use the Primary network? (ENG-159 — Subplan 07.)
 *
 * The ticket's complaint is specific — *"certain wifi, phones, chrome tabs"* — and so is
 * the failure behind it: a network that blocks the signaling WebSocket or blocks UDP
 * outright. This module answers that and nothing else. From the ticket, verbatim:
 * *"don't overcook/add unnecessary blocking items. some random bs is going to happen that
 * isn't really a problem, we have the backup (twilio) for a reason."* Every extra check is
 * another chance to false-negative an agent who would have been fine.
 *
 * ─── Three stages, and what each one actually proves ──────────────────────────
 *
 *   signaling     the WSS socket opened. This is the check most likely to fail on
 *                 corporate wifi, VPNs and locked-down Chrome profiles.
 *   registration  the SIP credential registered. Socket open but never ready means the
 *                 path is fine and the credential is not — a provisioning fault, not a
 *                 network one, and it is worth being able to tell them apart afterwards.
 *   ice           we can gather a candidate that leaves the LAN. Host-only means neither
 *                 STUN nor TURN was reachable, so media has nowhere to go.
 *
 * The two halves run CONCURRENTLY: ICE gathering needs no token and the client stage needs
 * no peer connection, so serializing them would double the worst-case delay in front of an
 * agent's dialer for nothing.
 *
 * ─── What is deliberately NOT here ────────────────────────────────────────────
 *
 * THE MIC IS NOT A STAGE. `useDevice` already requests it at boot and `armAudio()`
 * re-requests it on the "Go ready" gesture. It is also not a fallback trigger: a blocked
 * mic breaks the Fallback network exactly as badly, so switching carriers over one would
 * hide a user-fixable problem behind a carrier switch.
 *
 * THE LOOPBACK CALL IS NOT HERE, and that was a decision rather than an omission. The
 * SDK's `PreCallDiagnosis.run` places a REAL billed call to a TeXML application number and
 * — read the shipped source, not the docs — resolves only when the far end hangs up, with
 * no timeout of its own and no hangup of its own. Wiring it up means a dedicated probe DID,
 * a branch in the inbound TeXML handler that says something and hangs up, an Outbound Voice
 * Profile on the credential connection (we only ever REST-originate today, so browser
 * dialing is an unexercised path), our own timeout wrapper, and a billed call on every
 * agent's every boot. Weighed against the stages above — which already catch blocked WSS
 * and blocked UDP, the two things that actually happen — it was not worth it. If it is ever
 * added, it belongs behind this same `ProbeReport` and nothing above it needs to change.
 */

import {TelnyxRTC, TELNYX_ICE_SERVERS} from '@telnyx/webrtc';

export type ProbeStage = 'signaling' | 'registration' | 'ice';

/**
 * The best candidate the browser could gather.
 *
 * `srflx` we reached a STUN server, so UDP leaves this network.
 * `relay` UDP is blocked but TURN is reachable — usually still works, and predicts
 *         mediocre audio rather than none. NOT on its own a reason to fall back.
 * `host`  neither. Nothing but LAN-local candidates, so media has no path to a peer.
 * `none`  not even a host candidate, which means the peer connection never got going.
 */
export type IceType = 'srflx' | 'relay' | 'host' | 'none';

export interface ProbeReport {
	passed: boolean;
	/** Where it died. Null on a pass. This is the field the rollout query lives on: after
	 *  a week it answers "is Primary failing on signaling or on media, and for whom". */
	failedStage: ProbeStage | null;
	iceType: IceType | null;
	/** Per-stage wall time in ms — the cheap way to notice "it passes, but it takes 9s". */
	timings: Partial<Record<ProbeStage, number>>;
	/** Browser/OS patterns are half the answer to "for whom". */
	userAgent: string;
	/**
	 * Which signaling edge this run tested. Null means the default host, i.e. Telnyx's own
	 * geo routing chose. Recorded because "passed" and "passed only once pinned" are
	 * different facts, and the second one is the whole reason the pin exists.
	 */
	region: string | null;
	error?: string;
}

/**
 * Budgets. Deliberately tight: this sits in front of an agent's dialer at boot, and a
 * network bad enough to need the full budget is a network we are about to fall back from
 * anyway. Worst case is the larger of the two concurrent halves, not their sum.
 */
const SIGNALING_TIMEOUT_MS = 6_000;
const REGISTRATION_TIMEOUT_MS = 6_000;
const ICE_TIMEOUT_MS = 4_000;

/* -------------------------------------------------------------------------- */
/* Pure helpers — the decisions, separated from the IO that feeds them.        */
/* -------------------------------------------------------------------------- */

/**
 * Read a candidate's type. `RTCIceCandidate.type` is the modern field, but it is absent on
 * older Safari and on the raw SDP-line shape, and a probe that silently classified every
 * candidate as unknown would fall EVERY agent back on that browser — so parse the
 * `typ <x>` token as well rather than trusting one accessor.
 */
export const candidateType = (candidate: {
	type?: string | null;
	candidate?: string | null;
}): string | null => {
	if (candidate.type) return candidate.type;
	const match = /(?:^|\s)typ\s+(\w+)/.exec(candidate.candidate ?? '');
	return match ? match[1] : null;
};

/** Best-available wins: a network with both srflx and relay is a UDP network. */
export const classifyCandidates = (types: Array<string | null>): IceType => {
	if (types.includes('srflx') || types.includes('prflx')) return 'srflx';
	if (types.includes('relay')) return 'relay';
	if (types.includes('host')) return 'host';
	return 'none';
};

/**
 * Relay-only PASSES. It is the classic corporate-wifi shape, TURN-relayed audio is
 * usually fine, and falling back on it alone would move a large share of a normal office
 * onto the expensive carrier for a problem they do not have.
 */
export const iceIsUsable = (ice: IceType): boolean =>
	ice === 'srflx' || ice === 'relay';

/**
 * The verdict, given both halves. Client failures outrank ICE: if the socket never opened
 * we know why, and reporting `ice` there would send everyone chasing media on what is a
 * blocked-port problem.
 */
export const probeVerdict = (input: {
	socketOpened: boolean;
	registered: boolean;
	iceType: IceType;
}): {passed: boolean; failedStage: ProbeStage | null} => {
	if (!input.socketOpened) return {passed: false, failedStage: 'signaling'};
	if (!input.registered) return {passed: false, failedStage: 'registration'};
	if (!iceIsUsable(input.iceType)) return {passed: false, failedStage: 'ice'};
	return {passed: true, failedStage: null};
};

/* -------------------------------------------------------------------------- */
/* IO — injectable, so the state machine above is testable without a network.  */
/* -------------------------------------------------------------------------- */

/** The slice of the client stage the probe needs, so tests need no SDK and no socket. */
export interface ProbeClientResult {
	socketOpened: boolean;
	registered: boolean;
	error?: string;
	socketMs?: number;
	readyMs?: number;
}

export interface ProbeDeps {
	runClientStage: (
		token: string,
		region?: string
	) => Promise<ProbeClientResult>;
	runIceStage: () => Promise<{iceType: IceType; ms: number}>;
	userAgent: string;
}

/** The Telnyx ICE servers the real client uses, as an array. Probing anything else would
 *  test a path the dialer never takes. */
export const telnyxIceServers = (): RTCIceServer[] =>
	Object.values(TELNYX_ICE_SERVERS) as RTCIceServer[];

/**
 * Bring a THROWAWAY client up far enough to know whether signaling and registration work,
 * then drop it.
 *
 * ⚠️ Never the live `VoiceTransport`. Subplan 05's transport is carrying the agent's actual
 * calls; this one exists for a few seconds and takes none.
 *
 * It deliberately does NOT call `enableMicrophone()` or set `remoteElement`: it never
 * answers anything, and requesting the mic here would race the boot request in `useDevice`
 * for no gain.
 *
 * `region` pins the SIGNALING host and nothing else — the SDK rewrites
 * `wss://rtc.telnyx.com` to `wss://<region>.rtc.telnyx.com`. It is spread in rather than
 * passed as `region: undefined` so the unpinned path stays byte-identical to what shipped.
 */
const defaultClientStage = async (
	token: string,
	region?: string
): Promise<ProbeClientResult> => {
	const client = new TelnyxRTC({
		login_token: token,
		...(region ? {region} : {})
	});
	const startedAt = performance.now();
	let socketOpened = false;
	let registered = false;
	let socketMs: number | undefined;
	let readyMs: number | undefined;
	let error: string | undefined;

	const socket = deferred<void>();
	const ready = deferred<void>();

	client.on('telnyx.socket.open', () => {
		socketOpened = true;
		socketMs = Math.round(performance.now() - startedAt);
		socket.resolve();
	});
	client.on('telnyx.ready', () => {
		// Ready implies the socket opened, even if we somehow missed the earlier event.
		socketOpened = true;
		registered = true;
		readyMs = Math.round(performance.now() - startedAt);
		socket.resolve();
		ready.resolve();
	});
	client.on('telnyx.error', (event: unknown) => {
		const message = (event as {error?: {message?: string}})?.error?.message;
		if (message) error = message;
	});

	try {
		await client.connect();
		await withTimeout(socket.promise, SIGNALING_TIMEOUT_MS);
		await withTimeout(ready.promise, REGISTRATION_TIMEOUT_MS);
	} catch (e) {
		// A timeout here is the ANSWER, not a fault — `socketOpened`/`registered` already
		// say which stage we got to. Only keep the message if nothing better arrived.
		if (!error && e instanceof Error && e.message !== 'timeout') error = e.message;
	} finally {
		try {
			await client.disconnect();
		} catch {
			/* the socket may never have opened */
		}
	}

	return {socketOpened, registered, error, socketMs, readyMs};
};

/**
 * Gather ICE candidates against the same servers the real client uses and classify the
 * best one. A data channel is created purely to give the connection something to gather
 * for — without it, `createOffer` produces no media section and no candidates.
 */
const defaultIceStage = async (): Promise<{iceType: IceType; ms: number}> => {
	const startedAt = performance.now();
	const pc = new RTCPeerConnection({iceServers: telnyxIceServers()});
	const types: Array<string | null> = [];
	const done = deferred<void>();

	try {
		pc.createDataChannel('probe');
		pc.onicecandidate = (event) => {
			// A null candidate is the end-of-gathering sentinel.
			if (!event.candidate) {
				done.resolve();
				return;
			}
			types.push(candidateType(event.candidate));
			// Stop the moment we have the best answer available — waiting for the full
			// gather adds seconds in front of the dialer to learn nothing more.
			if (classifyCandidates(types) === 'srflx') done.resolve();
		};
		pc.onicegatheringstatechange = () => {
			if (pc.iceGatheringState === 'complete') done.resolve();
		};
		await pc.setLocalDescription(await pc.createOffer());
		await withTimeout(done.promise, ICE_TIMEOUT_MS).catch(() => undefined);
	} catch {
		/* whatever we gathered before the failure is still the honest answer */
	} finally {
		try {
			pc.close();
		} catch {
			/* already closed */
		}
	}

	return {
		iceType: classifyCandidates(types),
		ms: Math.round(performance.now() - startedAt)
	};
};

/**
 * Run the probe. Resolves to a verdict; it does NOT throw, because every caller's next
 * move on a thrown error would be to treat it as a failure anyway.
 *
 * `region` reaches the CLIENT STAGE ONLY, and that is a fact about what a region can do
 * rather than an omission. It rewrites the signaling host; it has no bearing on ICE, whose
 * servers are the fixed global `TELNYX_ICE_SERVERS` list and which needs no token. Feeding
 * it to the ICE stage would imply a pinned re-probe could recover a `host`-only network,
 * and it cannot — an `ice` failure fails identically on every edge.
 */
export const runNetworkProbe = async (
	token: string,
	deps: Partial<ProbeDeps> = {},
	region?: string
): Promise<ProbeReport> => {
	const runClientStage = deps.runClientStage ?? defaultClientStage;
	const runIceStage = deps.runIceStage ?? defaultIceStage;
	const userAgent =
		deps.userAgent ??
		(typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent);

	// Concurrent by design: the halves are independent, and an agent waiting on their
	// dialer should wait for the slower one, not for both in turn.
	const [client, ice] = await Promise.all([
		runClientStage(token, region).catch(
			(e): ProbeClientResult => ({
				socketOpened: false,
				registered: false,
				error: e instanceof Error ? e.message : String(e)
			})
		),
		runIceStage().catch(() => ({iceType: 'none' as IceType, ms: 0}))
	]);

	const verdict = probeVerdict({
		socketOpened: client.socketOpened,
		registered: client.registered,
		iceType: ice.iceType
	});

	const timings: Partial<Record<ProbeStage, number>> = {ice: ice.ms};
	if (client.socketMs !== undefined) timings.signaling = client.socketMs;
	if (client.readyMs !== undefined) timings.registration = client.readyMs;

	return {
		passed: verdict.passed,
		failedStage: verdict.failedStage,
		iceType: ice.iceType,
		timings,
		userAgent,
		region: region ?? null,
		...(client.error ? {error: client.error} : {})
	};
};

/* -------------------------------------------------------------------------- */

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return {promise, resolve};
};

/** Rejects with a plain `timeout` so the caller can tell "we ran out of budget" from
 *  "something actually broke". */
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timer);
				reject(error);
			}
		);
	});
