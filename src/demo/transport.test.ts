import {beforeEach, describe, expect, it, vi} from 'vitest';
import {DEMO_AGENT, DEMO_ORG_ID, DEMO_OWNER} from './scope';
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
				'/policyPrinter/outboundLeads/order/create'
			])
				expect(await qsPost(path)).toMatchObject({live: true});
			expect(network).toHaveBeenCalledTimes(2);
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
