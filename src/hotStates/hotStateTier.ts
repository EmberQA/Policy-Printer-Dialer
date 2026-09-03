/**
 * How many flames a state earns, relative to the agent's hottest state.
 *
 * Pure and count-relative rather than threshold-based: an agent taking 200 calls a
 * week and one taking 12 should both see a meaningful spread instead of everything
 * or nothing lighting up. The top state always burns at full tier.
 */

export type HotStateTier = 0 | 1 | 2 | 3;

export const hotStateTier = (
	callCount: number,
	topCallCount: number
): HotStateTier => {
	if (
		!Number.isFinite(callCount) ||
		!Number.isFinite(topCallCount) ||
		callCount <= 0 ||
		topCallCount <= 0
	) {
		return 0;
	}
	const ratio = callCount / topCallCount;
	if (ratio >= 1) return 3;
	if (ratio >= 0.6) return 2;
	if (ratio >= 0.3) return 1;
	return 0;
};

/** The flames themselves — empty string for a state that is merely present. */
export const hotStateFlames = (tier: HotStateTier): string =>
	'🔥'.repeat(tier);
