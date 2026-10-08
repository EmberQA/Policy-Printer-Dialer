/**
 * Opening the quote comparison page (ENG-286) from the dialer.
 *
 * The page lives at /quotecomparison in its OWN browser tab (it bypasses the
 * dialer's tab lock — see main.tsx). Two entry points:
 *  - `openQuoteComparison(leadId)` — a saved lead's row/detail "Quote" button.
 *  - `openQuoteFromForm(leadId, formData)` — the in-call lead form's "Get a
 *    quote" button: prefills from whatever the agent has typed, saved or not.
 */

import {quotePrefillFromForm, stashFormPrefill} from './formPrefill';

export const QUOTE_COMPARISON_PATH = '/quotecomparison';

export const quoteComparisonUrl = (
	leadId?: string | null,
	prefillKey?: string | null
): string => {
	const params = new URLSearchParams();
	if (leadId) params.set('lead_id', leadId);
	if (prefillKey) params.set('prefill', prefillKey);
	const qs = params.toString();
	return qs ? `${QUOTE_COMPARISON_PATH}?${qs}` : QUOTE_COMPARISON_PATH;
};

export const openQuoteComparison = (leadId?: string | null): void => {
	window.open(quoteComparisonUrl(leadId), '_blank', 'noopener');
};

export const openQuoteFromForm = (
	leadId: string | null,
	formData: Record<string, unknown>
): void => {
	const key = stashFormPrefill(quotePrefillFromForm(formData));
	window.open(quoteComparisonUrl(leadId, key), '_blank', 'noopener');
};
