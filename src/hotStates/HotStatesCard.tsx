/**
 * ENG-201: which states the org has been taking calls from lately.
 *
 * Shows the backend's first three states until expanded, and at most ten states
 * when expanded. Rank is communicated with fixed flame bands: three flames for
 * ranks 1–3, two for 4–6, and one for 7–10.
 * Deliberately read-only decoration in the right sidebar: it renders nothing at all
 * until there is something to show, so a quiet window (or a failed poll) never
 * leaves an empty box staring back.
 */

import {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {Card, CardContent} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {type HotStateCount} from '@/lib/api';
import {hotStateFlames, hotStateTier} from './hotStateTier';

const MAX_STATE_COUNT = 10;
const COLLAPSED_STATE_COUNT = 3;

function HotStateRow({entry, rank}: {entry: HotStateCount; rank: number}) {
	const tier = hotStateTier(rank);
	return (
		<div className="flex min-w-0 items-center justify-between gap-3 py-1.5">
			<span className="min-w-0 text-sm font-semibold text-foreground">
				{entry.state}
			</span>
			<span
				className="shrink-0 text-xs leading-none"
				aria-label={`${tier} ${tier === 1 ? 'flame' : 'flames'}`}
			>
				<span aria-hidden>{hotStateFlames(tier)}</span>
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

	const rankedStates = states.slice(0, MAX_STATE_COUNT);
	const visibleStates = expanded
		? rankedStates
		: rankedStates.slice(0, COLLAPSED_STATE_COUNT);
	const hiddenCount = Math.max(0, rankedStates.length - COLLAPSED_STATE_COUNT);

	const body = (
		<>
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-sm font-semibold text-foreground">Hot States 🔥</p>
				<p className="shrink-0 text-xs text-muted-foreground">
					{windowHours ? `States with most calls today` : 'Recent calls'}
				</p>
			</div>

			<div className="divide-y divide-border/60">
				{visibleStates.map((entry, index) => (
					<HotStateRow key={entry.state} entry={entry} rank={index + 1} />
				))}
			</div>

			{hiddenCount > 0 && (
				<span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
					{expanded ? 'Show less' : `Show ${hiddenCount} more`}
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

	return (
		<Card className="shadow-xs">
			<CardContent className="p-0">
				{hiddenCount > 0 ? (
					<button
						type="button"
						onClick={() => setExpanded((current) => !current)}
						aria-expanded={expanded}
						aria-label={expanded ? 'Collapse hot states' : 'Expand hot states'}
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
