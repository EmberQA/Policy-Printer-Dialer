import {describe, expect, it, vi} from 'vitest';
import {
	candidateType,
	classifyCandidates,
	iceIsUsable,
	probeVerdict,
	runNetworkProbe,
	type IceType,
	type ProbeClientResult
} from './networkProbe';

describe('candidateType', () => {
	it('reads the modern accessor when it is there', () => {
		expect(candidateType({type: 'srflx'})).toBe('srflx');
	});

	// Older Safari does not populate `.type`. Without the SDP fallback every candidate
	// classifies as unknown, the probe reports host-only, and EVERY agent on that browser
	// is falsely demoted — a browser-wide outage that looks like a network problem.
	it('falls back to the SDP typ token when the accessor is missing', () => {
		expect(
			candidateType({
				candidate:
					'candidate:1 1 udp 1686052607 203.0.113.4 54321 typ srflx raddr 10.0.0.2 rport 54321'
			})
		).toBe('srflx');
	});

	it('returns null when neither is available', () => {
		expect(candidateType({})).toBeNull();
	});
});

describe('classifyCandidates', () => {
	it('prefers a server-reflexive candidate: UDP leaves this network', () => {
		expect(classifyCandidates(['host', 'relay', 'srflx'])).toBe('srflx');
	});

	it('treats a peer-reflexive candidate as proof of the same thing', () => {
		expect(classifyCandidates(['host', 'prflx'])).toBe('srflx');
	});

	it('reports relay when TURN is the only way out', () => {
		expect(classifyCandidates(['host', 'relay'])).toBe('relay');
	});

	it('reports host when nothing left the LAN', () => {
		expect(classifyCandidates(['host', null])).toBe('host');
	});

	it('reports none when the connection gathered nothing at all', () => {
		expect(classifyCandidates([])).toBe('none');
	});
});

describe('iceIsUsable', () => {
	// The classic corporate-wifi shape. TURN-relayed audio is usually fine, and falling
	// back on relay alone would move a large share of a normal office onto the expensive
	// carrier for a problem they do not have.
	it('passes relay-only', () => {
		expect(iceIsUsable('relay')).toBe(true);
	});

	it.each<IceType>(['host', 'none'])('fails %s', (ice) => {
		expect(iceIsUsable(ice)).toBe(false);
	});
});

describe('probeVerdict', () => {
	it('passes when signaling, registration and media all check out', () => {
		expect(
			probeVerdict({socketOpened: true, registered: true, iceType: 'srflx'})
		).toEqual({passed: true, failedStage: null});
	});

	// The blocked-WSS case the ticket is actually about.
	it('blames signaling when the socket never opened', () => {
		expect(
			probeVerdict({socketOpened: false, registered: false, iceType: 'none'})
		).toEqual({passed: false, failedStage: 'signaling'});
	});

	// Socket open but never ready is a credential fault, not a network one. Being able to
	// tell them apart afterwards is the entire reason `failed_stage` is recorded.
	it('blames registration when the socket opened but the client never became ready', () => {
		expect(
			probeVerdict({socketOpened: true, registered: false, iceType: 'srflx'})
		).toEqual({passed: false, failedStage: 'registration'});
	});

	it('blames ice when signaling is fine but nothing leaves the LAN', () => {
		expect(
			probeVerdict({socketOpened: true, registered: true, iceType: 'host'})
		).toEqual({passed: false, failedStage: 'ice'});
	});

	// A signaling failure usually drags ICE down with it. Reporting `ice` there would send
	// whoever reads the rollout numbers chasing media on a blocked-port problem.
	it('reports the earliest stage when several fail at once', () => {
		expect(
			probeVerdict({socketOpened: false, registered: false, iceType: 'host'})
				.failedStage
		).toBe('signaling');
	});
});

