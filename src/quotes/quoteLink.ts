/**
 * Opening the quote comparison page (ENG-286) from the dialer.
 *
 * A quote belongs to the CALLER'S PHONE NUMBER (per agent), not to a lead: it
 * starts mid-call before any lead exists and survives the lead being saved or
 * re-saved. Entry points:
 *  - `openQuoteComparison(leadId)` — a saved lead's row / detail. The backend
 *    resolves the lead's number (lead ids are not PII, so they ride the URL).
 *  - `openQuoteFromForm(...)` — the in-call form's "Get a quote", and CRM
 *    contacts without a saved lead. The number + form values go through the
 *    one-time localStorage handoff; a phone number never rides the URL.
 *
 * Tabs are opened with a stable window NAME (no `noopener`), so a second click
 * focuses the open tab — or, if the agent closed it, opens a fresh one that
 * reloads the saved quote. Same-origin only: the dialer can reach tabs it
 * opened, nothing else.
 */

import {quotePrefillFromForm, stashFormPrefill} from './formPrefill';

export const QUOTE_COMPARISON_PATH = '/quotecomparison';

export const quoteComparisonUrl = (params: {leadId?: string | null; prefillKey?: string | null}): string => {
	const qs = new URLSearchParams();
	if (params.leadId) qs.set('lead_id', params.leadId);
	if (params.prefillKey) qs.set('prefill', params.prefillKey);
	const s = qs.toString();
	return s ? `${QUOTE_COMPARISON_PATH}?${s}` : QUOTE_COMPARISON_PATH;
};

export const openQuoteComparison = (leadId: string): void => {
	window.open(quoteComparisonUrl({leadId}), `pp-quote-lead-${leadId}`);
};

/**
 * Open (or re-target) a named quote tab for a caller, prefilled from form
 * values. `phone` is the key the quote saves under (the live caller number,
 * else the typed phone); without a usable number the page is a scratch quote.
 */
export const openQuoteFromForm = (
	formData: Record<string, unknown>,
	phone: string | null,
	windowName: string
): Window | null => {
	const prefill = quotePrefillFromForm(formData);
	const key = stashFormPrefill({...prefill, phone: phone || prefill.phone});
	return window.open(quoteComparisonUrl({prefillKey: key}), windowName);
};
