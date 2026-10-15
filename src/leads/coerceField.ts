/**
 * Carry an OLD saved answer onto the CURRENT form field.
 *
 * Height, weight, sex and tobacco used to be free text; the lead form now
 * has controlled inputs for them (height select, weight number, sex radio,
 * tobacco select, DOB date — plans/insurance_toolkit/sql/02_form_controlled_fields.sql).
 * A returning caller or a CRM edit re-saves the old answers against the new
 * form, and the backend rejects a select value that isn't an option ("Height
 * has an invalid selection") or a non-numeric number. So every carried value
 * goes through here: mapped onto the field when it can be, dropped when not.
 */

import type {FormField} from '@/lib/api';
import {parseDob, parseHeight, parseTobacco, parseWeight} from '@/quotes/parse';

/** Old keys a current field also reads from (gender was renamed sex). */
const FIELD_ALIASES: Record<string, string[]> = {sex: ['gender']};

/** The saved answer for `field` under its own key or a former key. */
export function aliasedAnswer(field: FormField, saved: Record<string, unknown>): unknown {
	if (saved[field.key] !== undefined) return saved[field.key];
	for (const old of FIELD_ALIASES[field.key] ?? []) {
		if (saved[old] !== undefined) return saved[old];
	}
	return undefined;
}

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** Field-specific reading of free text → a candidate option value. */
function parsedFor(key: string, raw: unknown): string | null {
	switch (key) {
		case 'height': {
			const h = parseHeight(raw);
			return h ? `${h.feet}'${h.inches}"` : null;
		}
		case 'tobacco':
			return parseTobacco(raw);
		case 'sex':
		case 'gender': {
			const s = lower(raw);
			if (s === 'm' || s === 'male') return 'Male';
			if (s === 'f' || s === 'female') return 'Female';
			return null;
		}
		default:
			return null;
	}
}

/**
 * `raw` as a value `field` accepts, or undefined to drop it. Only select,
 * radio, number and date fields are touched; every other type passes through.
 */
export function coerceToField(field: FormField, raw: unknown): unknown {
	if (raw === undefined || raw === null || raw === '') return raw;

	if (field.type === 'number') {
		if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
		const n = field.key === 'weight' ? parseWeight(raw) : Number(String(raw).trim());
		return n !== null && Number.isFinite(n) ? n : undefined;
	}

	if (field.type === 'date') {
		const d = parseDob(raw);
		const pad = (n: number) => String(n).padStart(2, '0');
		return d ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : undefined;
	}

	if (field.type === 'select' || field.type === 'radio') {
		const options = field.options ?? [];
		if (!options.length) return raw; // nothing to match against
		const byValue = (v: string | null) => (v === null ? undefined : options.find((o) => o.value === v));
		const exact = typeof raw === 'string' ? byValue(raw) : undefined;
		if (exact) return exact.value;
		const s = lower(raw);
		const loose = options.find((o) => o.value.toLowerCase() === s || o.label.toLowerCase() === s);
		if (loose) return loose.value;
		return byValue(parsedFor(field.key, raw))?.value;
	}

	return raw;
}
