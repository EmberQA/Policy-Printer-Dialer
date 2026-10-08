/**
 * Quoter results (ENG-286): one row per carrier plan, cheapest first as ITK
 * returns them. Each row shows the carrier, plan, status chips (commission,
 * warning, plan info, E-App) and the premium; actions are Compare (seeds Quote
 * Compare), Pin (Presentation) and an expander with AD&D, limited-pay options
 * and the underwriting reasons. Carriers that declined sit in the Excluded
 * panel below.
 */

import {Fragment, useState} from 'react';
import {
	ChevronDown,
	CircleAlert,
	DollarSign,
	ExternalLink,
	Info,
	Pin,
	PinOff
} from 'lucide-react';
import {Button, buttonVariants} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import {money, wholeMoney} from './fields';
import type {ItkExcluded, ItkQuoteResult} from './types';

export const hasEapp = (q: {eapp_link: string}) => !!q.eapp_link && q.eapp_link !== '#';

/** Stable identity for pinning: carrier + plan/tier + face. */
export const quoteKey = (q: {company: string; tier_name: string; face_amount: string}) =>
	`${q.company}|${q.tier_name}|${q.face_amount}`;

export function CarrierLogo({
	src,
	name,
	className
}: {
	src: string;
	name: string;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	return (
		<div
			className={cn(
				'flex h-11 w-28 shrink-0 items-center justify-center rounded-lg border bg-white px-2',
				className
			)}
		>
			{!src || failed ? (
				<span className="truncate text-xs font-semibold text-muted-foreground">{name}</span>
			) : (
				<img
					src={src}
					alt={name}
					className="max-h-9 w-auto max-w-full object-contain"
					onError={() => setFailed(true)}
				/>
			)}
		</div>
	);
}

function Chip({
	tone,
	icon,
	children,
	tip
}: {
	tone: 'neutral' | 'success' | 'warning' | 'info';
	icon: React.ReactNode;
	children: React.ReactNode;
	tip?: React.ReactNode;
}) {
	const chip = (
		<span
			className={cn(
				'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
				tone === 'success' && 'bg-success/10 text-success',
				tone === 'warning' && 'bg-amber-50 text-amber-700',
				tone === 'info' && 'bg-secondary text-secondary-foreground',
				tone === 'neutral' && 'bg-muted text-muted-foreground',
				tip && 'cursor-help'
			)}
		>
			{icon}
			{children}
		</span>
	);
	if (!tip) return chip;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{chip}</TooltipTrigger>
			<TooltipContent className="max-w-xs whitespace-normal">{tip}</TooltipContent>
		</Tooltip>
	);
}

function Detail({label, children}: {label: string; children: React.ReactNode}) {
	return (
		<div className="space-y-1">
			<div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="text-sm">{children}</div>
		</div>
	);
}

