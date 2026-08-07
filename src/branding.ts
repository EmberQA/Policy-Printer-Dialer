export const PLAIN_BRANDING_QUERY_PARAM = 'plain_branding';

const PLAIN_BRANDING_SESSION_KEY = 'pp_dialer_plain_branding';
const DOCUMENT_TITLE = 'Dialer';
const BRANDED_FAVICON_URL = '/favicon.ico';
const TRANSPARENT_FAVICON_URL =
	'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22%3E%3C/svg%3E';

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

export function applyDocumentBranding(plainBranding: boolean): void {
	if (typeof document === 'undefined') return;

	document.title = plainBranding ? '' : DOCUMENT_TITLE;

	const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
	if (!favicon) return;

	favicon.href = plainBranding ? TRANSPARENT_FAVICON_URL : BRANDED_FAVICON_URL;
	favicon.type = plainBranding ? 'image/svg+xml' : 'image/x-icon';
}
