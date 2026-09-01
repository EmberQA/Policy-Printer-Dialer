import {RankBadge} from './RankBadge';
import type {RankingProgress} from './types';

const ProgressBar = ({
	label,
	value,
	current,
	required,
	color
}: {
	label: string;
	value: number;
	current: number;
	required: number;
	color: string;
}) => (
	<div
		role="progressbar"
		aria-label={`${label}: ${current} of ${required}`}
		aria-valuemin={0}
		aria-valuemax={required}
		aria-valuenow={Math.min(current, required)}
		className="h-1 overflow-hidden rounded-full bg-muted"
	>
		<div
			className={`h-full rounded-full ${color}`}
			style={{width: `${Math.max(0, Math.min(100, value))}%`}}
		/>
	</div>
);

export function CompactRankDisplay({progress}: {progress: RankingProgress}) {
	const rank = progress.current_rank;
	const next = progress.next_rank;
	return (
		<div
			className="flex w-45 items-center gap-2 rounded-lg border bg-background/70 px-2 py-1.5"
			aria-label={`Current rank ${rank.title}`}
		>
			<RankBadge rankKey={rank.image_key} title={rank.title} size={38} />
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-bold leading-4">{rank.title}</p>
				{next ? (
					<div className="mt-1 space-y-1">
						<ProgressBar
							label={`XP progress to ${next.title}`}
							value={progress.xp_progress_percent}
							current={progress.xp}
							required={next.xp_required}
							color="bg-primary"
						/>
						<ProgressBar
							label={`AI sales progress to ${next.title}`}
							value={progress.sales_progress_percent}
							current={progress.ai_sales}
							required={next.sales_required}
							color="bg-success"
						/>
					</div>
				) : (
					<p className="mt-0.5 text-[10px] font-semibold text-success">Max rank</p>
				)}
			</div>
		</div>
	);
}
