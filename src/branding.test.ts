import {afterEach, describe, expect, it, vi} from 'vitest';
import {
	getDialerBranding,
	getRankSystemUrl,
	L2_INFINITE_INSURANCE_DIALER_BRAND,
	L2_INFINITE_INSURANCE_DIALER_HOST,
	POLICY_PRINTER_DIALER_BRAND
} from './branding';

const makeWindow = (
	search: string,
	initialBrand?: string,
	hostname = 'dialer.policyprinter.io'
) => {
	const storage = new Map<string, string>();
	if (initialBrand) storage.set('pp_dialer_brand', initialBrand);

	return {
		location: {hostname, search},
		sessionStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value)
		}
	};
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('dialer branding', () => {
	it('selects L2 directly from its custom hostname', () => {
		vi.stubGlobal(
			'window',
			makeWindow('', undefined, L2_INFINITE_INSURANCE_DIALER_HOST)
		);

		expect(getDialerBranding().key).toBe(
			L2_INFINITE_INSURANCE_DIALER_BRAND
		);
	});

	it('lets the L2 hostname outrank a stale Policy Printer query', () => {
		vi.stubGlobal(
			'window',
			makeWindow(
				`?dialer_brand=${POLICY_PRINTER_DIALER_BRAND}`,
				undefined,
				L2_INFINITE_INSURANCE_DIALER_HOST
			)
		);

		expect(getDialerBranding().key).toBe(
			L2_INFINITE_INSURANCE_DIALER_BRAND
		);
	});

	it('selects and stores the L2 brand passed by the main dashboard', () => {
		vi.stubGlobal(
			'window',
			makeWindow(`?dialer_brand=${L2_INFINITE_INSURANCE_DIALER_BRAND}`)
		);

		const branding = getDialerBranding();

		expect(branding.key).toBe(L2_INFINITE_INSURANCE_DIALER_BRAND);
		expect(branding.appName).toBe('L2 Infinite Insurance');
		expect(branding.documentTitle).toBe('L2 Infinite Insurance Dialer');
	});

	it('retains the selected brand after router navigation removes the query', () => {
		vi.stubGlobal(
			'window',
			makeWindow('', L2_INFINITE_INSURANCE_DIALER_BRAND)
		);

		expect(getDialerBranding().key).toBe(
			L2_INFINITE_INSURANCE_DIALER_BRAND
		);
	});

	it('lets a later Policy Printer launch reset a stale L2 tab brand', () => {
		vi.stubGlobal(
			'window',
			makeWindow(
				`?dialer_brand=${POLICY_PRINTER_DIALER_BRAND}`,
				L2_INFINITE_INSURANCE_DIALER_BRAND
			)
		);

		expect(getDialerBranding().key).toBe(POLICY_PRINTER_DIALER_BRAND);
	});

	it('falls back to Policy Printer for an unknown brand', () => {
		vi.stubGlobal('window', makeWindow('?dialer_brand=unknown'));

		expect(getDialerBranding().key).toBe(POLICY_PRINTER_DIALER_BRAND);
	});

	it('opens the local leaderboard with the rank explainer requested in dev', () => {
		expect(getRankSystemUrl()).toBe(
			'http://localhost:3001/dashboard/leaderboard?rank-system=1'
		);
	});
});
