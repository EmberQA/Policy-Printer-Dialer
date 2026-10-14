/**
 * ENG-308: every quote entry point renders through this. Without the quoter
 * add-on the button stays visible (it is the upsell) but disabled, with a hover
 * hint on a wrapping span — a disabled button receives no pointer events, so the
 * title has to live on its parent. The backend quote gate is authoritative.
 */
import type {ComponentProps} from 'react';
import {Button} from '@/components/ui/button';
import {useQuoterAccess} from '@/session/DialerSessionProvider';
import {QUOTER_LOCKED_TITLE} from './quoteLink';

export function QuoteButton({
	disabled,
	wrapperClassName = 'inline-flex',
	...props
}: ComponentProps<typeof Button> & {
	/** Layout of the hint wrapper when locked; a full-width button needs 'flex w-full'. */
	wrapperClassName?: string;
}) {
	const quoterAccess = useQuoterAccess();
	const button = <Button {...props} disabled={disabled || !quoterAccess} />;
	if (quoterAccess) return button;
	return (
		<span title={QUOTER_LOCKED_TITLE} className={wrapperClassName}>
			{button}
		</span>
	);
}
