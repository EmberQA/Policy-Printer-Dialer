/**
 * Forgiving parsers for free-text lead-form fields (ENG-286): height, weight,
 * date of birth. Agents type these however they say them on the phone, so
 * each parser accepts every common spelling and returns null — never a guess —
 * when the input is ambiguous or out of a plausible adult range.
 *
 * Pure and dependency-free. The SAME logic lives in the backend at
 * bespoke_features/policy_printer/quotes/core.ts (dialer-lead prefill) — keep
 * the two in sync.
 *
 * Dates are calendar strings only: no Date objects, no timezone math.
 */

export interface Height {
	feet: number;
	inches: number;
}

export interface DobParts {
	month: number;
	day: number;
	year: number;
}

const asText = (v: unknown): string =>
	typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';

/** Lowercase, straighten curly quotes/primes, collapse whitespace. */
const normalize = (v: unknown): string =>
	asText(v)
		.toLowerCase()
		.replace(/[‘’′´`]/g, "'")
		.replace(/[“”″]/g, '"')
		.replace(/''/g, '"')
		.replace(/\s+/g, ' ')
		.trim();

/* -------------------------------------------------------------------------- */
/* Height                                                                      */
/* -------------------------------------------------------------------------- */

const MIN_HEIGHT_IN = 36; // 3'0"
const MAX_HEIGHT_IN = 96; // 8'0"

const fromTotalInches = (total: number): Height | null => {
	const rounded = Math.round(total);
	if (rounded < MIN_HEIGHT_IN || rounded > MAX_HEIGHT_IN) return null;
	return {feet: Math.floor(rounded / 12), inches: rounded % 12};
};

const FEET_WORD = `(?:'|ft\\.?|feet|foot)`;
const INCH_WORD = `(?:"|in\\.?|inch|inches)`;

/**
 * Height → feet + inches. Accepts:
 *   5'7"  5' 7  5’7”  5 7  5-7  5.7  5ft7in  5 ft 7 in  5 foot 7 inches
 *   5 feet 7  5'  5 ft  67  67in  67 inches  67"  5'7 1/2"  170 cm  1.7 m
 * A lone "5.7" / "5.10" is feet.inches (how people type it), not decimal feet.
 */
export function parseHeight(raw: unknown): Height | null {
	let s = normalize(raw);
	if (!s) return null;
	// Drop a trailing fraction of an inch ("5'7 1/2"", "67 1/2 in"): rounds down.
	s = s.replace(/\s+\d\/\d+\s*/, ' ').trim();

	let m = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(?:cm|cms|centimet(?:er|re)s?)$`).exec(s);
	if (m) return fromTotalInches(+m[1] / 2.54);
	m = /^(\d(?:\.\d+)?)\s*(?:m|meters?|metres?)$/.exec(s);
	if (m) return fromTotalInches(+m[1] * 39.3701);

	// Total inches: "67", "67in", "67 inches", "67"".
	m = new RegExp(`^(\\d{2})\\s*${INCH_WORD}?$`).exec(s);
	if (m) return fromTotalInches(+m[1]);

	// Feet (+ optional inches) with a unit word or a separator between them.
	m = new RegExp(
		`^(\\d)\\s*(?:${FEET_WORD}\\s*(?:and\\s*)?|[-.\\s/,]\\s*)(\\d{1,2})?\\s*${INCH_WORD}?$`
	).exec(s);
	if (m) {
		const feet = +m[1];
		const inches = m[2] ? +m[2] : 0;
		if (feet < 3 || feet > 7 || inches > 11) return null;
		return {feet, inches};
	}

	// Bare feet: "5".
	m = /^(\d)$/.exec(s);
	if (m && +m[1] >= 4 && +m[1] <= 7) return {feet: +m[1], inches: 0};
	return null;
}

/* -------------------------------------------------------------------------- */
/* Weight                                                                      */
/* -------------------------------------------------------------------------- */

const MIN_WEIGHT_LB = 50;
const MAX_WEIGHT_LB = 700;

/**
 * Weight → whole pounds. Accepts:
 *   180  180lb  180 lbs  180 pounds  180#  ~180  about 180  180-185  82 kg
 * A range takes its first number.
 */
export function parseWeight(raw: unknown): number | null {
	const s = normalize(raw)
		.replace(/^(?:~|approx\.?|approximately|about|around|roughly)\s*/, '')
		.replace(/,/g, '');
	if (!s) return null;
	const m = /^(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*(lbs?\.?|pounds?|#|kgs?|kilos?|kilograms?)?$/.exec(
		s
	);
	if (!m) return null;
	const n = +m[1];
	const pounds = m[2] && m[2].startsWith('k') ? n * 2.20462 : n;
	const rounded = Math.round(pounds);
	return rounded >= MIN_WEIGHT_LB && rounded <= MAX_WEIGHT_LB ? rounded : null;
}

/* -------------------------------------------------------------------------- */
/* Date of birth                                                               */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
	jan: 1, january: 1,
	feb: 2, february: 2,
	mar: 3, march: 3,
	apr: 4, april: 4,
	may: 5,
	jun: 6, june: 6,
	jul: 7, july: 7,
	aug: 8, august: 8,
	sep: 9, sept: 9, september: 9,
	oct: 10, october: 10,
	nov: 11, november: 11,
	dec: 12, december: 12
};

/** Max day per month; Feb allows 29 (leap years are not worth Date math here). */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Two-digit years are 19xx: final-expense clients are adults born last century. */
const fullYear = (y: string): number => (y.length === 2 ? 1900 + +y : +y);

const valid = (month: number, day: number, year: number): DobParts | null =>
	month >= 1 &&
	month <= 12 &&
	day >= 1 &&
	day <= DAYS_IN_MONTH[month - 1] &&
	year >= 1900 &&
	year <= 2100
		? {month, day, year}
		: null;

/**
 * Date of birth → calendar parts. Accepts:
 *   01/02/1958  1-2-1958  1.2.1958  1 2 1958  1/2/58  01021958
 *   1958-01-02  1958/01/02  January 2, 1958  Jan 2 1958  Jan. 2nd, 1958
 *   2 January 1958
 * Numeric dates are US month-first.
 */
export function parseDob(raw: unknown): DobParts | null {
	const s = normalize(raw).replace(/(\d)(st|nd|rd|th)\b/g, '$1');
	if (!s) return null;

	let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t ].*)?$/.exec(s);
	if (m) return valid(+m[2], +m[3], +m[1]);

	m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4}|\d{2})$/.exec(s);
	if (m) return valid(+m[1], +m[2], fullYear(m[3]));

	m = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
	if (m) return valid(+m[1], +m[2], +m[3]);

	// "january 2, 1958" / "jan. 2 1958"
	m = /^([a-z]+)\.?\s*(\d{1,2}),?\s*(\d{4}|\d{2})$/.exec(s);
	if (m && MONTHS[m[1]]) return valid(MONTHS[m[1]], +m[2], fullYear(m[3]));

	// "2 january 1958"
	m = /^(\d{1,2})\s*([a-z]+)\.?,?\s*(\d{4}|\d{2})$/.exec(s);
	if (m && MONTHS[m[2]]) return valid(MONTHS[m[2]], +m[1], fullYear(m[3]));

	return null;
}
