/**
 * ENG-201: where the agent's own calls have been coming from lately.
 *
 * Deliberately read-only decoration in the left column — it renders nothing at all
 * until there is something to show, so a brand new agent (or a failed poll) never
 * gets an empty box staring back at them.
 */

import {Card, CardContent} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {type HotStateCount} from '@/lib/api';
import {hotStateFlames, hotStateTier} from './hotStateTier';

export function HotStatesCard({
	states,
	windowDays
}: {
	states: HotStateCount[];
	windowDays: number | null;
}) {
	if (states.length === 0) return null;

	const topCallCount = states[0].call_count;

	return (
		<Card className="shadow-xs">
			<CardContent className="space-y-2 p-4">
				<div className="flex items-baseline justify-between gap-2">
					<p className="text-sm font-semibold text-foreground">
						Your hot states 🔥
					</p>
					<p className="shrink-0 text-xs text-muted-foreground">
						{windowDays ? `Last ${windowDays} days` : 'Recent calls'}
					</p>
				</div>

				<div className="divide-y divide-border/60">
					{states.map((entry) => {
						const tier = hotStateTier(entry.call_count, topCallCount);
						return (
							<div
								key={entry.state}
								className="flex min-w-0 items-center justify-between gap-3 py-1.5"
							>
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
					})}
				</div>
			</CardContent>
		</Card>
	);
}
