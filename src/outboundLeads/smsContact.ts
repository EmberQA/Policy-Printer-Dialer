/**
 * Pure helpers for the lead-alert SMS contact (ENG-248) — no React, no API, so
 * they are vitest-able in the node env like leadOrderForm.ts.
 *
 * Client-side checks mirror the backend's and must never be stricter than it:
 * the server re-validates and its message wins.
 */

import type {SmsContactSummary} from '@/lib/api';
import {normalizeDialInput} from '@/lib/phone';
import {formatLeadPhone} from './leadDisplay';

export type SmsContactState = 'none' | 'pending' | 'verified';

/** Where the agent is in the flow, from the summary alone. */
export const describeSmsContact = (
	contact: SmsContactSummary | null | undefined
): SmsContactState =>
	!contact ? 'none' : contact.verified ? 'verified' : 'pending';

/** Canonical +1XXXXXXXXXX, or a human-readable problem. */
export const validatePhoneInputClient = (
	raw: string
): {ok: true; value: string} | {ok: false; message: string} => {
	if (!raw.trim()) return {ok: false, message: 'Enter your mobile number'};
	const value = normalizeDialInput(raw);
	return value
		? {ok: true, value}
		: {ok: false, message: 'Enter a valid US or Canada mobile number'};
};

/** Six digits, spaces tolerated, or a human-readable problem. */
export const validateCodeInputClient = (
	raw: string
): {ok: true; value: string} | {ok: false; message: string} => {
	const digits = raw.replace(/\s+/g, '');
	if (!digits) return {ok: false, message: 'Enter the code we texted you'};
	return /^\d{6}$/.test(digits)
		? {ok: true, value: digits}
		: {ok: false, message: 'The code is 6 digits'};
};

/** "(972) 555-0123" — the same rendering the leads table uses. */
export const formatSmsPhone = (phone: string): string => formatLeadPhone(phone);

/**
 * True while a texted code is still live, so the dialog can open on the code
 * step instead of asking for the number again. A past expiry (or no expiry)
 * means the agent needs a fresh code.
 */
export const hasLiveCode = (
	contact: SmsContactSummary | null | undefined,
	nowMs: number
): boolean =>
	!!contact &&
	!contact.verified &&
	!!contact.code_expires_at &&
	new Date(contact.code_expires_at).getTime() > nowMs;
