/**
 * Every quote entry point renders through this. ENG-308: every agent with a seat
 * can open the quote tool — the $150 seat includes 10 quotes a month and the
 * quoter add-on makes them unlimited — so the button is never locked here; the
 * backend meters Run quote / Quote Compare and explains when the month runs out.
 * Kept as one component so a future gate has one place to live.
 */
import type {ComponentProps} from 'react';
import {Button} from '@/components/ui/button';

export function QuoteButton({
	wrapperClassName: _wrapperClassName,
	...props
}: ComponentProps<typeof Button> & {
	/** Layout of a wrapper, for call sites that pass one (full-width buttons). */
	wrapperClassName?: string;
}) {
	return <Button {...props} />;
}
