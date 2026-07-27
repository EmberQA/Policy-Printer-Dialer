import type {DialerDisposition} from '@/lib/api';

export interface SavedDispositionFallback {
	key: string;
	label: string;
}

/** Preserve the immutable label snapshotted on the lead when its key is no longer
 * in the campaign's current active disposition bundle. */
export function getSavedDispositionFallback(
	dispositionId: string | null,
	dispositionLabel: string | null,
	current: DialerDisposition[]
): SavedDispositionFallback | null {
	if (!dispositionId) return null;
	if (current.some((item) => item.disposition_key === dispositionId))
		return null;
	return {
		key: dispositionId,
		label: dispositionLabel || dispositionId
	};
}
