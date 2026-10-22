import {beforeEach, describe, expect, it, vi} from 'vitest';
import {DEMO_AGENT, DEMO_ORG_ID, DEMO_OWNER} from './scope';
import leadForm from './leadForm.json';
const state = vi.hoisted(() => ({
	user: null as null | {org_id: string; user_id: string}
}));
vi.mock('@/auth/session', () => ({
	getUser: () => state.user,
	getAccessToken: () => null,
	getRefreshToken: () => null,
	setAccessToken: vi.fn(),
	setRefreshToken: vi.fn(),
	clearSession: vi.fn()
}));
import {api, qsPost} from '../lib/api';
const network = vi.fn(async (config: any) => ({
	data: {statusCode: 'SP100', data: {live: true}},
	status: 200,
	statusText: 'OK',
	headers: {},
	config
}));
beforeEach(() => {
	network.mockClear();
	api.defaults.adapter = network;
	state.user = {...DEMO_AGENT};
});
describe('verified demo transport isolation', () => {
  it('uses the full production form schema while keeping demo saves off the network', async () => {
    const {form} = await qsPost<any>('/policyPrinter/dialer/leadForm/get', {});
    expect(form.org_id).toBe(DEMO_ORG_ID);
    expect(form.id).toBe('recording-form');
    expect(form.version).toBe(6);
    expect(form.schema).toEqual(leadForm.schema);
    expect(form.schema.map((field: any) => field.key)).toEqual([
      'first_name', 'last_name', 'phone', 'address', 'address2', 'city', 'state',
      'zip', 'email', 'dob', 'sob', 'weight', 'height', 'dl_number', 'notes', 'sex', 'tobacco'
    ]);
    await qsPost('/policyPrinter/dialer/lead/save', {
      campaign_id: '6482e3d8-21c5-4d7c-ad6d-9ce0320c46c3',
      caller_phone: '+12025550101',
      form_data: {first_name: 'Test', last_name: 'Caller', state: 'FL', height: '5\'8"'}
    });
    expect(network).not.toHaveBeenCalled();
  });
	it('simulates purchases without calling the network adapter', async () => {
		await qsPost('/policyPrinter/outboundLeads/order/create', {
			daily_cap: 2,
			max_cap: 10,
			states: ['us-fl']
		});
		expect(network).not.toHaveBeenCalled();
	});
	it.each([
		'/policyPrinter/dialer/token',
		'/policyPrinter/dialer/outbound/start',
		'/policyPrinter/outboundLeads/smsContact/start',
		'/policyPrinter/dialer/admin/provision',
		'/policyPrinter/outboundLeads/lead/setStatus',
		'/unknown'
	])('fails closed for %s', async (path) => {
		await expect(qsPost(path)).rejects.toThrow();
		expect(network).not.toHaveBeenCalled();
	});
	it('retains live authenticated branding, CRM and historical activity reads', async () => {
		for (const path of [
			'/teams/branding/mine',
			'/policyPrinter/dialer/hotStates',
			'/policyPrinter/dialer/crm/list',
			'/policyPrinter/dialer/leads/list',
			'/policyPrinter/dialer/lead/detail',
			'/policyPrinter/dialer/activity/summary',
			'/policyPrinter/outboundLeads/list',
			'/policyPrinter/outboundLeads/lead/get'
		])
			expect(await qsPost(path)).toMatchObject({live: true});
		expect(network).toHaveBeenCalledTimes(8);
	});
	it.each([
		{
			org_id: '3937755e-daa5-434d-8179-df54af7a888b',
			user_id: DEMO_AGENT.user_id
		},
		{org_id: DEMO_ORG_ID, user_id: 'another-user'},
		null
	])(
		'preserves existing transport outside pinned demo identities',
		async (user) => {
			state.user = user;
			for (const path of [
				'/policyPrinter/dialer/token',
				'/policyPrinter/dialer/leadForm/get',
				'/policyPrinter/outboundLeads/order/create'
			])
				expect(await qsPost(path)).toMatchObject({live: true});
			expect(network).toHaveBeenCalledTimes(3);
		}
	);
	it('also prevents real carrier actions for the existing demo owner', async () => {
		state.user = {...DEMO_OWNER};
		await expect(
			qsPost('/policyPrinter/dialer/outbound/start')
		).rejects.toThrow();
		expect(network).not.toHaveBeenCalled();
	});
});
