/**
 * ENG-308: "7 of 10 free quotes left this month" under the run buttons for agents
 * on the $150 seat; nothing for quoter (unlimited) agents.
 */
import {useQuoteAllowance} from './allowance';

export function QuoteAllowanceNote({pulls = 1}: {pulls?: number}) {
	const allowance = useQuoteAllowance();
	if (!allowance || allowance.unlimited) return null;
	const short = allowance.remaining < pulls;
	return (
		<p className={short ? 'text-center text-xs text-amber-700 dark:text-amber-300' : 'text-center text-xs text-muted-foreground'}>
			{allowance.remaining} of {allowance.limit} free quotes left this month
			{pulls > 1 ? ` · this uses ${pulls}` : ''}
			{short ? ' · add the quoter ($30/mo) from your billing card for unlimited' : ''}
		</p>
	);
}
