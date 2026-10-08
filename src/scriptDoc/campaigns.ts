/**
 * Campaigns whose calls show the Final Expense script doc (ENG-298).
 * EXPLICIT whitelist on the campaign's exact name: a new campaign never picks
 * the script up by accident — add it here. Spanish Final Expense is left out on
 * purpose (the script is English-only).
 */
export const SCRIPT_DOC_CAMPAIGNS: ReadonlySet<string> = new Set([
	'$25 Final Expense (Social)',
	'$30 [Accelerated] Final Expense (Social)',
	'$35 Final Expense (CTV) (Line B)',
	'$55 Final Expense (CTV)',
	'Final Expense (Social)',
	'[Accelerated] Final Expense (Social)',
	'Final Expense (CTV)',
	'Final Expense (Pre Screened)',
	'XFG Final Expense',
	'Haydn (CTV)',
	'Haydn (Social)'
]);

export const showsScriptDoc = (
	campaignName: string | null | undefined
): boolean =>
	Boolean(campaignName && SCRIPT_DOC_CAMPAIGNS.has(campaignName.trim()));
