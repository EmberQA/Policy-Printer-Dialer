import {describe, expect, it} from 'vitest';
import {
	describeSmsContact,
	formatSmsPhone,
	hasLiveCode,
	validateCodeInputClient,
	validatePhoneInputClient
} from './smsContact';

const NOW = Date.parse('2026-09-21T10:05:00Z');

describe('describeSmsContact', () => {
	it('maps the summary to none / pending / verified', () => {
		expect(describeSmsContact(null)).toBe('none');
		expect(describeSmsContact(undefined)).toBe('none');
		expect(
			describeSmsContact({phone_number: '+19725550123', verified: false, code_expires_at: null})
		).toBe('pending');
		expect(
			describeSmsContact({phone_number: '+19725550123', verified: true, code_expires_at: null})
		).toBe('verified');
	});
});

describe('validatePhoneInputClient', () => {
	it('normalises any common US format to +1 E.164', () => {
		for (const raw of ['(972) 555-0123', '972.555.0123', '19725550123', '+1 972 555 0123']) {
			expect(validatePhoneInputClient(raw)).toEqual({ok: true, value: '+19725550123'});
		}
	});

	it('mirrors the backend refusals without being stricter', () => {
		expect(validatePhoneInputClient('')).toEqual({ok: false, message: 'Enter your mobile number'});
		expect(validatePhoneInputClient('   ')).toEqual({ok: false, message: 'Enter your mobile number'});
		expect(validatePhoneInputClient('12345').ok).toBe(false);
		expect(validatePhoneInputClient('+44 20 7946 0958').ok).toBe(false);
		expect(validatePhoneInputClient('100-555-0123').ok).toBe(false);
	});
});

describe('validateCodeInputClient', () => {
	it('accepts six digits, tolerating spaces', () => {
		expect(validateCodeInputClient('482913')).toEqual({ok: true, value: '482913'});
		expect(validateCodeInputClient(' 482 913 ')).toEqual({ok: true, value: '482913'});
	});

	it('rejects empty, short, long and non-numeric input', () => {
		expect(validateCodeInputClient('')).toEqual({ok: false, message: 'Enter the code we texted you'});
		expect(validateCodeInputClient('48291').ok).toBe(false);
		expect(validateCodeInputClient('4829133').ok).toBe(false);
		expect(validateCodeInputClient('48291a').ok).toBe(false);
	});
});

describe('formatSmsPhone', () => {
	it('renders E.164 the way the leads table does', () => {
		expect(formatSmsPhone('+19725550123')).toBe('(972) 555-0123');
		expect(formatSmsPhone('oops')).toBe('oops');
	});
});

describe('hasLiveCode', () => {
	it('is true only while unverified with a future expiry', () => {
		const base = {phone_number: '+19725550123', verified: false};
		expect(hasLiveCode({...base, code_expires_at: '2026-09-21T10:10:00Z'}, NOW)).toBe(true);
		expect(hasLiveCode({...base, code_expires_at: '2026-09-21T10:04:00Z'}, NOW)).toBe(false);
		expect(hasLiveCode({...base, code_expires_at: null}, NOW)).toBe(false);
		expect(hasLiveCode({...base, verified: true, code_expires_at: '2026-09-21T10:10:00Z'}, NOW)).toBe(false);
		expect(hasLiveCode(null, NOW)).toBe(false);
	});
});
