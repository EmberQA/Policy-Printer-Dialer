/**
 * NewLeadBanner (ENG-234 Subplan 05) — a fixed, non-modal notice that a
 * purchased lead is waiting: "New lead: Jane D. (TX) — View". Never a dialog
 * (the agent may be mid-call). The notice stays visible for ten seconds on every tab, even after rows
 * acknowledge themselves. Funding warnings remain visible.
 */

import {getDialerBranding} from '@/branding';
import {fundingWarning} from './fundingWarning';
import {Link} from 'react-router-dom';
import {Sparkles, X} from 'lucide-react';
import {useDialerSession} from '@/session/DialerSessionProvider';
import {leadShortLabel} from './leadDisplay';
import {useNewLeadPoll} from './useNewLeadPoll';
import {useLeadArrivalNotice} from './useLeadArrivalNotice';
import {Button} from '@/components/ui/button';

export const OUTBOUND_LEADS_PATH = '/outbound-leads';

export function NewLeadBanner() {
	const {provisioned, device} = useDialerSession();
	const {count, latest, funding} = useNewLeadPoll(provisioned);

	const {notice, dismiss} = useLeadArrivalNotice(
		latest,
		count,
		provisioned,
		device.outputDeviceId
	);
	if (!provisioned) return null;
	const warning = fundingWarning(funding);
	const showLead = notice !== null;

	const others = (notice?.count ?? 0) - 1;
	return (
		<>
			{warning && (
				<div
					role="status"
					className="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
				>
					<p>{warning}</p>
					<a
						className="font-semibold underline"
						href={new URL(
							'/dashboard/main',
							import.meta.env.PROD
								? getDialerBranding().portalUrl
								: 'http://localhost:3001'
						).toString()}
						target="_blank"
						rel="noopener noreferrer"
					>
						Open wallet to add funds
					</a>
					{' · '}
					<Link to={OUTBOUND_LEADS_PATH} className="underline">
						View orders
					</Link>
				</div>
			)}
			{showLead && (
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
							New lead: {leadShortLabel(notice!.lead)}
						</p>
						{others > 0 && (
							<p className="text-xs text-muted-foreground">
								and {others} more waiting
							</p>
						)}
					</div>
					<Link
						to={OUTBOUND_LEADS_PATH}
						onClick={dismiss}
						className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						View
					</Link>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Dismiss new lead notification"
						onClick={dismiss}
					>
						<X className="size-4" />
					</Button>
				</div>
			)}
		</>
	);
}
