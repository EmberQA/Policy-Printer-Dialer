/**
 * One active lead purchase order (ENG-234 Subplan 02).
 *
 * Every number here is THIS order's: today's count against its daily cap,
 * delivered against its max cap, and its own saved price — never the org's
 * current price. The two warnings (balance below the order's price, saved states
 * differing from the agent's licensed states) are informational and persist
 * until the underlying data changes.
 */

import {useState} from 'react';
import {Loader2, Pause, Pencil, Play, Trash2} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent} from '@/components/ui/card';
import type {LeadPurchaseOrderSummary, LicensedJurisdiction} from '@/lib/api';
import {
	LEAD_COVERAGE_OPTIONS,
	describeWindow,
	formatDollars,
	remainingSpendCents,
	stateLabel
} from './leadOrderForm';

export interface LeadOrderCardProps {
	item: LeadPurchaseOrderSummary;
	/** Queue position, 1-based, oldest first. */
	position: number;
	balanceCents: number;
	jurisdictions: LicensedJurisdiction[];
	/** True while any mutation on this order is in flight. */
	busy: boolean;
	onEdit: () => void;
	onTogglePause: () => void;
	onCancel: () => void;
}

export function LeadOrderCard({
	item,
	position,
	balanceCents,
	jurisdictions,
	busy,
	onEdit,
	onTogglePause,
	onCancel
}: LeadOrderCardProps) {
	const {order, today_count, state_mismatch} = item;
	const [confirmingCancel, setConfirmingCancel] = useState(false);

	const belowPrice = balanceCents < order.unit_price_cents;
	const dailyReached = today_count >= order.daily_cap;
	const label = (code: string) => stateLabel(code, jurisdictions);
	const coverageLabels = LEAD_COVERAGE_OPTIONS.filter((o) =>
		order.coverage_types.includes(o.value)
	).map((o) => o.label);

	return (
		<Card>
			<CardContent className="space-y-4 p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-semibold">Order #{position}</span>
							{order.paused ? (
								<Badge variant="secondary">Paused</Badge>
							) : dailyReached ? (
								<Badge variant="outline">Daily cap reached</Badge>
							) : (
								<Badge variant="default">Active</Badge>
							)}
						</div>
						<p className="text-sm text-muted-foreground">
							{describeWindow(
								order.working_hours_start,
								order.working_hours_end,
								order.timezone
							)}
						</p>
					</div>
					<div className="flex items-center gap-1">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={onEdit}
						>
							<Pencil className="size-4" /> Edit
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={onTogglePause}
						>
							{order.paused ? (
								<>
									<Play className="size-4" /> Resume
								</>
							) : (
								<>
									<Pause className="size-4" /> Pause
								</>
							)}
						</Button>
						{confirmingCancel ? (
							<>
								<Button
									type="button"
									variant="destructive"
									size="sm"
									disabled={busy}
									onClick={() => {
										setConfirmingCancel(false);
										onCancel();
									}}
								>
									{busy && <Loader2 className="size-4 animate-spin" />}
									Confirm cancel
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={busy}
									onClick={() => setConfirmingCancel(false)}
								>
									Keep
								</Button>
							</>
						) : (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => setConfirmingCancel(true)}
								aria-label="Cancel order"
							>
								<Trash2 className="size-4" />
							</Button>
						)}
					</div>
				</div>

				<dl className="grid gap-3 text-sm sm:grid-cols-4">
					<div>
						<dt className="text-xs text-muted-foreground">Today</dt>
						<dd className="font-medium">
							{today_count} / {order.daily_cap}
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted-foreground">Delivered</dt>
						<dd className="font-medium">
							{order.delivered_count} / {order.max_cap}
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted-foreground">Your order price</dt>
						<dd className="font-medium">
							{formatDollars(order.unit_price_cents)} per lead
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted-foreground">Remaining spend</dt>
						<dd className="font-medium">
							≈ {formatDollars(remainingSpendCents(order))}
						</dd>
					</div>
				</dl>

				<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					<span>
						<span className="font-medium text-foreground">States:</span>{' '}
						{order.states.map(label).join(', ')}
					</span>
					<span>
						<span className="font-medium text-foreground">Coverage:</span>{' '}
						{coverageLabels.join(', ')}
					</span>
					{(order.min_age !== null || order.max_age !== null) && (
						<span>
							<span className="font-medium text-foreground">Age:</span>{' '}
							{order.min_age ?? 'any'} – {order.max_age ?? 'any'}
						</span>
					)}
				</div>

				{belowPrice && (
					<p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200">
						Your wallet balance ({formatDollars(balanceCents)}) is below this
						order&apos;s price ({formatDollars(order.unit_price_cents)}). No
						leads will be delivered to it until you top up.
					</p>
				)}
				{state_mismatch.differs && (
					<p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200">
						This order&apos;s states differ from the states you&apos;re licensed
						in.
						{state_mismatch.saved_not_selected.length > 0 && (
							<>
								{' '}
								In the order but not licensed:{' '}
								{state_mismatch.saved_not_selected.map(label).join(', ')}.
							</>
						)}
						{state_mismatch.selected_not_saved.length > 0 && (
							<>
								{' '}
								Licensed but not in the order:{' '}
								{state_mismatch.selected_not_saved.map(label).join(', ')}.
							</>
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