describe('runNetworkProbe', () => {
	const deps = (
		client: Partial<ProbeClientResult>,
		iceType: IceType = 'srflx'
	) => ({
		runClientStage: async (): Promise<ProbeClientResult> => ({
			socketOpened: true,
			registered: true,
			...client
		}),
		runIceStage: async () => ({iceType, ms: 12}),
		userAgent: 'test-agent/1.0'
	});

	it('returns a pass with the diagnostics a rollout query needs', async () => {
		const report = await runNetworkProbe('tok', deps({socketMs: 40, readyMs: 90}));

		expect(report.passed).toBe(true);
		expect(report.iceType).toBe('srflx');
		expect(report.timings).toEqual({signaling: 40, registration: 90, ice: 12});
		expect(report.userAgent).toBe('test-agent/1.0');
	});

	it('carries the failed stage through on a failure', async () => {
		const report = await runNetworkProbe(
			'tok',
			deps({socketOpened: false, registered: false, error: 'ws refused'}, 'none')
		);

		expect(report).toMatchObject({
			passed: false,
			failedStage: 'signaling',
			error: 'ws refused'
		});
	});

	// A throwing stage is a failing stage. If the probe rethrew, the exception would land
	// in the middle of a dialer boot — a far worse outcome than a missed re-test.
	it('treats a thrown client stage as a signaling failure rather than propagating', async () => {
		const report = await runNetworkProbe('tok', {
			runClientStage: async () => {
				throw new Error('boom');
			},
			runIceStage: async () => ({iceType: 'srflx', ms: 5}),
			userAgent: 'ua'
		});

		expect(report.passed).toBe(false);
		expect(report.failedStage).toBe('signaling');
	});

	it('treats a thrown ice stage as no candidates rather than propagating', async () => {
		const report = await runNetworkProbe('tok', {
			runClientStage: async () => ({socketOpened: true, registered: true}),
			runIceStage: async () => {
				throw new Error('no RTCPeerConnection');
			},
			userAgent: 'ua'
		});

		expect(report).toMatchObject({passed: false, failedStage: 'ice', iceType: 'none'});
	});

	// Serializing the halves would double the worst-case delay in front of an agent's
	// dialer to learn nothing extra — they share no input.
	it('runs the client and ice stages concurrently', async () => {
		let clientStarted = false;
		let iceSawClientRunning = false;

		await runNetworkProbe('tok', {
			runClientStage: async () => {
				clientStarted = true;
				await new Promise((r) => setTimeout(r, 5));
				return {socketOpened: true, registered: true};
			},
			runIceStage: async () => {
				iceSawClientRunning = clientStarted;
				return {iceType: 'srflx', ms: 1};
			},
			userAgent: 'ua'
		});

		expect(iceSawClientRunning).toBe(true);
	});

	/**
	 * A region rewrites the SIGNALING host and nothing else. It reaching the ICE stage would
	 * imply a pinned re-probe could recover a `host`-only network — it cannot, because those
	 * servers are the fixed global `TELNYX_ICE_SERVERS` list and the stage takes no token.
	 */
	it('forwards the region to the client stage only', async () => {
		const runClientStage = vi.fn(async () => ({
			socketOpened: true,
			registered: true
		}));
		const runIceStage = vi.fn(async () => ({iceType: 'srflx' as const, ms: 1}));

		await runNetworkProbe(
			'tok',
			{runClientStage, runIceStage, userAgent: 'ua'},
			'us-central'
		);

		expect(runClientStage).toHaveBeenCalledWith('tok', 'us-central');
		expect(runIceStage).toHaveBeenCalledWith();
	});

	// The unpinned path must stay exactly what shipped.
	it('passes no region when none was asked for', async () => {
		const runClientStage = vi.fn(async () => ({
			socketOpened: true,
			registered: true
		}));

		const report = await runNetworkProbe('tok', {
			runClientStage,
			runIceStage: async () => ({iceType: 'srflx', ms: 1}),
			userAgent: 'ua'
		});

		expect(runClientStage).toHaveBeenCalledWith('tok', undefined);
		expect(report.region).toBeNull();
	});

	// The recorded row has to say which edge was tested, or "passed" and "passed only once
	// pinned" are indistinguishable afterwards.
	it('reports the region it tested', async () => {
		const report = await runNetworkProbe(
			'tok',
			{
				runClientStage: async () => ({socketOpened: true, registered: true}),
				runIceStage: async () => ({iceType: 'srflx', ms: 1}),
				userAgent: 'ua'
			},
			'us-central'
		);

		expect(report).toMatchObject({passed: true, region: 'us-central'});
	});
});
