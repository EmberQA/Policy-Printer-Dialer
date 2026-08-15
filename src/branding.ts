import l2InfiniteInsuranceLogo from '@/assets/l2-infinite-insurance-logo.png';
import policyPrinterLogo from '@/assets/policy-printer-logo.png';

export const PLAIN_BRANDING_QUERY_PARAM = 'plain_branding';
export const DIALER_BRAND_QUERY_PARAM = 'dialer_brand';
export const POLICY_PRINTER_DIALER_BRAND = 'policy_printer';
export const L2_INFINITE_INSURANCE_DIALER_BRAND =
	'pp_l2_infinite_insurance';
export const L2_INFINITE_INSURANCE_DIALER_HOST =
	'dialer.l2-infinite-insurance.link';

const PLAIN_BRANDING_SESSION_KEY = 'pp_dialer_plain_branding';
const DIALER_BRAND_SESSION_KEY = 'pp_dialer_brand';
const TRANSPARENT_FAVICON_URL =
	'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22%3E%3C/svg%3E';

export interface DialerBranding {
	key: string;
	appName: string;
	documentTitle: string;
	logoUrl: string;
	faviconUrl: string;
}

const POLICY_PRINTER_BRANDING: DialerBranding = {
	key: POLICY_PRINTER_DIALER_BRAND,
	appName: 'Policy Printer',
	documentTitle: 'Dialer',
	logoUrl: policyPrinterLogo,
	faviconUrl: '/favicon.ico'
};

const DIALER_BRANDS: Record<string, DialerBranding> = {
	[POLICY_PRINTER_DIALER_BRAND]: POLICY_PRINTER_BRANDING,
	[L2_INFINITE_INSURANCE_DIALER_BRAND]: {
		key: L2_INFINITE_INSURANCE_DIALER_BRAND,
		appName: 'L2 Infinite Insurance',
		documentTitle: 'L2 Infinite Insurance Dialer',
		logoUrl: l2InfiniteInsuranceLogo,
		faviconUrl: '/l2-infinite-insurance-favicon.ico'
	}
};

const DIALER_BRANDS_BY_HOST: Record<string, DialerBranding> = {
	[L2_INFINITE_INSURANCE_DIALER_HOST]:
		DIALER_BRANDS[L2_INFINITE_INSURANCE_DIALER_BRAND]
};

/**
 * The main dashboard passes its resolved sub-brand through the dialer handoff.
 * Keep it in tab-scoped storage so React Router navigation and refreshes retain
 * the brand, while a later launch from the parent dashboard can explicitly reset
 * the same tab back to Policy Printer.
 */
export function getDialerBranding(): DialerBranding {
	if (typeof window === 'undefined') return POLICY_PRINTER_BRANDING;

	const hostBranding = DIALER_BRANDS_BY_HOST[window.location.hostname.toLowerCase()];
	const requestedBrand = new URLSearchParams(window.location.search).get(
		DIALER_BRAND_QUERY_PARAM
	);

	try {
		// The custom hostname is the authoritative presentation identity. It must
		// render L2 even on a direct visit or if a stale link carries another brand.
		if (hostBranding) {
			window.sessionStorage.setItem(DIALER_BRAND_SESSION_KEY, hostBranding.key);
			return hostBranding;
		}

		if (requestedBrand !== null) {
			const branding = DIALER_BRANDS[requestedBrand] ?? POLICY_PRINTER_BRANDING;
			window.sessionStorage.setItem(DIALER_BRAND_SESSION_KEY, branding.key);
			return branding;
		}

		const storedBrand = window.sessionStorage.getItem(DIALER_BRAND_SESSION_KEY);
		return (storedBrand && DIALER_BRANDS[storedBrand]) || POLICY_PRINTER_BRANDING;
	} catch {
		return (
			hostBranding ??
			DIALER_BRANDS[requestedBrand ?? ''] ??
			POLICY_PRINTER_BRANDING
		);
	}
}

export function isPlainBranding(): boolean {
	if (typeof window === 'undefined') return false;

	const requestedInUrl = new URLSearchParams(window.location.search).has(
		PLAIN_BRANDING_QUERY_PARAM
	);

	try {
		if (requestedInUrl) {
			window.sessionStorage.setItem(PLAIN_BRANDING_SESSION_KEY, 'true');
			return true;
		}

		return window.sessionStorage.getItem(PLAIN_BRANDING_SESSION_KEY) === 'true';
	} catch {
		return requestedInUrl;
	}
}

export function applyDocumentBranding(
	plainBranding: boolean,
	branding: DialerBranding = getDialerBranding()
): void {
	if (typeof document === 'undefined') return;

	document.title = plainBranding ? '' : branding.documentTitle;

	const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
	if (!favicon) return;

	favicon.href = plainBranding ? TRANSPARENT_FAVICON_URL : branding.faviconUrl;
	favicon.type = plainBranding ? 'image/svg+xml' : 'image/x-icon';
}