export function QuoteResults({
	quotes,
	excluded,
	period,
	pinnedKeys,
	onCompare,
	onTogglePin
}: {
	quotes: ItkQuoteResult[];
	excluded: ItkExcluded[];
	period: 'monthly' | 'yearly';
	pinnedKeys: Set<string>;
	onCompare: (q: ItkQuoteResult) => void;
	onTogglePin: (q: ItkQuoteResult) => void;
}) {
	const [open, setOpen] = useState<number | null>(null);
	const [showExcluded, setShowExcluded] = useState(false);

	return (
		<div className="space-y-4">
			<div className="overflow-hidden rounded-xl border bg-card shadow-xs">
				{quotes.map((q, i) => {
					const key = quoteKey(q);
					const pinned = pinnedKeys.has(key);
					const reduced = !q.full_comp || (!!q.comp_percent_lower && q.comp_percent_lower !== '0');
					const expanded = open === i;
					return (
						<Fragment key={`${key}-${i}`}>
							<div
								className={cn(
									'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40',
									i > 0 && 'border-t',
									expanded && 'bg-muted/40'
								)}
							>
								<CarrierLogo src={q.logo} name={q.company} />
								<div className="min-w-0 flex-1 space-y-1.5">
									<div className="flex items-center gap-2">
										<span className="truncate text-sm font-semibold">
											{q.plan_name || q.tier_name}
										</span>
										{i === 0 && (
											<span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
												Lowest
											</span>
										)}
									</div>
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="text-xs text-muted-foreground">{q.company}</span>
										<Chip
											tone={reduced ? 'warning' : 'success'}
											icon={<DollarSign className="size-3" />}
											tip={
												q.compensation_text ||
												(reduced
													? `Commission reduced${q.comp_percent_lower ? ` by ${q.comp_percent_lower}%` : ''}`
													: 'Full commission')
											}
										>
											{reduced ? 'Reduced comp' : 'Full comp'}
										</Chip>
										{q.warning && (
											<Chip tone="warning" icon={<CircleAlert className="size-3" />} tip={q.warning}>
												Warning
											</Chip>
										)}
										{q.plan_info.length > 0 && (
											<Chip
												tone="neutral"
												icon={<Info className="size-3" />}
												tip={
													<ul className="list-disc space-y-1 pl-4">
														{q.plan_info.map((line) => (
															<li key={line}>{line}</li>
														))}
													</ul>
												}
											>
												Plan info
											</Chip>
										)}
									</div>
								</div>
								<div className="w-32 text-right">
									<div className="text-lg font-semibold tabular-nums">
										{money(period === 'monthly' ? q.monthly : q.yearly)}
										<span className="ml-0.5 text-xs font-normal text-muted-foreground">
											{period === 'monthly' ? '/mo' : '/yr'}
										</span>
									</div>
									<div className="text-xs text-muted-foreground tabular-nums">
										{wholeMoney(q.face_amount)} coverage
									</div>
								</div>
								<div className="flex items-center gap-1">
									<div className="flex w-[4.75rem] justify-end">
										{hasEapp(q) && (
											<a
												href={q.eapp_link}
												target="_blank"
												rel="noopener noreferrer"
												className={buttonVariants({size: 'sm', variant: 'ghost'})}
											>
												E-App <ExternalLink className="size-3" />
											</a>
										)}
									</div>
									<Button size="sm" variant="outline" onClick={() => onCompare(q)}>
										Compare
									</Button>
									<Button
										size="icon"
										variant="ghost"
										className={cn('size-9', pinned && 'text-primary')}
										aria-label={pinned ? 'Unpin from presentation' : 'Pin to presentation'}
										title={pinned ? 'Unpin from presentation' : 'Pin to presentation'}
										onClick={() => onTogglePin(q)}
									>
										{pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
									</Button>
									<Button
										size="icon"
										variant="ghost"
										className="size-9"
										aria-label="Details"
										onClick={() => setOpen(expanded ? null : i)}
									>
										<ChevronDown
											className={cn('size-4 transition-transform', expanded && 'rotate-180')}
										/>
									</Button>
								</div>
							</div>
							{expanded && (
								<div className="grid gap-6 border-t bg-muted/40 px-4 py-4 pl-[8.75rem] sm:grid-cols-3">
									<Detail label="Accidental death">
										{q.addnd ? (
											<>
												{money(q.addnd)}/mo
												{q.addnd_yearly && (
													<span className="text-muted-foreground"> · {money(q.addnd_yearly)}/yr</span>
												)}
											</>
										) : (
											<span className="text-muted-foreground">Not offered</span>
										)}
									</Detail>
									<Detail label="Limited pay">
										{q.limited_pay.length ? (
											<ul className="space-y-0.5">
												{q.limited_pay.map((lp) => (
													<li key={lp.constraint} className="tabular-nums">
														<span className="font-medium">{lp.constraint}</span> {money(lp.monthly)}/mo
													</li>
												))}
											</ul>
										) : (
											<span className="text-muted-foreground">None</span>
										)}
									</Detail>
									<Detail label="Underwriting notes">
										{q.why.length ? (
											<ul className="list-disc space-y-0.5 pl-4">
												{q.why.map((w) => (
													<li key={w}>{w}</li>
												))}
											</ul>
										) : (
											<span className="text-muted-foreground">None</span>
										)}
									</Detail>
								</div>
							)}
						</Fragment>
					);
				})}
				{!quotes.length && (
					<p className="px-4 py-10 text-center text-sm text-muted-foreground">
						No carriers returned a quote for these inputs.
					</p>
				)}
			</div>

			{excluded.length > 0 && (
				<div className="overflow-hidden rounded-xl border bg-card shadow-xs">
					<button
						type="button"
						onClick={() => setShowExcluded((v) => !v)}
						className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-sm hover:bg-muted/40"
					>
						<span className="flex items-center gap-2 font-medium">
							Excluded carriers
							<span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
								{excluded.length}
							</span>
						</span>
						<ChevronDown
							className={cn('size-4 text-muted-foreground transition-transform', showExcluded && 'rotate-180')}
						/>
					</button>
					{showExcluded && (
						<ul className="divide-y border-t">
							{excluded.map((e) => (
								<li key={e.name} className="grid grid-cols-[14rem_1fr] gap-4 px-4 py-2.5 text-sm">
									<span className="font-medium">{e.name}</span>
									<span className="text-muted-foreground">{e.why.join(' · ') || '—'}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}
