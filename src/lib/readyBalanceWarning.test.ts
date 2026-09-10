import {describe, expect, it} from 'vitest';
import type {CampaignRemainingCalls, CampaignRemainingCallsResponse} from './api';
import {getReadyBalanceWarning} from './readyBalanceWarning';

const balance: CampaignRemainingCalls = {
 campaign_id: 'a', campaign_name: 'Campaign A', calls_remaining_status: 'available',
 calls_remaining: 3, calls_allotted: 3, calls_used: 0,
 daily_cap: null, daily_used: null, daily_remaining: null
};
const selected = [{id: 'a', name: 'Campaign A'}];
const response = (patch: Partial<CampaignRemainingCalls> = {}): CampaignRemainingCallsResponse => ({
 statusCode: 'SP100', statusMessage: '', campaigns: [{...balance, ...patch}]
});
describe('getReadyBalanceWarning', () => {
 it('warns about confirmed zero and missing hard caps', () => {
  expect(getReadyBalanceWarning(response({calls_remaining: 0}), selected)).toContain('Purchase calls');
  expect(getReadyBalanceWarning(response({calls_remaining_status: 'hard_cap_not_configured', calls_remaining: null}), selected)).toContain('Purchase calls');
 });
 it.each(['retreaver_unavailable', 'retreaver_not_configured', 'buyer_id_not_configured', 'invalid_hard_cap'] as const)('skips %s even with a stale zero balance', (status) => {
  expect(getReadyBalanceWarning(response({calls_remaining_status: status, calls_remaining: 0}), selected)).toBeNull();
 });
 it('skips failed, empty, and unknown responses', () => {
  expect(getReadyBalanceWarning({...response({calls_remaining: 0}), statusCode: 'SP500'}, selected)).toBeNull();
  expect(getReadyBalanceWarning({statusCode: 'SP100', statusMessage: ''}, selected)).toBeNull();
  expect(getReadyBalanceWarning(response({calls_remaining: null}), selected)).toBeNull();
 });
 it('ignores unselected campaigns and funded campaigns', () => {
  expect(getReadyBalanceWarning(response({calls_remaining: 0}), [])).toBeNull();
  expect(getReadyBalanceWarning(response(), selected)).toBeNull();
 });
 it('distinguishes the daily limit from needing credits', () => {
  const warning = getReadyBalanceWarning(response({daily_cap: 6, daily_remaining: 0}), selected);
  expect(warning).toContain('daily call limit');
  expect(warning).not.toContain('Purchase');
 });
});
