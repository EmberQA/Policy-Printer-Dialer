/** How many flames a state earns based on its one-based rank. */

export type HotStateTier = 0 | 1 | 2 | 3;

export const hotStateTier = (rank: number): HotStateTier => {
	if (!Number.isInteger(rank) || rank < 1) return 0;
	if (rank <= 3) return 3;
	if (rank <= 6) return 2;
	if (rank <= 10) return 1;
	return 0;
};

/** The flames themselves — empty string for a state outside the top ten. */
export const hotStateFlames = (tier: HotStateTier): string =>
	'🔥'.repeat(tier);
