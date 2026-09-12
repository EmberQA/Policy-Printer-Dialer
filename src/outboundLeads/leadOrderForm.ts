/**
 * Pure helpers for the lead purchase-order form (ENG-234 Subplan 02).
 *
 * Defaults, instant client-side checks and display formatting. The server is
 * authoritative — `validateLeadOrderInputClient` mirrors its rules only so the
 * agent sees a problem before the round trip, and it must never be stricter than
 * the backend's `validatePurchaseOrderInput`.
 */

import type {
	LeadCoverageType,
	LeadOrderInput,
	LeadOrderSummary,
	LeadPurchaseOrder,
	LicensedJurisdiction
} from '@/lib/api';

export const LEAD_COVERAGE_OPTIONS: Array<{
	value: LeadCoverageType;
	label: string;
}> = [
	{value: 'final_expense', label: 'Final expense'},
	{value: 'term_life', label: 'Term life'}
];

export const MAX_DAILY_CAP = 100;
export const MAX_MAX_CAP = 1000;
export const MAX_LEAD_AGE_YEARS = 120;

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The browser's zone, or UTC when the runtime cannot say. */
export const detectTimeZone = (): string => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
};

/** Every IANA zone the runtime knows, for the "change timezone" select. Falls
 *  back to the detected zone alone on runtimes without supportedValuesOf. */
export const listTimeZones = (): string[] => {
	try {
		const intl = Intl as unknown as {
			supportedValuesOf?: (key: 'timeZone') => string[];
		};
		const zones = intl.supportedValuesOf?.('timeZone') ?? [];
		return zones.length > 0 ? zones : [detectTimeZone()];
	} catch {
		return [detectTimeZone()];
	}
};

/** A fresh order: 9–5 in the browser's zone, 5/day, 20 total, the agent's
 *  licensed states, both coverage types, no age filter. */
export const buildDefaultLeadOrderInput = (
	summary: Pick<LeadOrderSummary, 'licensed_states'>
): LeadOrderInput => ({
	working_hours_start: '09:00',
	working_hours_end: '17:00',
	timezone: detectTimeZone(),
	daily_cap: 5,
	max_cap: 20,
	states: [...summary.licensed_states],
	coverage_types: ['final_expense', 'term_life'],
	min_age: null,
	max_age: null
});

/** pg returns 'HH:MM:SS'; <input type="time"> wants 'HH:MM'. */
export const trimTime = (value: string): string =>
	typeof value === 'string' ? value.slice(0, 5) : '';

/** An existing order as form input, for the edit dialog. */
export const orderToInput = (order: LeadPurchaseOrder): LeadOrderInput => ({
	working_hours_start: trimTime(order.working_hours_start),
	working_hours_end: trimTime(order.working_hours_end),
	timezone: order.timezone,
	daily_cap: order.daily_cap,
	max_cap: order.max_cap,
	states: [...order.states],
	coverage_types: [...order.coverage_types],
	min_age: order.min_age,
	max_age: order.max_age
});

/** First problem as a message, or null when the form can be submitted. Mirrors
 *  the backend's order of checks. */
export const validateLeadOrderInputClient = (
	input: LeadOrderInput
): string | null => {
	if (
		!HH_MM.test(input.working_hours_start) ||
		!HH_MM.test(input.working_hours_end)
	) {
		return 'Working hours must be HH:MM';
	}
	if (input.working_hours_start === input.working_hours_end) {
		return 'Working hours start and end must differ';
	}
	if (!input.timezone.trim()) return 'Pick a timezone';
	if (
		!Number.isInteger(input.daily_cap) ||
		input.daily_cap < 1 ||
		input.daily_cap > MAX_DAILY_CAP
	) {
		return `Daily cap must be a whole number between 1 and ${MAX_DAILY_CAP}`;
	}
	if (
		!Number.isInteger(input.max_cap) ||
		input.max_cap < 1 ||
		input.max_cap > MAX_MAX_CAP
	) {
		return `Max cap must be a whole number between 1 and ${MAX_MAX_CAP}`;
	}
	if (input.states.length === 0) return 'Select at least one state';
	if (input.coverage_types.length === 0) {
		return 'Select at least one coverage type';
	}
	for (const age of [input.min_age, input.max_age]) {
		if (age === null) continue;
		if (!Number.isInteger(age)) return 'Ages must be whole numbers';
		if (age < 0 || age > MAX_LEAD_AGE_YEARS) {
			return `Ages must be between 0 and ${MAX_LEAD_AGE_YEARS}`;
		}
	}
	if (
		input.min_age !== null &&
		input.max_age !== null &&
		input.min_age > input.max_age
	) {
		return 'Minimum age cannot exceed maximum age';
	}
	return null;
};

/** 'HH:MM' → '8:00 PM'. */
export const formatClock = (hhmm: string): string => {
	const [h, m] = trimTime(hhmm).split(':').map(Number);
	if (!Number.isInteger(h) || !Number.isInteger(m)) return hhmm;
	const suffix = h >= 12 ? 'PM' : 'AM';
	const hour12 = h % 12 === 0 ? 12 : h % 12;
	return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
};

/** "8:00 PM – 2:00 AM (overnight)" — the wrap-around case is called out because
 *  the window then spans two calendar days. */
export const describeWindow = (
	start: string,
	end: string,
	tz: string
): string => {
	const s = trimTime(start);
	const e = trimTime(end);
	const overnight = s > e ? ' (overnight)' : '';
	return `${formatClock(s)} – ${formatClock(e)}${overnight} ${tz}`;
};

export const formatDollars = (cents: number): string =>
	`$${(cents / 100).toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	})}`;

/** Remaining spend an active order can still incur at ITS price. */
export const remainingSpendCents = (order: LeadPurchaseOrder): number =>
	Math.max(0, order.max_cap - order.delivered_count) * order.unit_price_cents;

/** 'us-tx' → 'TX', via the served catalogue; unknown codes pass through upper-cased. */
export const stateLabel = (
	code: string,
	jurisdictions: LicensedJurisdiction[]
): string =>
	jurisdictions.find((j) => j.code === code)?.abbr ??
	code.replace(/^us-/, '').toUpperCase();

/** Canonical 'us-xx' for a checkbox toggle so comparisons against saved orders
 *  and licensed states are exact. Abbreviations are accepted from older data. */
export const canonicalStateCode = (raw: string): string => {
	const lower = raw.trim().toLowerCase();
	return lower.startsWith('us-') ? lower : `us-${lower}`;
};

/** Set difference of the form's current selection vs a saved list, both
 *  canonicalised — mirrors the backend's compareOrderStates for the live warning. */
export const diffStates = (
	selected: string[],
	saved: string[]
): {
	differs: boolean;
	selected_not_saved: string[];
	saved_not_selected: string[];
} => {
	const a = new Set(selected.map(canonicalStateCode));
	const b = new Set(saved.map(canonicalStateCode));
	const selected_not_saved = [...a].filter((s) => !b.has(s)).sort();
	const saved_not_selected = [...b].filter((s) => !a.has(s)).sort();
	return {
		differs: selected_not_saved.length > 0 || saved_not_selected.length > 0,
		selected_not_saved,
		saved_not_selected
	};
};
