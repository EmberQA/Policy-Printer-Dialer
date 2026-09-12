/**
 * NewLeadBanner (ENG-234 Subplan 05) — a fixed, non-modal notice that a
 * purchased lead is waiting: "New lead: Jane D. (TX) — View". Never a dialog
 * (the agent may be mid-call). Hidden on the Leads tab itself, which
 * acknowledges on open; the poll then clears it.
 */

import {Link, useLocation} from 'react-router-dom';
import {Sparkles} from 'lucide-react';
import {useDialerSession} from '@/session/DialerSessionProvider';
import {leadShortLabel} from './leadDisplay';
import {useNewLeadPoll} from './useNewLeadPoll';

export const OUTBOUND_LEADS_PATH = '/outbound-leads';

export function NewLeadBanner() {
	const {provisioned} = useDialerSession();
	const location = useLocation();
	const onLeadsTab = location.pathname === OUTBOUND_LEADS_PATH;
	const {count, latest} = useNewLeadPoll(provisioned);

	if (!provisioned || onLeadsTab || count === 0 || !latest) return null;

	const others = count - 1;
	return (
		<div
			role="status"
			aria-live="polite"
			className="fixed top-20 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border border-primary/40 bg-card px-4 py-3 shadow-xl"
		>
			<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
				<Sparkles className="size-4" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold">
					New lead: {leadShortLabel(latest)}
				</p>
				{others > 0 && (
					<p className="text-xs text-muted-foreground">
						and {others} more waiting
					</p>
				)}
			</div>
			<Link
				to={OUTBOUND_LEADS_PATH}
				className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				View
			</Link>
		</div>
	);
}
