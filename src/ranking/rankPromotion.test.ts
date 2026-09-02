import {describe, expect, it} from 'vitest';
import {
	isRankPromotion,
	isRankPromotionBlocked,
	rankIdentityFromKey
} from './rankPromotion';

describe('rank promotion detection', () => {
	it('only treats upward hierarchy movement as a promotion', () => {
		expect(isRankPromotion('recruit_1', 'recruit_2')).toBe(true);
		expect(isRankPromotion('recruit_1', 'master_closer_3')).toBe(true);
		expect(isRankPromotion('closer_2', 'closer_2')).toBe(false);
		expect(isRankPromotion('top_closer_1', 'closer_3')).toBe(false);
	});

	it('recovers the display identity for a stored rank key', () => {
		expect(rankIdentityFromKey('policy_printer')).toEqual({
			key: 'policy_printer',
			title: 'Policy Printer',
			image_key: 'policy_printer'
		});
	});

	it('blocks promotion visuals while ready or on a call', () => {
		expect(isRankPromotionBlocked(true, 'paused')).toBe(true);
		expect(isRankPromotionBlocked(false, 'ready')).toBe(true);
		expect(isRankPromotionBlocked(true, 'ready')).toBe(true);
		expect(isRankPromotionBlocked(false, 'paused')).toBe(false);
		expect(isRankPromotionBlocked(false, null)).toBe(false);
	});
});
