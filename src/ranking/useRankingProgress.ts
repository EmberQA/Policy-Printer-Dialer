import {useCallback, useEffect, useRef, useState} from 'react';
import {fetchRankingProgress} from '@/lib/api';
import {getUser} from '@/auth/session';
import {getRankBadgeSrc} from './RankBadge';
import {
	isRankPromotion,
	POLICY_PRINTER_RANK_ORDER,
	rankIdentity,
	rankIdentityFromKey
} from './rankPromotion';
import type {
	PolicyPrinterRankKey,
	RankingProgress,
	RankPromotion
} from './types';

const LAST_RANK_STORAGE_PREFIX = 'policy-printer-ranking:last-rank:';

const readLastRank = (userId: string): PolicyPrinterRankKey | null => {
	try {
		const value = localStorage.getItem(`${LAST_RANK_STORAGE_PREFIX}${userId}`);
		return POLICY_PRINTER_RANK_ORDER.includes(value as PolicyPrinterRankKey)
			? (value as PolicyPrinterRankKey)
			: null;
	} catch {
		return null;
	}
};

const writeLastRank = (userId: string, rank: PolicyPrinterRankKey) => {
	try {
		localStorage.setItem(`${LAST_RANK_STORAGE_PREFIX}${userId}`, rank);
	} catch {
		// Promotion detection still works for the current page without storage.
	}
};

export function useRankingProgress() {
	const [progress, setProgress] = useState<RankingProgress | null>(null);
	const [promotion, setPromotion] = useState<RankPromotion | null>(null);
	const previousRankRef = useRef<PolicyPrinterRankKey | null>(null);
	const userId = getUser()?.user_id ?? 'unknown-user';

	const refresh = useCallback(async () => {
		try {
			const response = await fetchRankingProgress();
			if (response.statusCode === 'SP100' && response.ranking_enabled === false) {
				setProgress(null);
				return;
			}
			if (response.statusCode === 'SP100' && response.progress) {
				const next = response.progress;
				const nextRank = next.current_rank.key;
				const previousRank = previousRankRef.current ?? readLastRank(userId);
				if (previousRank && isRankPromotion(previousRank, nextRank)) {
					setPromotion({
						previous_rank: rankIdentityFromKey(previousRank),
						current_rank: rankIdentity(next.current_rank)
					});
				}
				previousRankRef.current = nextRank;
				writeLastRank(userId, nextRank);
				setProgress(next);
			}
		} catch {
			// Ranking is non-critical to calling. Keep the last successful value while
			// the backend or network is temporarily unavailable.
		}
	}, [userId]);

	useEffect(() => {
		previousRankRef.current = null;
		setPromotion(null);
	}, [userId]);

	useEffect(() => {
		void refresh();
		const interval = window.setInterval(() => {
			if (document.visibilityState === 'visible') void refresh();
		}, 30_000);
		const onFocus = () => void refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('focus', onFocus);
		};
	}, [refresh]);

	useEffect(() => {
		const nextRankKey = progress?.next_rank?.image_key;
		if (!nextRankKey) return;
		const image = new Image();
		image.src = getRankBadgeSrc(nextRankKey);
		void image.decode?.().catch(() => undefined);
	}, [progress?.next_rank?.image_key]);

	const dismissPromotion = useCallback(() => setPromotion(null), []);

	return {progress, promotion, dismissPromotion};
}
