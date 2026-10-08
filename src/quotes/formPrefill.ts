/**
 * Live lead form → quote page prefill (ENG-286).
 *
 * Same idea as the script doc's linked blanks (scriptDoc/core.resolveBlank):
 * read the standard lead-form keys (TLD_FORM_SCHEMA — first_name, last_name,
 * phone, state, dob, height, weight) straight from the in-call form, even
 * before it is saved. "Get a quote" stashes the mapped values in localStorage
 * under a one-time key and passes only that key in the URL — form data (DOB,
 * name) never rides the query string. The quote tab reads + deletes it.
 */

import {US_JURISDICTION_NAMES} from '@/lib/phone';
import type {QuoteClientInputs} from './types';

export interface FormQuotePrefill {
	firstName: string | null;
	lastName: string | null;
	phone: string | null;
	client: Partial<QuoteClientInputs>;
}

const PREFIX = 'pp_quote_prefill:';
/** A handoff older than this is stale (tab never opened) and ignored. */
const MAX_AGE_MS = 10 * 60 * 1000;

const text = (v: unknown): string =>
	typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';

const NAME_TO_CODE = new Map(
	Object.entries(US_JURISDICTION_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);

/** "Florida (FL)" / "FL" / "fl" / "Florida" / "us-fl" → "FL". */
export function stateCodeFromForm(raw: unknown): string | null {
	const s = text(raw).replace(/^us-/i, '');
	if (!s) return null;
	const paren = /\(([A-Za-z]{2})\)\s*$/.exec(s);
	const code = (paren ? paren[1] : s).toUpperCase();
	if (code.length === 2 && US_JURISDICTION_NAMES[code]) return code;
	return NAME_TO_CODE.get(s.toLowerCase()) ?? null;
}

/** "MM/DD/YYYY", "M-D-YYYY", or ISO "YYYY-MM-DD" → parts. Calendar strings only, no Date math. */
export function dobPartsFromForm(raw: unknown): {month: number; day: number; year: number} | null {
	const s = text(raw);
	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
	let parts = m ? {year: +m[1], month: +m[2], day: +m[3]} : null;
	if (!parts) {
		m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
		parts = m ? {month: +m[1], day: +m[2], year: +m[3]} : null;
	}
	if (!parts) return null;
	return parts.month >= 1 && parts.month <= 12 && parts.day >= 1 && parts.day <= 31 ? parts : null;
}

/** `5'8`, `5'8"`, `5 8`, `5-8`, `5ft 8in`, or total inches `68` → feet/inches. */
export function heightFromForm(raw: unknown): {feet: number; inches: number} | null {
	const s = text(raw);
	if (!s) return null;
	const m = /^(\d)\s*(?:'|ft|feet|-|\s)\s*(\d{1,2})?/i.exec(s);
	if (m) {
		const feet = +m[1];
		const inches = m[2] ? +m[2] : 0;
		return feet >= 3 && feet <= 7 && inches < 12 ? {feet, inches} : null;
	}
	const total = Number(s);
	return Number.isInteger(total) && total >= 36 && total <= 96
		? {feet: Math.floor(total / 12), inches: total % 12}
		: null;
}

export function weightFromForm(raw: unknown): number | null {
	const n = Number(text(raw).replace(/\s*(lbs?|pounds)$/i, ''));
	return Number.isFinite(n) && n >= 50 && n <= 700 ? Math.round(n) : null;
}

/** Map the live form's values onto quote inputs. Unknown / blank keys are skipped. */
export function quotePrefillFromForm(formData: Record<string, unknown>): FormQuotePrefill {
	const client: Partial<QuoteClientInputs> = {};
	const state = stateCodeFromForm(formData.state);
	if (state) client.state = state;
	const dob = dobPartsFromForm(formData.dob);
	if (dob) Object.assign(client, {dobMonth: dob.month, dobDay: dob.day, dobYear: dob.year});
	const height = heightFromForm(formData.height);
	if (height) Object.assign(client, {heightFeet: height.feet, heightInches: height.inches});
	const weight = weightFromForm(formData.weight);
	if (weight !== null) client.weight = weight;
	const sex = text(formData.sex ?? formData.gender).toLowerCase();
	if (sex === 'male' || sex === 'm') client.sex = 'Male';
	if (sex === 'female' || sex === 'f') client.sex = 'Female';
	return {
		firstName: text(formData.first_name) || null,
		lastName: text(formData.last_name) || null,
		phone: text(formData.phone) || null,
		client
	};
}

/* ------------------------------ handoff ---------------------------------- */

const newKey = () =>
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Stash the prefill for the quote tab; returns the one-time key (null if storage is unavailable). */
export function stashFormPrefill(prefill: FormQuotePrefill): string | null {
	try {
		const key = newKey();
		localStorage.setItem(PREFIX + key, JSON.stringify({at: Date.now(), prefill}));
		return key;
	} catch {
		return null;
	}
}

/** Read + delete a stashed prefill. Stale or malformed handoffs return null. */
export function takeFormPrefill(key: string | null): FormQuotePrefill | null {
	if (!key) return null;
	try {
		const raw = localStorage.getItem(PREFIX + key);
		localStorage.removeItem(PREFIX + key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as {at?: number; prefill?: FormQuotePrefill};
		if (!parsed.prefill || typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) {
			return null;
		}
		return parsed.prefill;
	} catch {
		return null;
	}
}
