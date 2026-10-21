import {useSyncExternalStore} from 'react';
import policyPrinterLogo from '@/assets/policy-printer-logo.png';
import l2InfiniteInsuranceLogo from '@/assets/l2-infinite-insurance-logo.png';

export const PLAIN_BRANDING_QUERY_PARAM = 'plain_branding';
export const DIALER_BRAND_QUERY_PARAM = 'dialer_brand';
export const POLICY_PRINTER_DIALER_BRAND = 'policy_printer';
export const L2_INFINITE_INSURANCE_DIALER_BRAND =
	'pp_l2_infinite_insurance';
export const L2_INFINITE_INSURANCE_DIALER_HOST =
	'dialer.l2-infinite-insurance.link';

const PLAIN_BRANDING_SESSION_KEY = 'pp_dialer_plain_branding';
const TRANSPARENT_FAVICON_URL =
	'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22%3E%3C/svg%3E';

export interface DialerBranding {
	key: string;
	appName: string;
	documentTitle: string;
	logoUrl: string;
	faviconUrl: string;
	portalUrl: string;
	teamContent?: { coaching_url?: string | null; dialer_training_url?: string | null };
}

/**
 * ENG-317: when nothing resolves, we render NOTHING branded — no PP logo, no
 * "Policy Printer" name, no PP favicon. The empty strings cause consumers to
 * skip rendering (see guards in App header, QuoteComparisonApp, etc.).
 */
export const BLANK_BRANDING: DialerBranding = {
	key: 'blank',
	appName: '',
	documentTitle: '',
	logoUrl: '',
	faviconUrl: TRANSPARENT_FAVICON_URL,
	portalUrl: ''
};

export const buildBrandingFromTeam = (team: {
	url: string;
	brand_name: string;
	brand_logo_url: string | null;
	coaching_url?: string | null;
	dialer_training_url?: string | null;
}): DialerBranding => ({
	key: `team_branding:${team.url}`,
	teamContent: team,
	appName: team.brand_name,
	documentTitle: `${team.brand_name} Dialer`,
	logoUrl: team.brand_logo_url ?? '',
	faviconUrl: TRANSPARENT_FAVICON_URL,
	portalUrl: `https://app.${team.url}`
});

/** Explicit existing sites; unknown team domains have no static fallback. */
const DIALER_BRANDS_BY_HOST: Record<string, DialerBranding> = {
  'dialer.policyprinter.io': {
    key: POLICY_PRINTER_DIALER_BRAND,
    appName: 'Policy Printer',
    documentTitle: 'Policy Printer Dialer',
    logoUrl: policyPrinterLogo,
    faviconUrl: '/favicon.ico',
    portalUrl: 'https://app.policyprinter.io'
  },
  'dialer.emberqa.com': {
    key: 'emberqa',
    appName: 'EmberQA',
    documentTitle: 'EmberQA Dialer',
    logoUrl: 'https://rf-public-imgs.s3.us-east-2.amazonaws.com/EmberQA-Logo-Full.png',
    faviconUrl: TRANSPARENT_FAVICON_URL,
    portalUrl: 'https://app.emberqa.com'
  },
	[L2_INFINITE_INSURANCE_DIALER_HOST]: {
		key: L2_INFINITE_INSURANCE_DIALER_BRAND,
		appName: 'L2 Infinite Insurance',
		documentTitle: 'L2 Infinite Insurance Dialer',
		logoUrl: l2InfiniteInsuranceLogo,
		faviconUrl: '/l2-infinite-insurance-favicon.ico',
		portalUrl: 'https://app.l2-infinite-insurance.link'
	}
};

/* -------------------------------------------------------------------------- */
/* Reactive store — subscribers re-render whenever the branding changes.      */
/* `getDialerBranding()` and the imperative API stay, but UI reads through    */
/* `useDialerBranding()` so a late-resolved brand lands in the DOM.           */
/* -------------------------------------------------------------------------- */

const subscribers = new Set<() => void>();
const notify = () => {
	for (const fn of subscribers) fn();
};

/**
 * Current branding, computed from (in priority order):
 *   1. Dynamic override (set after /resolveByHost or /teams/branding/mine)
 *   2. Explicit static base/org host map
 *   3. BLANK_BRANDING — never leak PP livery when nothing resolved
 */
let dynamicBrandingOverride: DialerBranding | null = null;

export const setDynamicDialerBranding = (branding: DialerBranding | null) => {
	if (dynamicBrandingOverride === branding) return;
	dynamicBrandingOverride = branding;
	notify();
};

export function getDialerBranding(): DialerBranding {
	if (dynamicBrandingOverride) return dynamicBrandingOverride;
	if (typeof window === 'undefined') return BLANK_BRANDING;

	const hostBranding =
		DIALER_BRANDS_BY_HOST[window.location.hostname.toLowerCase()];
	if (hostBranding) return hostBranding;

	// Unknown hosts stay blank until an explicit team identity resolves.
	return BLANK_BRANDING;
}

/** Subscribe-driven hook so UI re-renders when the override is set. */
export function useDialerBranding(): DialerBranding {
	return useSyncExternalStore(
		(onStoreChange) => {
			subscribers.add(onStoreChange);
			return () => subscribers.delete(onStoreChange);
		},
		getDialerBranding,
		getDialerBranding
	);
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

		return (
			window.sessionStorage.getItem(PLAIN_BRANDING_SESSION_KEY) === 'true'
		);
	} catch {
		return requestedInUrl;
	}
}

function getPortalOrigin(branding: DialerBranding): string {
	// Dev: dashboard runs on 3001 regardless of brand subdomain. The branded
	// hostname is derived from the dialer's own origin so "Open Call in Portal"
	// deep-links back into the correct branded dashboard.
	if (!import.meta.env.PROD) {
		if (typeof window === 'undefined') return 'http://localhost:3001';
		const host = window.location.hostname.replace(/^dialer\./, 'app.');
		return `http://${host}:3001`;
	}
	return branding.portalUrl;
}

export function getRankSystemUrl(
	branding: DialerBranding = getDialerBranding()
): string {
	const origin = getPortalOrigin(branding);
	if (!origin) return '';
	const url = new URL('/dashboard/leaderboard', origin);
	url.searchParams.set('rank-system', '1');
	return url.toString();
}

/** The scored call on the portal — `?selected=` auto-opens its call detail. */
export function getPortalCallUrl(
	scoreUuid: string,
	branding: DialerBranding = getDialerBranding()
): string {
	const origin = getPortalOrigin(branding);
	if (!origin) return '';
	const url = new URL('/dashboard/main', origin);
	url.searchParams.set('selected', scoreUuid);
	return url.toString();
}

export function applyDocumentBranding(
	plainBranding: boolean,
	branding: DialerBranding = getDialerBranding()
): void {
	if (typeof document === 'undefined') return;

	document.title = plainBranding ? '' : branding.documentTitle;

	const favicon = document.querySelector<HTMLLinkElement>(
		'link[rel~="icon"]'
	);
	if (!favicon) return;

	favicon.href = plainBranding ? TRANSPARENT_FAVICON_URL : branding.faviconUrl;
	favicon.type = plainBranding ? 'image/svg+xml' : 'image/x-icon';
}
