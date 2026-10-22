import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'vitest';
import {DEMO_AGENT, DEMO_ORG_ID, isVerifiedDemoUser} from './scope';
import {DialerRecordingStore} from './store';

test('dialer recognizes exact identities and blocks live provider routes', () => {
  assert.equal(isVerifiedDemoUser({ org_id: DEMO_ORG_ID, user_id: DEMO_AGENT.user_id }), true);
  assert.equal(isVerifiedDemoUser({ org_id: 'production', user_id: DEMO_AGENT.user_id }), false);
  assert.equal(isVerifiedDemoUser({ org_id: DEMO_ORG_ID, user_id: 'someone-else' }), false);
  const s = new DialerRecordingStore();
  for (const p of [
    '/policyPrinter/dialer/token',
    '/policyPrinter/dialer/outbound/start',
    '/policyPrinter/outboundLeads/smsContact/start',
    '/policyPrinter/dialer/admin/provision'
  ])
    assert.throws(() => s.request(p, {}));
});

test('demo lead order changes in-memory orders without real balance updates', () => {
  const s = new DialerRecordingStore(),
    before = s.balance;
  s.request('/policyPrinter/outboundLeads/order/create', {
    daily_cap: 5,
    max_cap: 20,
    states: ['us-fl'],
    coverage_types: ['final_expense'],
    working_hours_start: '09:00',
    working_hours_end: '17:00',
    timezone: 'America/New_York'
  });
  assert.equal(s.leadOrders.length, 1);
  assert.equal(s.balance, before);
  assert.equal(new DialerRecordingStore().leadOrders.length, 0);
});

test('demo provider is selected before mounting live carrier hooks, microphone disabled', () => {
  const provider = readFileSync('src/session/DialerSessionProvider.tsx', 'utf8');
  assert.match(provider, /isVerifiedDemoUser\(getUser\(\)\) \? <DemoSession>/);
  const demo = readFileSync('src/demo/Session.tsx', 'utf8');
  assert.doesNotMatch(demo, /\buseDevice\(|\buseHeartbeat\(|\bgetUserMedia\(/);
  assert.match(
    readFileSync('src/twilio/MicLevelMeter.tsx', 'utf8'),
    /!enabled \|\| isVerifiedDemoUser\(getUser\(\)\)/
  );
});

test('synthetic call wrap-up rejects real destinations and accepts only demo call identifiers', () => {
  const s = new DialerRecordingStore();
  const body = {
    campaign_id: s.campaigns[0].id,
    caller_phone: '+12025550101',
    twilio_call_sid: 'debug-incoming-call-test',
    disposition_id: 'recording-disposition-contacted'
  };
  assert.equal(s.request('/policyPrinter/dialer/call/disposition', body).call_id, body.twilio_call_sid);
  assert.throws(() => s.request('/policyPrinter/dialer/call/disposition', { ...body, caller_phone: '+14045551234' }));
  assert.throws(() => s.request('/policyPrinter/dialer/call/disposition', { ...body, twilio_call_sid: 'real-call' }));
});

test('dialer exposes the seven configured demo campaigns', () => {
  const s = new DialerRecordingStore();
  assert.equal(s.campaigns.length, 7);
  assert.ok(s.campaigns.every(c => c.has_buyer && c.unit_price_cents > 0));
  assert.ok(s.campaigns.some(c => c.slug === 'mortgage_protection'));
});
