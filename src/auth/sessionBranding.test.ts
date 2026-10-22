import {beforeEach, describe, expect, it, vi} from 'vitest';
import {readSessionBrand, refreshSessionBrand, SESSION_BRAND_COOKIE} from './sessionBranding';
import {clearSession, setSession} from './session';
const selected = {scope:'u/o', host:'dialer.policygrowth.link', source:'host' as const, url:'policygrowth.link'};
beforeEach(() => {
  const values = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});
});
describe('session branding', () => {
  it('restores only the matching session and host', () => {
    expect(readSessionBrand(JSON.stringify(selected),selected.scope,selected.host)).toEqual(selected);
    expect(readSessionBrand(JSON.stringify(selected),'another-user',selected.host)).toBeNull();
    expect(readSessionBrand(JSON.stringify(selected),selected.scope,'other-host')).toBeNull();
  });
  it('refreshes the pinned host without team membership', async () => {
    const team = vi.fn();
    expect(await refreshSessionBrand(selected,async()=>({url:selected.url}),team)).toEqual({url:selected.url});
    expect(team).not.toHaveBeenCalled();
  });
  it('never substitutes another brand on null, error or changed identity', async () => {
    const team = vi.fn();
    for (const host of [async()=>null,async()=>({url:'policyprinter.io'}),async()=>{throw Error('offline');}])
      expect(await refreshSessionBrand(selected,host,team)).toBeNull();
    expect(team).not.toHaveBeenCalled();
  });
  it('clears selection on logout and new handoff session', () => {
    localStorage.setItem(SESSION_BRAND_COOKIE,JSON.stringify(selected));
    clearSession();
    expect(localStorage.getItem(SESSION_BRAND_COOKIE)).toBeNull();
    localStorage.setItem(SESSION_BRAND_COOKIE,JSON.stringify(selected));
    setSession({access_token:'test',refresh_token:'test',user:{user_id:'u',org_id:'o'}});
    expect(localStorage.getItem(SESSION_BRAND_COOKIE)).toBeNull();
  });
});
