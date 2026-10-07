/**
 * Campaigns whose calls show the Final Expense script doc (ENG-298).
 * EXPLICIT whitelist on the campaign's exact name: a new campaign never picks
 * the script up by accident — add it here. Spanish Final Expense is left out on
 * purpose (the script is English-only).
 */
export const SCRIPT_DOC_CAMPAIGNS: ReadonlySet<string> = new Set([
	'Final Expense (Social)',
	'[Accelerated] Final Expense (Social)',
	'Final Expense (CTV) (Line B)',
	'Final Expense (CTV)',
	'Final Expense (Pre Screened)',
	'XFG Final Expense',
	'Haydn CTV Campaign',
	'Haydn Social Campaign',
	'Haydn (CTV)',
	'Haydn (Social)'
]);

export const showsScriptDoc = (
	campaignName: string | null | undefined
): boolean =>
	Boolean(campaignName && SCRIPT_DOC_CAMPAIGNS.has(campaignName.trim()));
