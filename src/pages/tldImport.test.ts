import {beforeEach, describe, expect, it} from 'vitest';
import {
	filterImportedContacts,
	findMatchingAgentKey,
	importTldRows,
	listTldAgents,
	mapTldDisposition,
	parseTldCsv,
	rowsForAgent
} from './tldImport';

const HEADER =
	'lead_id,entry_date,full_name,email,phone_number,alt_phone,list_id,list_list_name,vendor_lead_code,status,called_count,called_since_last_reset,last_local_call_time,user_full_name,user_user_id';

const CSV = `${HEADER}\n23991,7/17/2026 12:27,William K Bultman III,test@example.com,18037571100,8031112222,35882,INDAGENT-BRIANTURNER,145423714,CALLBK,1,Y,,Brian Turner,267\n23990,7/17/2026 12:23,"Marsh, Donovan",,3616604400,,36312,INDAGENT-DONOVANMARS,145423548,TIWF,1,Y,7/17/2026 14:25,Donovan Marsh,320\n`;

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
		removeItem: (key: string) => stored.delete(key),
		clear: () => stored.clear()
	}
});

describe('TLD CSV import', () => {
	beforeEach(() => localStorage.clear());

	it('parses quoted CSV values and groups rows by TLD user', () => {
		const rows = parseTldCsv(CSV);
		expect(rows).toHaveLength(2);
		expect(rows[1].full_name).toBe('Marsh, Donovan');
		expect(listTldAgents(rows)).toEqual([
			{key: 'id:267', name: 'Brian Turner', userId: '267', count: 1},
			{key: 'id:320', name: 'Donovan Marsh', userId: '320', count: 1}
		]);
		expect(findMatchingAgentKey(listTldAgents(rows), ' brian  turner ')).toBe(
			'id:267'
		);
		expect(rowsForAgent(rows, 'id:267')).toHaveLength(1);
	});

	it('maps known TLD outcomes to Policy Printer dispositions', () => {
		expect(mapTldDisposition('SALE')).toEqual({
			key: 'sale',
			label: 'Sale Complete'
		});
		expect(mapTldDisposition('TIWF')).toEqual({
			key: 'thought_it_was_free',
			label: 'Thought It Was Free'
		});
		expect(mapTldDisposition('something-new')).toEqual({
			key: null,
			label: 'Unmapped (SOMETHING-NEW)'
		});
	});

	it('stores imports per signed-in user and upserts by TLD lead ID', () => {
		const rows = parseTldCsv(CSV);
		const first = importTldRows(
			'ember-user',
			rows,
			new Date('2026-07-20T12:00:00Z')
		);
		expect(first.added).toBe(2);
		expect(first.updated).toBe(0);
		expect(first.contacts[0].id).toMatch(/^tld:/);
		expect(first.contacts[0].notes).toContain('Imported from TLD');

		const second = importTldRows(
			'ember-user',
			[rows[0]],
			new Date('2026-07-20T13:00:00Z')
		);
		expect(second.added).toBe(0);
		expect(second.updated).toBe(1);
		expect(second.contacts).toHaveLength(2);
	});

	it('filters local imports for CRM search and callback view', () => {
		const contacts = importTldRows(
			'ember-user',
			parseTldCsv(CSV),
			new Date('2026-07-20T12:00:00Z')
		).contacts;
		expect(
			filterImportedContacts(contacts, {name: 'william'}, false)
		).toHaveLength(1);
		expect(
			filterImportedContacts(contacts, {caller_phone: '803757'}, false)
		).toHaveLength(1);
		expect(filterImportedContacts(contacts, {}, true)).toHaveLength(1);
		expect(
			filterImportedContacts(contacts, {campaign_id: 'server-campaign'}, false)
		).toHaveLength(0);
	});

	it('rejects a non-TLD CSV', () => {
		expect(() => parseTldCsv('name,phone\nA,123')).toThrow(/Missing:/);
	});
});
