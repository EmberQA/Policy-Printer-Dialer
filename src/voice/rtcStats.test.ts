import {describe, expect, it} from 'vitest';
import {readRttMs} from './rtcStats';

/** An RTCStatsReport is a Map at runtime; only `forEach` is used. */
const report = (stats: Array<Record<string, unknown>>) =>
	new Map(stats.map((stat, index) => [`id${index}`, stat]));

describe('readRttMs', () => {
	it('converts the nominated pair from seconds to milliseconds', () => {
		expect(
			readRttMs(
				report([
					{type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.042}
				])
			)
		).toBe(42);
	});

	// A connection keeps the pairs it tried and lost, and some still carry an RTT from
	// when they were probed. Reporting one of those is a plausible-but-false latency —
	// it looks like a working reading, so nothing downstream flags it.
	it('prefers the nominated pair over other succeeded pairs', () => {
		expect(
			readRttMs(
				report([
					{type: 'candidate-pair', state: 'succeeded', nominated: false, currentRoundTripTime: 0.9},
					{type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.03}
				])
			)
		).toBe(30);
	});

	it('falls back to a succeeded pair when none is flagged nominated', () => {
		// Chrome has shipped versions that leave `nominated` unset on the active pair.
		expect(
			readRttMs(
				report([
					{type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.055}
				])
			)
		).toBe(55);
	});

	it('ignores pairs that never succeeded', () => {
		expect(
			readRttMs(
				report([
					{type: 'candidate-pair', state: 'failed', nominated: true, currentRoundTripTime: 0.5},
					{type: 'candidate-pair', state: 'in-progress', currentRoundTripTime: 0.4}
				])
			)
		).toBeNull();
	});

	it('ignores stat entries that are not candidate pairs', () => {
		expect(
			readRttMs(
				report([
					{type: 'inbound-rtp', currentRoundTripTime: 0.2},
					{type: 'remote-inbound-rtp', roundTripTime: 0.3}
				])
			)
		).toBeNull();
	});

	it('returns null rather than zero when no measurement exists', () => {
		// The chip renders null as "no reading"; a zero would read as a perfect link.
		expect(
			readRttMs(report([{type: 'candidate-pair', state: 'succeeded'}]))
		).toBeNull();
		expect(readRttMs(report([]))).toBeNull();
		expect(readRttMs(null)).toBeNull();
		expect(readRttMs(undefined)).toBeNull();
	});

	it('rejects non-finite and negative measurements', () => {
		expect(
			readRttMs(
				report([
					{type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: Number.NaN},
					{type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: -1}
				])
			)
		).toBeNull();
	});

	it('reports a genuine zero-second measurement as 0ms', () => {
		expect(
			readRttMs(
				report([
					{type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0}
				])
			)
		).toBe(0);
	});
});
