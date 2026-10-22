import {afterEach, describe, expect, it, vi} from 'vitest';
import {buildBrandingFromTeam, getDialerBranding, setDynamicDialerBranding} from './branding';
import {getDialerBrandContent} from './brandContent';
afterEach(() => {setDynamicDialerBranding(null); vi.unstubAllGlobals();});
describe('resolved identities only', () => {
  it.each([['emberqa.com','EmberQA'],['policyprinter.io','Policy Printer'],['policygrowth.link','Policy Growth']])('%s uses resolved copy', (url, name) => {
    setDynamicDialerBranding(buildBrandingFromTeam({url,brand_name:name,brand_logo_url:null}));
    expect(getDialerBranding().appName).toBe(name);
    expect(getDialerBranding().logoUrl).toBe('');
  });
  it('unknown host and stale query cannot select PP', () => {
    vi.stubGlobal('window', {location:{hostname:'dialer.policygrowth.link',search:'?dialer_brand=policy_printer'}});
    expect(getDialerBranding().appName).toBe('');
  });
  it('clearing resolved identity removes stale copy', () => {
    setDynamicDialerBranding(buildBrandingFromTeam({url:'policyprinter.io',brand_name:'Policy Printer',brand_logo_url:null}));
    setDynamicDialerBranding(null);
    expect(getDialerBranding().appName).toBe('');
  });
  it('external content belongs to its resolved brand', () => {
    expect(getDialerBrandContent('https://app.policyprinter.io').coachingUrl).toContain('chrispolicyprinter');
    for (const url of [null,'','https://app.emberqa.com','https://app.policygrowth.link','https://app.policyprinter.io.evil.test']) {
      expect(getDialerBrandContent(url)).toEqual({coachingUrl:null,trainingVideoUrl:null});
    }
  });
});

it('uses team content and honors explicit clears without PP fallbacks', () => {
  expect(getDialerBrandContent('https://app.policygrowth.link', {coaching_url: 'https://calendly.com/growth/coaching', dialer_training_url: 'https://www.loom.com/embed/growth'})).toEqual({coachingUrl: 'https://calendly.com/growth/coaching', trainingVideoUrl: 'https://www.loom.com/embed/growth'});
  expect(getDialerBrandContent('https://app.policyprinter.io', {coaching_url: null, dialer_training_url: null})).toEqual({coachingUrl: null, trainingVideoUrl: null});
});

it.each([['dialer.policyprinter.io','Policy Printer'],['dialer.emberqa.com','EmberQA']])('explicit base host %s needs no root team', (hostname, name) => {
 vi.stubGlobal('window', {location:{hostname,search:''}});
 expect(getDialerBranding().appName).toBe(name);
});
it('failed selected team stays blank even on a base host', async () => {
 const {BLANK_BRANDING} = await import('./branding');
 vi.stubGlobal('window', {location:{hostname:'dialer.policyprinter.io',search:''}});
 setDynamicDialerBranding(BLANK_BRANDING);
 expect(getDialerBranding().appName).toBe('');
 setDynamicDialerBranding(buildBrandingFromTeam({url:'policygrowth.link',brand_name:'PolicyGrowth',brand_logo_url:null}));
 expect(getDialerBranding().logoUrl).toBe('');
 expect(getDialerBranding().appName).toBe('PolicyGrowth');
});
