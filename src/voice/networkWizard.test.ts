/**
 * ENG-159 Subplan 07 — the network wizard.
 *
 * Two failure modes are worth more than all the others put together, and most of this
 * file exists for them.
 *
 * 1. A ONE-WAY DRAIN. If promotion never fires, one bad afternoon on hotel wifi moves an
 *    agent to the expensive carrier permanently. It is silent and it only ratchets one
 *    way, so nothing would ever surface it.
 *
 * 2. PING-PONG. If promotion fires too eagerly — on every network blip, or after a retry
 *    loop that tries until it passes — a flapping wifi swings an agent back and forth,
 *    each swing costing a Retreaver re-point and a window where our database and Retreaver
 *    disagree about which number to dial.
 *
 * The gate and the retry asymmetry are what hold those apart, so they are tested as rules
 * rather than as incidental behaviour.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ProbeReport} from './networkProbe';
import {
	readWizardMarker,
	runNetworkWizard,
	wizardPlan,
	type WizardConditions
} from './networkWizard';

const conditions = (
	overrides: Partial<WizardConditions> = {}
): WizardConditions => ({
	provider: 'telnyx',
	providerLocked: false,
	trigger: 'boot',
	hasActiveCall: false,
	demotedThisSession: false,
	promotedThisSession: false,
	...overrides
});

const pass = (): ProbeReport => ({
	passed: true,
	failedStage: null,
	iceType: 'srflx',
	timings: {signaling: 30, registration: 80, ice: 20},
	userAgent: 'ua'
});

const fail = (stage: ProbeReport['failedStage'] = 'signaling'): ProbeReport => ({
	passed: false,
	failedStage: stage,
	iceType: 'none',
	timings: {ice: 4000},
	userAgent: 'ua'
});

/** Bare `sessionStorage`, matching the outbound-attempt pattern already in useDevice. */
const stubSessionStorage = () => {
	const store = new Map<string, string>();
	vi.stubGlobal('sessionStorage', {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key)
	});
	return store;
};

const io = (overrides: Record<string, unknown> = {}) => ({
	getProbeToken: vi.fn(async () => 'probe-token'),
	runProbe: vi.fn(async () => pass()),
	postFallback: vi.fn(async () => true),
	recordTest: vi.fn(async () => undefined),
	// No real waiting: the retry delay is a product decision, not something to sit through.
	delay: vi.fn(async () => undefined),
	...overrides
});

