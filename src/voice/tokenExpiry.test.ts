import {describe, expect, it} from 'vitest';
import {readTokenExpiry} from './TelnyxTransport';

/**
 * The Telnyx transport decides when to renew by reading the token's OWN expiry, rather
 * than by counting hours from when it was issued. That is what lets a short repeating
 * check replace the single long timer this replaced — see the constants in
 * TelnyxTransport.ts for why the one-shot version was a liability.
 */

const jwt = (payload: Record<string, unknown>): string =>
	['header', btoa(JSON.stringify(payload)), 'signature'].join('.');

describe('readTokenExpiry', () => {
	it('reads exp and converts it from seconds to milliseconds', () => {
		expect(readTokenExpiry(jwt({exp: 1_800_000_000, sub: 'cred-1'}))).toBe(
			1_800_000_000_000
		);
	});

	// Every "cannot tell" answer has to be null rather than a guess, because the caller
	// falls back to an assumed 24h lifetime. A wrong number here would either renew
	// constantly or — far worse — never.
	it('returns null for a token carrying no exp', () => {
		expect(readTokenExpiry(jwt({sub: 'cred-1'}))).toBeNull();
	});

	it('returns null for a non-numeric exp', () => {
		expect(readTokenExpiry(jwt({exp: 'soon'}))).toBeNull();
	});

	it('returns null for something that is not a JWT at all', () => {
		expect(readTokenExpiry('not-a-token')).toBeNull();
		expect(readTokenExpiry('')).toBeNull();
	});

	// The payload segment is base64URL, not plain base64: a real token routinely contains
	// `-` and `_`, and decoding it as standard base64 throws. Treating that as "no expiry"
	// would silently downgrade every agent to the assumed lifetime.
	it('decodes a base64URL payload containing - and _', () => {
		const payload = btoa(JSON.stringify({exp: 1_800_000_000, k: '??>>'}))
			.replace(/\+/g, '-')
			.replace(/\//g, '_');
		expect(readTokenExpiry(`header.${payload}.sig`)).toBe(1_800_000_000_000);
	});
});
