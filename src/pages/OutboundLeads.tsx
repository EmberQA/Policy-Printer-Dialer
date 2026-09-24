/**
 * Leads page — the agent's purchased-lead queue (ENG-234).
 *
 * Subplan 02: the purchase-order queue (create / edit / pause / cancel), oldest
 * first, with the price the next order would take and the wallet balance.
 * Subplan 05: the delivered-leads table below the queue. Displayed leads are
 * acknowledged after loading;
 * the table keeps its own fetch keyed by `refreshKey`.
 *
 * ENG-248: a won lead is texted to the agent, so a VERIFIED mobile number is
 * required before a NEW order can be placed. The gate is enforced by the backend
 * (`order/create`); here "New order" opens the number dialog instead when there
 * is none, and a "Lead alerts" line shows the number with Edit / Enter code.
 *
 * Distinct from /leads, which is the Activity tab over inbound CRM records.
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Loader2, MessageSquareText, Plus, RefreshCw} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
	cancelLeadOrder,
	fetchLeadOrder,
	setLeadOrderPaused,
	type LeadOrderInput,
	type LeadOrderSummary,
	type LeadPurchaseOrder
} from '@/lib/api';
import {readError} from '@/lib/errors';
import {cn} from '@/lib/utils';
import {LeadOrderCard} from '@/outboundLeads/LeadOrderCard';
import {LeadOrderDialog} from '@/outboundLeads/LeadOrderDialog';
import {PurchasedLeadsTable} from '@/outboundLeads/PurchasedLeadsTable';
import {SmsContactDialog} from '@/outboundLeads/SmsContactDialog';
import {subscribeLeadUpdates} from '@/outboundLeads/useNewLeadPoll';
import {
	buildDefaultLeadOrderInput,
	formatDollars,
	orderToInput
} from '@/outboundLeads/leadOrderForm';
import {describeSmsContact, formatSmsPhone} from '@/outboundLeads/smsContact';

type DialogState =
	| {open: false}
	| {open: true; mode: 'create'; initial: LeadOrderInput}
	| {
			open: true;
			mode: 'edit';
			initial: LeadOrderInput;
			order: LeadPurchaseOrder;
	  };

export default function OutboundLeads() {
	const [summary, setSummary] = useState<LeadOrderSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [dialog, setDialog] = useState<DialogState>({open: false});
	/** Id of the order a pause/cancel is in flight for. */
	const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	/** Bumped by Refresh so the leads table refetches with the orders. */
	const [refreshKey, setRefreshKey] = useState(0);
	const [smsDialogOpen, setSmsDialogOpen] = useState(false);

	const load = useCallback(async () => {
		setRefreshKey((k) => k + 1);
		setError(null);
		try {
			const res = await fetchLeadOrder();
			if (res.statusCode !== 'SP100') {
				setError(res.statusMessage || 'Could not load your lead orders');
				return;
			}
			setSummary({
				orders: res.orders ?? [],
				new_order_price_cents: res.new_order_price_cents ?? null,
				balance_cents: res.balance_cents ?? 0,
				wallet_enabled: res.wallet_enabled ?? false,
				can_create_order: res.can_create_order ?? false,
				licensed_states: res.licensed_states ?? [],
				jurisdictions: res.jurisdictions ?? [],
				sms_contact: res.sms_contact ?? null
			});
		} catch (err) {
			setError(readError(err, 'Could not load your lead orders'));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => subscribeLeadUpdates(() => void load()), [load]);

	const smsState = describeSmsContact(summary?.sms_contact);

	const openCreate = () => {
		if (!summary) return;
		// No verified number ⇒ the backend would refuse the order anyway; ask for
		// the number first and let the agent come back to New order.
		if (smsState !== 'verified') {
			setSmsDialogOpen(true);
			return;
		}
		setDialog({
			open: true,
			mode: 'create',
			initial: buildDefaultLeadOrderInput(summary)
		});
	};
	const openEdit = (order: LeadPurchaseOrder) =>
		setDialog({open: true, mode: 'edit', initial: orderToInput(order), order});
	const closeDialog = () => setDialog({open: false});

	const runAction = async (
		orderId: string,
		action: () => Promise<{statusCode: string; statusMessage: string}>,
		fallback: string
	) => {
		setBusyOrderId(orderId);
		setActionError(null);
		try {
			const res = await action();
			if (res.statusCode !== 'SP100') {
				setActionError(res.statusMessage || fallback);
			}
		} catch (err) {
			setActionError(readError(err, fallback));
		} finally {
			setBusyOrderId(null);
			void load();
		}
	};

	// The dialog's `initial` must be referentially stable across renders or its
	// re-seed effect would wipe the agent's typing on every parent re-render.
	const dialogInitial = useMemo(
		() => (dialog.open ? dialog.initial : null),
		[dialog]
	);

	const orders = summary?.orders ?? [];

	return (
		<div className="mx-auto max-w-5xl space-y-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
					<p className="text-sm text-muted-foreground">
						Buy real-time outbound leads.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{summary && (
						<Badge variant="outline">
							Balance {formatDollars(summary.balance_cents)}
						</Badge>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => void load()}
						disabled={loading}
					>
						<RefreshCw className={cn('size-4', loading && 'animate-spin')} />
						Refresh
					</Button>
					<Button
						variant="success"
						size="sm"
						onClick={openCreate}
						disabled={loading || !summary || !summary.can_create_order}
						title={
							summary && !summary.can_create_order
								? 'Lead pricing is not configured for your agency yet'
								: undefined
						}
					>
						<Plus className="size-4" />
						New order
					</Button>
				</div>
			</div>

			{summary && !summary.can_create_order && (
				<p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200">
					Lead pricing is not configured for your agency yet, so new orders
					can&apos;t be placed. Existing orders stay as they are.
				</p>
			)}

			{summary && smsState !== 'verified' && (
				<div className="flex flex-col gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200">
					<span>
						{smsState === 'none'
							? "Add a mobile number so we can text you each lead you win. It's required before placing an order."
							: `Enter the code we texted ${formatSmsPhone(summary.sms_contact!.phone_number)} to finish setting up lead alerts. New orders wait until it's verified.`}
					</span>
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						onClick={() => setSmsDialogOpen(true)}
					>
						<MessageSquareText className="size-4" />
						{smsState === 'none' ? 'Add number' : 'Enter code'}
					</Button>
				</div>
			)}

			{summary && smsState === 'verified' && (
				<p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
					<MessageSquareText className="size-4" />
					<span>
						Lead alerts go to{' '}
						<span className="font-medium text-foreground">
							{formatSmsPhone(summary.sms_contact!.phone_number)}
						</span>
					</span>
					<button
						type="button"
						className="underline-offset-2 hover:underline"
						onClick={() => setSmsDialogOpen(true)}
					>
						Edit
					</button>
				</p>
			)}

			{error && <p className="text-sm text-destructive">{error}</p>}
			{actionError && <p className="text-sm text-destructive">{actionError}</p>}

			{loading && !summary ? (
				<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" />
					Loading your orders…
				</div>
			) : orders.length === 0 ? (
				<div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
					No active lead orders. Place one to start receiving leads during your
					working hours.
				</div>
			) : (
				<div className="space-y-3">
					{orders.map((item, index) => (
						<LeadOrderCard
							key={item.order.id}
							item={item}
							position={index + 1}
							balanceCents={summary?.balance_cents ?? 0}
							jurisdictions={summary?.jurisdictions ?? []}
							busy={busyOrderId === item.order.id}
							onEdit={() => openEdit(item.order)}
							onTogglePause={() =>
								void runAction(
									item.order.id,
									() => setLeadOrderPaused(item.order.id, !item.order.paused),
									'Could not update the order'
								)
							}
							onCancel={() =>
								void runAction(
									item.order.id,
									() => cancelLeadOrder(item.order.id),
									'Could not cancel the order'
								)
							}
						/>
					))}
				</div>
			)}

			<PurchasedLeadsTable
				refreshKey={refreshKey}
				jurisdictions={summary?.jurisdictions ?? []}
			/>

			{summary && (
				<SmsContactDialog
					open={smsDialogOpen}
					contact={summary.sms_contact}
					onClose={() => setSmsDialogOpen(false)}
					onVerified={() => {
						setSmsDialogOpen(false);
						void load();
					}}
				/>
			)}

			{summary && dialog.open && dialogInitial && (
				<LeadOrderDialog
					open
					mode={dialog.mode}
					initial={dialogInitial}
					order={dialog.mode === 'edit' ? dialog.order : undefined}
					summary={summary}
					onClose={closeDialog}
					onSaved={() => {
						closeDialog();
						void load();
					}}
				/>
			)}
		</div>
	);
}
