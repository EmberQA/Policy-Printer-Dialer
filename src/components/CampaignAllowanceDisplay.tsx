import {type CSSProperties} from 'react';
import {type DialerCampaign} from '@/lib/api';
import {cn} from '@/lib/utils';

export function CampaignAllowanceDisplay({
	campaigns
}: {
	campaigns: DialerCampaign[];
}) {
	if (campaigns.length === 0) return null;

	return (
		<section aria-label="Campaign calls remaining" className="px-1 pb-1">
			<div className="px-1">
				<p className="text-xs font-semibold text-foreground">Calls remaining</p>
			</div>

			<div className="mt-1 divide-y divide-border/60">
				{campaigns.map((campaign, index) => {
					const remaining = campaign.calls_remaining;
					const available = typeof remaining === 'number';
					const urgent = available && remaining === 0;
					const low = available && remaining > 0 && remaining <= 5;
					const numberTone = urgent
						? 'text-destructive'
						: low
							? 'text-amber-700'
							: 'text-foreground';

					return (
						<div
							key={campaign.id}
							className="campaign-allowance-row flex min-w-0 items-center justify-between gap-3 px-1 py-1.5"
							style={
								{
									'--campaign-allowance-delay': `${index * 70}ms`
								} as CSSProperties
							}
						>
							<p className="min-w-0 truncate text-sm font-medium">
								{campaign.name}
							</p>
							<span
								className={cn(
									'shrink-0 text-sm font-semibold tabular-nums',
									available ? numberTone : 'text-muted-foreground'
								)}
							>
								{available
									? `${remaining.toLocaleString()} remaining`
									: remaining === undefined
										? 'Loading…'
										: 'Unavailable'}
							</span>
						</div>
					);
				})}
			</div>
		</section>
	);
}
