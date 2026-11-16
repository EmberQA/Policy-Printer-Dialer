import {expect, it} from 'vitest';
import {showsScriptDoc} from '@/scriptDoc/campaigns';

it.each([
	'$25 Final Expense (Social Tier 3)',
	'$30 Final Expense (Social Tier 2)',
	'$35 Final Expense (Social Tier 1)',
	'$35 Final Expense (Blended Exclusive Tier 2)',
	'$40 Final Expense (Blended Exclusive Tier 1)',
	'$55 Final Expense (CTV Tier 3)',
	'$60 Final Expense (CTV Tier 2)',
	'$65 Final Expense (CTV Tier 1)'
])('shows the script for the current tiered campaign %s', (name) => {
	expect(showsScriptDoc(name)).toBe(true);
	expect(showsScriptDoc(` ${name} `)).toBe(true);
});

it.each([
	'$30 Spanish Final Expense (Social)',
	'$30 Medicare (CTV)',
	'$70 Mortgage Protection'
])('keeps the English Final Expense script hidden for %s', (name) => {
	expect(showsScriptDoc(name)).toBe(false);
});

it('shows the script only on whitelisted campaigns (ENG-298)', () => {
	expect(showsScriptDoc('Final Expense (Social)')).toBe(true);
	expect(showsScriptDoc('[Accelerated] Final Expense (Social)')).toBe(true);
	expect(showsScriptDoc('$25 Final Expense (Social)')).toBe(true);
	expect(showsScriptDoc('$30 [Accelerated] Final Expense (Social)')).toBe(true);
	expect(showsScriptDoc('$35 Final Expense (CTV) (Line B)')).toBe(true);
	expect(showsScriptDoc('$35 Final Expense CTV + Premium Social (Blended)')).toBe(true);
	expect(showsScriptDoc(' $55 Final Expense (CTV) ')).toBe(true);
	expect(showsScriptDoc(' Final Expense (CTV) ')).toBe(true);
	for (const name of [
		'Final Expense (Pre Screened)',
		'XFG Final Expense',
		'Haydn (CTV)',
		'Haydn (Social)'
	])
		expect(showsScriptDoc(name)).toBe(true);
	expect(showsScriptDoc('Spanish Final Expense (Social)')).toBe(false);
	expect(showsScriptDoc('$30 Spanish Final Expense (Social)')).toBe(false);
	expect(showsScriptDoc('Final Expense (CTV) (Line B)')).toBe(false);
	expect(showsScriptDoc('Haydn CTV Campaign')).toBe(true);
	expect(showsScriptDoc('Haydn Social Campaign')).toBe(true);
	expect(showsScriptDoc('$40 Final Expense (Social)')).toBe(false);
	expect(showsScriptDoc(undefined)).toBe(false);
});
