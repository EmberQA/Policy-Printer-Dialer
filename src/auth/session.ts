/**
 * Dialer session storage. The dialer is a separate subdomain from the main
 * EmberQA app and CANNOT share its host-only sameSite:Strict cookies — that is
 * exactly why the one-time handoff exists. After exchange we hold a real
 * EXTENSION JWT pair here (localStorage) and send it on every /api/v1 call.
 *
 * Access TTL is short (15 min); the access token is rotated in-place from the
 * `newAccessToken` field that the backend returns in response bodies (see api.ts).
 *
 * The refresh token slides: the backend re-issues it with a fresh 7-day expiry
 * every time it is spent and returns it as `newRefreshToken`. Storing that is what
 * keeps a working agent signed in indefinitely — and specifically what stops a
 * session dying MID-CALL. The heartbeat posts every ~5s while the dialer runs, so
 * the session is re-stamped continuously for as long as the tab is open.
 */

const ACCESS_KEY = 'pp_dialer_access';
const REFRESH_KEY = 'pp_dialer_refresh';
const USER_KEY = 'pp_dialer_user';

export interface DialerUser {
	user_id: string;
	org_id: string;
	first_name?: string;
	last_name?: string;
}

export interface DialerSession {
	access_token: string;
	refresh_token: string;
	user: DialerUser;
}

export const getAccessToken = (): string | null =>
	localStorage.getItem(ACCESS_KEY);

export const getRefreshToken = (): string | null =>
	localStorage.getItem(REFRESH_KEY);

export const getUser = (): DialerUser | null => {
	const raw = localStorage.getItem(USER_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as DialerUser;
	} catch {
		return null;
	}
};

export const hasSession = (): boolean =>
	!!getAccessToken() && !!getRefreshToken();

export const setSession = (session: DialerSession): void => {
	localStorage.setItem(ACCESS_KEY, session.access_token);
	localStorage.setItem(REFRESH_KEY, session.refresh_token);
	localStorage.setItem(USER_KEY, JSON.stringify(session.user));
};

/** Rotate just the access token (from a response's newAccessToken field). */
export const setAccessToken = (accessToken: string): void => {
	localStorage.setItem(ACCESS_KEY, accessToken);
};

/** Rotate just the refresh token (from a response's newRefreshToken field). */
export const setRefreshToken = (refreshToken: string): void => {
	localStorage.setItem(REFRESH_KEY, refreshToken);
};

export const clearSession = (): void => {
	localStorage.removeItem(ACCESS_KEY);
	localStorage.removeItem(REFRESH_KEY);
	localStorage.removeItem(USER_KEY);
};
