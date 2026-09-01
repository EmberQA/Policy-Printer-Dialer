import {useCallback, useEffect, useState} from 'react';
import {fetchRankingProgress} from '@/lib/api';
import type {RankingProgress} from './types';

export function useRankingProgress() {
	const [progress, setProgress] = useState<RankingProgress | null>(null);

	const refresh = useCallback(async () => {
		try {
			const response = await fetchRankingProgress();
			if (response.statusCode === 'SP100' && response.progress) {
				setProgress(response.progress);
			}
		} catch {
			// Ranking is non-critical to calling. Keep the last successful value while
			// the backend or network is temporarily unavailable.
		}
	}, []);

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

	return progress;
}
