import {expect, it} from 'vitest';
import {showsScriptDoc} from '@/scriptDoc/campaigns';

it('shows the script only on whitelisted campaigns (ENG-298)', () => {
	expect(showsScriptDoc('Final Expense (Social)')).toBe(true);
	expect(showsScriptDoc('[Accelerated] Final Expense (Social)')).toBe(true);
	expect(showsScriptDoc('Final Expense (CTV) (Line B)')).toBe(true);
	expect(showsScriptDoc(' Final Expense (CTV) ')).toBe(true);
	for (const name of [
		'Final Expense (Pre Screened)',
		'XFG Final Expense',
		'Haydn CTV Campaign',
		'Haydn Social Campaign',
		'Haydn (CTV)',
		'Haydn (Social)'
	])
		expect(showsScriptDoc(name)).toBe(true);
	expect(showsScriptDoc('Spanish Final Expense (Social)')).toBe(false);
	expect(showsScriptDoc('$40 Final Expense (Social)')).toBe(false);
	expect(showsScriptDoc(undefined)).toBe(false);
});
