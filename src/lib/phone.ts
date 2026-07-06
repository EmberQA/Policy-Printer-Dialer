/**
 * Phone-number helpers shared across the dialer FE (dialpad + click-to-dial).
 */

/**
 * Normalize a typed/stored number to canonical NANP +1XXXXXXXXXX, or null if it
 * isn't a valid US/CA number. Mirrors the backend's normalizeToNanpE164 so a UI
 * gate (dialpad Call button, click-to-dial icon) matches what the server accepts
 * (the server re-validates — this is just UX). NANP: area-code + exchange leading
 * digits are both 2–9. `*`/`#` and other non-digits are stripped.
 */
export function normalizeDialInput(raw: string): string | null {
	let digits = raw.replace(/\D/g, '');
	if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
	if (digits.length !== 10) return null;
	if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
	return `+1${digits}`;
}
