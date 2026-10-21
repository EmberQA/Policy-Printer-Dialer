/** A session pins identity, never expiring logo URLs or authorization. */
export const SESSION_BRAND_COOKIE = 'session_team_brand';
export interface SessionBrandSelection {
  scope: string;
  host: string;
  source: 'host' | 'team';
  url: string;
}

export function readSessionBrand(raw: string | undefined, scope: string, host: string): SessionBrandSelection | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value && value.scope === scope && value.host === host &&
      (value.source === 'host' || value.source === 'team') && typeof value.url === 'string' && value.url.length > 0
      ? value : null;
  } catch { return null; }
}

/** A changed/missing identity is blank; never silently substitute a new brand. */
export async function refreshSessionBrand<T extends {url: string}>(
  selection: SessionBrandSelection,
  resolveHost: (host: string) => Promise<T | null>,
  resolveTeam: () => Promise<T | null>
): Promise<T | null> {
  try {
    const brand = await (selection.source === 'host' ? resolveHost(selection.host) : resolveTeam());
    return brand?.url === selection.url ? brand : null;
  } catch { return null; }
}
