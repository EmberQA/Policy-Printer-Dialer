/**
 * Campaigns whose calls show the Final Expense script doc (ENG-298).
 * EXPLICIT whitelist on the campaign's exact name: a new campaign never picks
 * the script up by accident — add it here. Spanish Final Expense is left out on
 * purpose (the script is English-only).
 */
export const SCRIPT_DOC_CAMPAIGNS: ReadonlySet<string> = new Set([
	'$25 Final Expense (Social Tier 3)',
	'$30 Final Expense (Social Tier 2)',
	'$35 Final Expense (Social Tier 1)',
	'$35 Final Expense (Blended Exclusive Tier 2)',
	'$40 Final Expense (Blended Exclusive Tier 1)',
	'$55 Final Expense (CTV Tier 3)',
	'$60 Final Expense (CTV Tier 2)',
	'$65 Final Expense (CTV Tier 1)',
	'$25 Final Expense (Social)',
	'$30 [Accelerated] Final Expense (Social)',
	'$35 Final Expense (CTV) (Line B)',
	'$35 Final Expense CTV + Premium Social (Blended)',
	'$55 Final Expense (CTV)',
	'Final Expense (Social)',
	'[Accelerated] Final Expense (Social)',
	'Final Expense (CTV)',
	'Final Expense (Pre Screened)',
	'XFG Final Expense',
	'Haydn (CTV)',
	'Haydn (Social)',
	'Haydn CTV Campaign',
	'Haydn Social Campaign'
]);

export const showsScriptDoc = (
	campaignName: string | null | undefined
): boolean =>
	Boolean(campaignName && SCRIPT_DOC_CAMPAIGNS.has(campaignName.trim()));
