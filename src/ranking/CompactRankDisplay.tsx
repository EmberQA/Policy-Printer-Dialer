import {RankBadge} from './RankBadge';
import type {PolicyPrinterRankKey, RankingProgress} from './types';

const RANK_GRADIENT =
	'linear-gradient(100deg, #0284c7 0%, #06b6d4 34%, #14b8a6 64%, #16a34a 100%)';
const RANK_TITLE_GRADIENTS: Record<PolicyPrinterRankKey, string> = {
	recruit_1: 'linear-gradient(100deg, #475569 0%, #cbd5e1 42%, #64748b 100%)',
	recruit_2: 'linear-gradient(100deg, #475569 0%, #cbd5e1 42%, #64748b 100%)',
	recruit_3: 'linear-gradient(100deg, #475569 0%, #cbd5e1 42%, #64748b 100%)',
	closer_1: 'linear-gradient(100deg, #5b21b6 0%, #8b5cf6 48%, #c084fc 100%)',
	closer_2: 'linear-gradient(100deg, #5b21b6 0%, #8b5cf6 48%, #c084fc 100%)',
	closer_3: 'linear-gradient(100deg, #5b21b6 0%, #8b5cf6 48%, #c084fc 100%)',
	top_closer_1: 'linear-gradient(100deg, #1d4ed8 0%, #3b82f6 50%, #6366f1 100%)',
	top_closer_2: 'linear-gradient(100deg, #1d4ed8 0%, #3b82f6 50%, #6366f1 100%)',
	top_closer_3: 'linear-gradient(100deg, #1d4ed8 0%, #3b82f6 50%, #6366f1 100%)',
	master_closer_1: 'linear-gradient(100deg, #7c3aed 0%, #d946ef 48%, #fb923c 100%)',
	master_closer_2: 'linear-gradient(100deg, #7c3aed 0%, #d946ef 48%, #fb923c 100%)',
	master_closer_3: 'linear-gradient(100deg, #7c3aed 0%, #d946ef 48%, #fb923c 100%)',
	policy_printer: 'linear-gradient(100deg, #0f172a 0%, #2563eb 42%, #d4a72c 100%)'
};

const ProgressBar = ({
	label,
	ariaLabel,
	value,
	current,
	required
}: {
	label: string;
	ariaLabel: string;
	value: number;
	current: number;
	required: number;
}) => (
	<div>
		<div className="mb-0.5 flex items-center justify-between gap-2 text-[9px] leading-none text-muted-foreground">
			<span className="font-extrabold tracking-[0.08em]">{label}</span>
			<span className="hidden tabular-nums sm:inline">
				{current.toLocaleString()} / {required.toLocaleString()}
			</span>
		</div>
		<div
			role="progressbar"
			aria-label={`${ariaLabel}: ${current} of ${required}`}
			aria-valuemin={0}
			aria-valuemax={required}
			aria-valuenow={Math.min(current, required)}
			className="h-[7px] overflow-hidden rounded-full bg-cyan-100/80"
		>
			<div
				className="h-full rounded-full"
				style={{
					width: `${Math.max(0, Math.min(100, value))}%`,
					backgroundImage: RANK_GRADIENT
				}}
			/>
		</div>
	</div>
);

export function CompactRankDisplay({
	progress,
	onViewRankSystem
}: {
	progress: RankingProgress;
	onViewRankSystem: () => void;
}) {
	const rank = progress.current_rank;
	const next = progress.next_rank;
	return (
		<div className="group relative h-[68px] w-[350px] max-w-full">
			<button
				type="button"
				onClick={onViewRankSystem}
				className="flex size-full items-center gap-2.5 rounded-[10px] bg-transparent px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2"
				aria-label={`Current rank ${rank.title}. View rank system`}
			>
				<div className="relative flex size-[58px] shrink-0 items-center justify-center">
					<div className="scale-125">
						<RankBadge rankKey={rank.image_key} title={rank.title} size={58} />
					</div>
				</div>
				<div className="w-[120px] min-w-0 shrink-0 self-stretch py-1 text-left">
					<p className="text-[9px] font-bold leading-none tracking-[0.12em] text-slate-400">
						CURRENT RANK
					</p>
					<p
						className="mt-1 line-clamp-2 text-[24px] font-black leading-[0.92] tracking-[-0.035em]"
						style={{
							backgroundImage: RANK_TITLE_GRADIENTS[rank.image_key],
							backgroundClip: 'text',
							WebkitBackgroundClip: 'text',
							color: 'transparent',
							WebkitTextFillColor: 'transparent',
							filter: 'drop-shadow(0 1px 0 rgba(255,255,255,.65))'
						}}
					>
						{rank.title}
					</p>
				</div>
				<div className="min-w-0 flex-1">
					{next ? (
						<div className="space-y-2">
							<ProgressBar
								label="Printer Points"
								ariaLabel={`Printer Points progress to ${next.title}`}
								value={progress.xp_progress_percent}
								current={progress.xp}
								required={next.xp_required}
							/>
							<ProgressBar
								label="Sales"
								ariaLabel={`AI sales progress to ${next.title}`}
								value={progress.sales_progress_percent}
								current={progress.ai_sales}
								required={next.sales_required}
							/>
						</div>
					) : (
						<p className="text-xs font-extrabold text-emerald-600">Max rank</p>
					)}
				</div>
			</button>
			<span
				role="tooltip"
				className="pointer-events-none absolute left-1/2 top-[calc(100%+4px)] z-50 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-full bg-slate-950 px-3 py-1.5 text-[11px] font-bold tracking-wide text-white opacity-0 shadow-lg transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
			>
				View rank system
			</span>
		</div>
	);
}
