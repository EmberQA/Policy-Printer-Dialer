/**
 * ENG-201: which states the org has been taking calls from lately.
 *
 * Always exactly the top 3, ties included — the backend's ordering is total, so the
 * three shown are simply the first three and never swap places between polls. The
 * remainder hides behind a caret, and clicking anywhere on the card toggles it.
 * Deliberately read-only decoration in the left
 * column: it renders nothing at all until there is something to show, so a quiet
 * window (or a failed poll) never leaves an empty box staring back.
 */

import {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {Card, CardContent} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {type HotStateCount} from '@/lib/api';
import {hotStateFlames, hotStateTier} from './hotStateTier';

const TOP_STATE_COUNT = 3;

function HotStateRow({
	entry,
	topCallCount
}: {
	entry: HotStateCount;
	topCallCount: number;
}) {
	const tier = hotStateTier(entry.call_count, topCallCount);
	return (
		<div className="flex min-w-0 items-center justify-between gap-3 py-1.5">
			<span className="flex min-w-0 items-center gap-2">
				<span
					className={cn(
						'text-sm font-semibold tabular-nums',
						tier === 3 ? 'text-amber-700' : 'text-foreground'
					)}
				>
					{entry.state}
				</span>
				<span aria-hidden className="text-xs leading-none">
					{hotStateFlames(tier)}
				</span>
			</span>
			<span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
				{entry.call_count.toLocaleString()}
				<span className="ml-1 font-normal">
					{entry.call_count === 1 ? 'call' : 'calls'}
				</span>
			</span>
		</div>
	);
}

export function HotStatesCard({
	states,
	windowHours
}: {
	states: HotStateCount[];
	windowHours: number | null;
}) {
	const [expanded, setExpanded] = useState(false);

	if (states.length === 0) return null;

	const topCallCount = states[0].call_count;
	const top = states.slice(0, TOP_STATE_COUNT);
	const rest = states.slice(TOP_STATE_COUNT);

	const body = (
		<>
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-sm font-semibold text-foreground">Hot states 🔥</p>
				<p className="shrink-0 text-xs text-muted-foreground">
					{windowHours ? `Last ${windowHours} hours` : 'Recent calls'}
				</p>
			</div>

			<div className="divide-y divide-border/60">
				{top.map((entry) => (
					<HotStateRow
						key={entry.state}
						entry={entry}
						topCallCount={topCallCount}
					/>
				))}
				{expanded &&
					rest.map((entry) => (
						<HotStateRow
							key={entry.state}
							entry={entry}
							topCallCount={topCallCount}
						/>
					))}
			</div>

			{rest.length > 0 && (
				<span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
					{expanded ? 'Show less' : `Show ${rest.length} more`}
					<ChevronDown
						className={cn(
							'size-3.5 shrink-0 transition-transform',
							expanded && 'rotate-180'
						)}
					/>
				</span>
			)}
		</>
	);

	// The whole card is the toggle, so it is ONE button rather than a card with a
	// caret button nested inside it (a button in a button is invalid, and splitting
	// the hit target would leave most of the card dead to a click). With nothing to
	// expand there is nothing to press, so it stays a plain div.
	return (
		<Card className="shadow-xs">
			<CardContent className="p-0">
				{rest.length > 0 ? (
					<button
						type="button"
						onClick={() => setExpanded((current) => !current)}
						aria-expanded={expanded}
						aria-label={
							expanded
								? 'Collapse hot states'
								: `Expand hot states, ${rest.length} more`
						}
						className="w-full cursor-pointer space-y-2 rounded-lg p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					>
						{body}
					</button>
				) : (
					<div className="space-y-2 p-4">{body}</div>
				)}
			</CardContent>
		</Card>
	);
}
