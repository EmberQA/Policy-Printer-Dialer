import {useEffect, type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {RankBadge} from './RankBadge';
import type {PolicyPrinterRankKey, RankPromotion} from './types';
import './RankPromotionOverlay.css';

const SHARDS = [
	{clip: 'polygon(0 0, 54% 0, 42% 48%, 0 38%)', x: '-150px', y: '-105px', r: '-38deg'},
	{clip: 'polygon(54% 0, 100% 0, 100% 42%, 42% 48%)', x: '155px', y: '-115px', r: '42deg'},
	{clip: 'polygon(0 38%, 42% 48%, 48% 100%, 0 100%)', x: '-170px', y: '116px', r: '-55deg'},
	{clip: 'polygon(42% 48%, 100% 42%, 100% 100%, 48% 100%)', x: '165px', y: '125px', r: '51deg'},
	{clip: 'polygon(42% 48%, 54% 0, 70% 46%, 48% 100%)', x: '20px', y: '-175px', r: '19deg'},
	{clip: 'polygon(42% 48%, 70% 46%, 100% 75%, 48% 100%)', x: '35px', y: '180px', r: '-24deg'}
];

const RANK_AURAS: Record<
	PolicyPrinterRankKey,
	{primary: string; secondary: string; title: string}
> = {
	recruit_1: {primary: '#e2e8f0', secondary: '#64748b', title: '#cbd5e1'},
	recruit_2: {primary: '#e2e8f0', secondary: '#64748b', title: '#cbd5e1'},
	recruit_3: {primary: '#e2e8f0', secondary: '#64748b', title: '#cbd5e1'},
	closer_1: {primary: '#c4b5fd', secondary: '#7c3aed', title: '#c4b5fd'},
	closer_2: {primary: '#c4b5fd', secondary: '#7c3aed', title: '#c4b5fd'},
	closer_3: {primary: '#c4b5fd', secondary: '#7c3aed', title: '#c4b5fd'},
	top_closer_1: {primary: '#7dd3fc', secondary: '#2563eb', title: '#7dd3fc'},
	top_closer_2: {primary: '#7dd3fc', secondary: '#2563eb', title: '#7dd3fc'},
	top_closer_3: {primary: '#7dd3fc', secondary: '#2563eb', title: '#7dd3fc'},
	master_closer_1: {primary: '#f0abfc', secondary: '#8b5cf6', title: '#f0abfc'},
	master_closer_2: {primary: '#f0abfc', secondary: '#8b5cf6', title: '#f0abfc'},
	master_closer_3: {primary: '#f0abfc', secondary: '#8b5cf6', title: '#f0abfc'},
	policy_printer: {primary: '#fbbf24', secondary: '#38bdf8', title: '#fde68a'}
};

export function RankPromotionOverlay({
	promotion,
	onDismiss
}: {
	promotion: RankPromotion;
	onDismiss: () => void;
}) {
	const aura = RANK_AURAS[promotion.current_rank.key];

	useEffect(() => {
		const timer = window.setTimeout(onDismiss, 11_000);
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onDismiss();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [onDismiss]);

	return createPortal(
		<div
			className="rank-promotion"
			role="dialog"
			aria-modal="true"
			aria-label={`Congratulations, you've ranked up to ${promotion.current_rank.title}`}
			style={
				{
					'--rank-primary': aura.primary,
					'--rank-secondary': aura.secondary,
					'--rank-title': aura.title
				} as CSSProperties
			}
		>
			<div className="rank-promotion__grid" />
			{[0, 1, 2].map((ring) => (
				<div
					key={ring}
					className={`rank-promotion__ring rank-promotion__ring--${ring + 1}`}
				/>
			))}
			<div className="rank-promotion__halo" />
			{Array.from({length: 16}).map((_, index) => (
				<i
					key={index}
					className="rank-promotion__particle"
					style={
						{
							'--particle-angle': `${index * (360 / 16)}deg`,
							'--particle-distance': `${170 + (index % 5) * 48}px`,
							'--particle-delay': `${0.55 + (index % 6) * 0.08}s`,
							'--particle-duration': `${3.6 + (index % 4) * 0.28}s`
						} as CSSProperties
					}
				/>
			))}

			<section className="rank-promotion__stage">
				<p className="rank-promotion__old-label">
					{promotion.previous_rank.title}
				</p>
				<div className="rank-promotion__badge-stage">
					{SHARDS.map((shard, index) => (
						<div
							key={index}
							className="rank-promotion__shard"
							style={
								{
									clipPath: shard.clip,
									'--shard-x': shard.x,
									'--shard-y': shard.y,
									'--shard-r': shard.r
								} as CSSProperties
							}
						>
							<RankBadge
								rankKey={promotion.previous_rank.image_key}
								title={promotion.previous_rank.title}
								size="100%"
							/>
						</div>
					))}
					<div className="rank-promotion__new-badge">
						<RankBadge
							rankKey={promotion.current_rank.image_key}
							title={promotion.current_rank.title}
							size="100%"
						/>
					</div>
				</div>

				<div className="rank-promotion__copy" aria-live="assertive">
					<p className="rank-promotion__eyebrow">Congratulations</p>
					<p className="rank-promotion__intro">You&apos;ve ranked up to</p>
					<h1 className="rank-promotion__title">
						{promotion.current_rank.title}
					</h1>
					<button
						type="button"
						className="rank-promotion__continue"
						onClick={onDismiss}
					>
						Continue
					</button>
				</div>
			</section>
		</div>,
		document.body
	);
}
