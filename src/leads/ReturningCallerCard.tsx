/**
 * ReturningCallerCard — the direct-dial callback notification + prior-history strip.
 *
 * Shown ABOVE the lead form when the backend classifies a live inbound call as a
 * direct dial (a callback to the agent's own DID) AND finds prior activity for the
 * caller. It renders nothing for a first-time caller or a Retreaver-routed call, so
 * the normal blank-form experience is untouched. The editable prior lead itself is
 * driven by LeadForm's edit-in-place mode (seeded from the same most_recent_lead);
 * this card is the "this is a returning caller" cue + the read-only history context.
 */

import {History, PhoneIncoming, PhoneOutgoing, X} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import type {ReturningCallerResponse} from '@/lib/api';

export function ReturningCallerCard({
	result,
	direction = 'inbound',
	onDismiss
}: {
	result: ReturningCallerResponse | null;
	/** 'inbound' → returning-caller / callback framing. 'outbound' → the agent
	 *  dialed this number, so re-label to a neutral "Prior history" (the history is
	 *  still surfaced, just without the "callback" wording that misreads on a call we
	 *  initiated). Same underlying is_direct_dial history either way. */
	direction?: 'inbound' | 'outbound';
	/** Dismiss the pane for the current call. The parent keys visibility to the call,
	 *  so a new call re-shows it. Omit to render without a close button. */
	onDismiss?: () => void;
}) {
	// Only surface with real prior history. is_direct_dial is true for a genuine
	// inbound callback AND for an outbound call (no reservation → classified direct-dial
	// server-side). Loading/error/empty and Retreaver-routed calls render nothing.
	if (!result?.is_direct_dial) return null;
	const activity = result.activity ?? [];
	const lead = result.most_recent_lead?.lead ?? null;
	if (!lead && activity.length === 0) return null;

	const total = result.total_matches ?? activity.length;
	const isOutbound = direction === 'outbound';

	return (
		<Card className="border-amber-500/40 bg-amber-500/5 shadow-xs">
			<CardHeader className="space-y-2">
				<CardTitle className="flex items-start justify-between gap-4">
					<span className="flex items-center gap-2">
						{isOutbound ? (
							<PhoneOutgoing className="size-5 text-amber-600" />
						) : (
							<PhoneIncoming className="size-5 text-amber-600" />
						)}
						<span>
							<span className="block text-lg">
								{isOutbound ? 'Prior history' : 'Returning caller'}
							</span>
							<span className="mt-0.5 block text-sm font-normal leading-6 text-muted-foreground">
								This {isOutbound ? 'contact' : 'caller'} has {total} prior{' '}
								{total === 1 ? 'record' : 'records'} — the most recent lead is
								loaded in the form for you to review and update.
							</span>
						</span>
					</span>
					<span className="flex shrink-0 items-center gap-1">
						<Badge className="bg-amber-500 text-white">
							<History className="size-3" />
							{isOutbound ? 'history' : 'callback'}
						</Badge>
						{onDismiss && (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-7 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
								aria-label="Dismiss returning-caller notice"
								onClick={onDismiss}
							>
								<X className="size-4" />
							</Button>
						)}
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				<ul className="space-y-1">
					{activity.slice(0, 5).map((item) => (
						<li
							key={item.id}
							className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/60 px-3 py-2"
						>
							<span className="flex flex-wrap items-center gap-2">
								<span className="font-medium">
									{item.name || item.caller_phone || 'Unknown caller'}
								</span>
								{item.campaign_name && (
									<Badge variant="outline">{item.campaign_name}</Badge>
								)}
								{item.disposition_label && (
									<span className="text-muted-foreground">
										{item.disposition_label}
									</span>
								)}
							</span>
							<span className="text-xs text-muted-foreground">
								{fmt(item.activity_at)}
							</span>
						</li>
					))}
				</ul>
				{total > Math.min(activity.length, 5) && (
					<p className="text-xs text-muted-foreground">
						Showing {Math.min(activity.length, 5)} of {total}. See the Leads tab
						for the full history.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function fmt(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