beforeEach(() => {
	stubSessionStorage();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('wizardPlan — who the wizard runs for', () => {
	it('tests an agent who is on the Primary network', () => {
		expect(wizardPlan(conditions())).toBe('test-primary');
	});

	// THE WHOLE POINT OF SUBPLAN 07. Under "runs for Primary agents only", an agent who
	// falls back stops qualifying and can never come back.
	it('tests an agent on Fallback for promotion at boot', () => {
		expect(wizardPlan(conditions({provider: 'twilio'}))).toBe('test-promotion');
	});

	// Promotion is login-only. Running it on every network blip is how a flapping wifi
	// swings an agent between carriers.
	it('does NOT promote on a network change', () => {
		expect(
			wizardPlan(conditions({provider: 'twilio', trigger: 'network-change'}))
		).toBeNull();
	});

	// Demotion answers "this agent is broken RIGHT NOW", which is exactly what a network
	// change reports — so it must run then.
	it('DOES re-test the Primary network on a network change', () => {
		expect(wizardPlan(conditions({trigger: 'network-change'}))).toBe(
			'test-primary'
		);
	});

	it.each([
		['on Primary', {provider: 'telnyx' as const}],
		['on Fallback', {provider: 'twilio' as const}]
	])('refuses to run for an administrator-pinned agent %s', (_label, where) => {
		expect(wizardPlan(conditions({...where, providerLocked: true}))).toBeNull();
	});

	it.each([
		['on Primary', {provider: 'telnyx' as const}],
		['on Fallback', {provider: 'twilio' as const}]
	])('never moves a live agent mid-call %s', (_label, where) => {
		expect(wizardPlan(conditions({...where, hasActiveCall: true}))).toBeNull();
	});

	// The marker is load-bearing in BOTH directions: it is what stops one boot's demotion
	// being undone by the same boot's promotion check.
	it('does not promote in a session that already demoted', () => {
		expect(
			wizardPlan(conditions({provider: 'twilio', demotedThisSession: true}))
		).toBeNull();
	});

	it('does not promote twice in one session', () => {
		expect(
			wizardPlan(conditions({provider: 'twilio', promotedThisSession: true}))
		).toBeNull();
	});

	it('does not re-test Primary in a session that already demoted', () => {
		expect(wizardPlan(conditions({demotedThisSession: true}))).toBeNull();
	});
});

describe('demotion', () => {
	it('leaves a passing agent alone and records the pass', async () => {
		const deps = io();

		const outcome = await runNetworkWizard(conditions(), 'active-token', deps);

		expect(outcome).toEqual({ran: true, direction: 'stay', flippedTo: null});
		expect(deps.postFallback).not.toHaveBeenCalled();
		expect(deps.recordTest).toHaveBeenCalledWith(
			expect.objectContaining({passed: true, direction: 'stay'})
		);
	});

	// The demotion path costs no extra round trip: the token the caller already minted for
	// the agent's current carrier is exactly the right thing to test with.
	it('tests with the token the caller already has', async () => {
		const deps = io();

		await runNetworkWizard(conditions(), 'active-token', deps);

		expect(deps.runProbe).toHaveBeenCalledWith('active-token');
		expect(deps.getProbeToken).not.toHaveBeenCalled();
	});

	// A retry exists to avoid acting on a transient. Here the risk is acting too eagerly —
	// moving a working agent off Primary over one blip.
	it('retries once and stays put when the second attempt passes', async () => {
		const deps = io({
			runProbe: vi
				.fn()
				.mockResolvedValueOnce(fail('ice'))
				.mockResolvedValueOnce(pass())
		});

		const outcome = await runNetworkWizard(conditions(), 'tok', deps);

		expect(outcome.flippedTo).toBeNull();
		expect(deps.runProbe).toHaveBeenCalledTimes(2);
		// The flap is the early warning that this agent is about to start bouncing, and it
		// leaves no other trace anywhere.
		expect(deps.recordTest).toHaveBeenCalledWith(
			expect.objectContaining({
				passed: true,
				direction: 'stay',
				detail: expect.objectContaining({flapped: true, first_failed_stage: 'ice'})
			})
		);
	});

	it('falls back after two failures, carrying the failed stage', async () => {
		const deps = io({runProbe: vi.fn(async () => fail('signaling'))});

		const outcome = await runNetworkWizard(conditions(), 'tok', deps);

		expect(outcome).toEqual({
			ran: true,
			direction: 'demote',
			flippedTo: 'twilio'
		});
		expect(deps.postFallback).toHaveBeenCalledWith(
			'twilio',
			expect.objectContaining({direction: 'demote', failed_stage: 'signaling'})
		);
	});

	// The flip writes its own diagnostic carrying this detail as context. A second row here
	// would double-count every demotion in the rollout numbers.
	it('does not separately record an outcome that ended in a flip', async () => {
		const deps = io({runProbe: vi.fn(async () => fail())});

		await runNetworkWizard(conditions(), 'tok', deps);

		expect(deps.recordTest).not.toHaveBeenCalled();
	});

	it('marks the session so the same boot cannot promote back', async () => {
		const deps = io({runProbe: vi.fn(async () => fail())});

		await runNetworkWizard(conditions(), 'tok', deps);

		expect(readWizardMarker().demoted).toBe(true);
	});

	// A refused flip (the agent took a call in the meantime, or an admin pinned them
	// between the probe and the post) must NOT leave a marker claiming they moved.
	it('does not mark the session when the flip was refused', async () => {
		const deps = io({
			runProbe: vi.fn(async () => fail()),
			postFallback: vi.fn(async () => false)
		});

		const outcome = await runNetworkWizard(conditions(), 'tok', deps);

		expect(outcome.flippedTo).toBeNull();
		expect(readWizardMarker().demoted).toBeUndefined();
	});
});

describe('promotion', () => {
	const onFallback = conditions({provider: 'twilio'});

	it('promotes an agent whose network now passes', async () => {
		const deps = io();

		const outcome = await runNetworkWizard(onFallback, 'twilio-token', deps);

		expect(outcome).toEqual({
			ran: true,
			direction: 'promote',
			flippedTo: 'telnyx'
		});
		expect(deps.postFallback).toHaveBeenCalledWith(
			'telnyx',
			expect.objectContaining({direction: 'promote'})
		);
	});

	// `/voice/token` mints against the ACTIVE carrier, so the agent's own token is a
	// Fallback one and cannot test Primary. Testing with it would measure the carrier they
	// are already on and promote on the strength of it.
	it('tests with the probe token, never the active-carrier one', async () => {
		const deps = io();

		await runNetworkWizard(onFallback, 'twilio-token', deps);

		expect(deps.runProbe).toHaveBeenCalledWith('probe-token');
		expect(deps.runProbe).not.toHaveBeenCalledWith('twilio-token');
	});

	// The refusal IS the eligibility answer: already on Primary, administrator-pinned, or
	// never provisioned on Primary. It is the ordinary answer for most agents, so it is
	// not an event and must not write a row per boot for the whole fleet.
	it('stops silently when the backend says this agent is not a candidate', async () => {
		const deps = io({getProbeToken: vi.fn(async () => null)});

		const outcome = await runNetworkWizard(onFallback, 'tok', deps);

		expect(outcome).toEqual({ran: false, direction: null, flippedTo: null});
		expect(deps.runProbe).not.toHaveBeenCalled();
		expect(deps.recordTest).not.toHaveBeenCalled();
	});

	// THE RETRY ASYMMETRY. Retrying a promotion means "keep going until it passes", which
	// is precisely how you promote an agent whose network is marginal — and they will be
	// demoted again within the hour, at the cost of two Retreaver re-points.
	it('does NOT retry a failed probe', async () => {
		const deps = io({runProbe: vi.fn(async () => fail('ice'))});

		const outcome = await runNetworkWizard(onFallback, 'tok', deps);

		expect(deps.runProbe).toHaveBeenCalledTimes(1);
		expect(deps.postFallback).not.toHaveBeenCalled();
		expect(outcome.flippedTo).toBeNull();
	});

	// The agent stays on Fallback and nothing else changes, so this row is the only
	// evidence anywhere that they are still stuck.
	it('records a failed promotion so a stuck agent is visible', async () => {
		const deps = io({runProbe: vi.fn(async () => fail('ice'))});

		await runNetworkWizard(onFallback, 'tok', deps);

		expect(deps.recordTest).toHaveBeenCalledWith(
			expect.objectContaining({
				passed: false,
				direction: 'promote',
				failedStage: 'ice'
			})
		);
	});

	it('marks the session so a promoted agent is not re-tested', async () => {
		await runNetworkWizard(onFallback, 'tok', io());

		expect(readWizardMarker().promoted).toBe(true);
	});
});

describe('the gate is enforced, not merely advertised', () => {
	it.each([
		['pinned', conditions({providerLocked: true})],
		['mid-call', conditions({hasActiveCall: true})],
		['already demoted', conditions({demotedThisSession: true})]
	])('runs nothing at all when %s', async (_label, where) => {
		const deps = io();

		const outcome = await runNetworkWizard(where, 'tok', deps);

		expect(outcome.ran).toBe(false);
		expect(deps.runProbe).not.toHaveBeenCalled();
		expect(deps.getProbeToken).not.toHaveBeenCalled();
		expect(deps.postFallback).not.toHaveBeenCalled();
	});

	// The wizard sits in front of a dialer boot. A throw here would take out the softphone
	// entirely — far worse than a missed re-test.
	it('swallows a thrown dependency and leaves the agent where they are', async () => {
		const deps = io({
			runProbe: vi.fn(async () => {
				throw new Error('probe exploded');
			})
		});

		const outcome = await runNetworkWizard(conditions(), 'tok', deps);

		expect(outcome).toEqual({ran: false, direction: null, flippedTo: null});
		expect(deps.postFallback).not.toHaveBeenCalled();
	});
});
