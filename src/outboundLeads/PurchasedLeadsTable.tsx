/**
 * The agent's delivered leads (ENG-234 Subplan 05): status filter, 25 per
 * page, one-click call, expandable detail with outcome + note.
 *
 * Click-to-call is a copy of the Activity page's `onClickToDial`: start
 * through the shared session Device INSIDE the click gesture (autoplay rules
 * for ringback), then swap to the Calls tab. The start carries the lead id so
 * the backend can verify the number and count the attempt — the browser never
 * touches `call_count` or the status.
 */

import {useCallback, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Inbox, Loader2, RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card, CardContent} from '@/components/ui/card';
import {Label} from '@/components/ui/label';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow
} from '@/components/ui/table';
import {
	listPurchasedLeads,
	setPurchasedLeadStatus,
	type LicensedJurisdiction,
	type OutboundLead,
	type OutboundLeadStatus
} from '@/lib/api';
import {readError} from '@/lib/errors';
import {normalizeDialInput} from '@/lib/phone';
import {cn} from '@/lib/utils';
import {useDialerSession} from '@/session/DialerSessionProvider';
import {LEAD_STATUS_FILTER_OPTIONS} from './leadDisplay';
import {PURCHASED_LEAD_COLUMNS, PurchasedLeadRow} from './PurchasedLeadRow';

export const PAGE_SIZE = 25;

export interface PurchasedLeadsTableProps {
	/** Bump to refetch (the page's Refresh button, a new-lead acknowledgement). */
	refreshKey: number;
	jurisdictions: LicensedJurisdiction[];
}

export function PurchasedLeadsTable({
	refreshKey,
	jurisdictions
}: PurchasedLeadsTableProps) {
	const [leads, setLeads] = useState<OutboundLead[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [status, setStatus] = useState<OutboundLeadStatus | ''>('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const {device, canDialBase} = useDialerSession();
	const navigate = useNavigate();
	const [dialingId, setDialingId] = useState<string | null>(null);
	const [dialError, setDialError] = useState<string | null>(null);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await listPurchasedLeads({
				page,
				limit: PAGE_SIZE,
				...(status ? {status} : {})
			});
			if (res.statusCode !== 'SP100') {
				setError(res.statusMessage || 'Could not load your leads');
				return;
			}
			setLeads(res.leads ?? []);
			setTotal(res.total ?? 0);
		} catch (err) {
			setError(readError(err, 'Could not load your leads'));
		} finally {
			setLoading(false);
		}
	}, [page, status]);

	useEffect(() => {
		void load();
	}, [load, refreshKey]);

	const onCall = (lead: OutboundLead) => {
		const dest = normalizeDialInput(lead.phone);
		if (!dest || !canDialBase || dialingId) return;
		setDialingId(lead.id);
		setDialError(null);
		// Start through the shared device before leaving this click handler so
		// ringback satisfies autoplay rules, then show the call UI on Calls.
		const attempt = device.startOutbound(dest, {outboundLeadId: lead.id});
		navigate('/dial');
		attempt
			.catch((err) => setDialError(readError(err, 'Could not place the call')))
			.finally(() => setDialingId(null));
	};

	const onStatusChange = async (
		lead: OutboundLead,
		next: OutboundLeadStatus,
		note: string
	): Promise<string | null> => {
		try {
			const res = await setPurchasedLeadStatus(lead.id, next, note);
			if (res.statusCode !== 'SP100' || !res.lead) {
				return res.statusMessage || 'Could not save the outcome';
			}
			const updated = res.lead;
			setLeads((current) =>
				current.map((l) => (l.id === updated.id ? updated : l))
			);
			return null;
		} catch (err) {
			return readError(err, 'Could not save the outcome');
		}
	};

	return (
		<section className="space-y-3" aria-labelledby="purchased-leads-heading">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-0.5">
					<h2 id="purchased-leads-heading" className="text-lg font-semibold">
						Your leads
					</h2>
					<p className="text-sm text-muted-foreground">
						Leads delivered to your orders, newest first. Call them straight
						from here.
					</p>
				</div>
				<div className="flex items-end gap-2">
					<div className="space-y-1">
						<Label htmlFor="purchased-leads-status" className="text-xs">
							Status
						</Label>
						<select
							id="purchased-leads-status"
							className="flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							value={status}
							onChange={(e) => {
								setStatus(e.target.value as OutboundLeadStatus | '');
								setPage(1);
								setExpandedId(null);
							}}
						>
							<option value="">All</option>
							{LEAD_STATUS_FILTER_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void load()}
						disabled={loading}
					>
						<RefreshCw className={cn('size-4', loading && 'animate-spin')} />
						Refresh
					</Button>
				</div>
			</div>

			<Card className="overflow-hidden shadow-xs">
				{(error || dialError) && (
					<div className="border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
						{error || dialError}
					</div>
				)}
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/50 hover:bg-muted/50">
							<TableHead>Name</TableHead>
							<TableHead>Phone</TableHead>
							<TableHead>State</TableHead>
							<TableHead>Age</TableHead>
							<TableHead>Coverage</TableHead>
							<TableHead>Received</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Call</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading && leads.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={PURCHASED_LEAD_COLUMNS}
									className="h-24 text-center"
								>
									<span className="inline-flex items-center gap-2 text-muted-foreground">
										<Loader2 className="size-4 animate-spin" />
										Loading your leads…
									</span>
								</TableCell>
							</TableRow>
						)}
						{!loading && leads.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={PURCHASED_LEAD_COLUMNS}
									className="h-24 text-center"
								>
									<div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-muted-foreground">
										<Inbox className="size-5" />
										<p>
											{status
												? 'No leads with that status.'
												: 'No leads yet. They appear here the moment one is delivered to an active order.'}
										</p>
									</div>
								</TableCell>
							</TableRow>
						)}
						{leads.map((lead) => (
							<PurchasedLeadRow
								key={lead.id}
								lead={lead}
								jurisdictions={jurisdictions}
								expanded={expandedId === lead.id}
								onToggle={() =>
									setExpandedId(expandedId === lead.id ? null : lead.id)
								}
								onCall={onCall}
								dialing={dialingId === lead.id}
								canDial={canDialBase}
								onStatusChange={onStatusChange}
							/>
						))}
					</TableBody>
				</Table>

				{totalPages > 1 && (
					<CardContent className="flex items-center justify-between border-t px-4 py-3">
						<Button
							size="sm"
							variant="outline"
							disabled={page <= 1 || loading}
							onClick={() => setPage((p) => Math.max(1, p - 1))}
						>
							Previous
						</Button>
						<span className="text-xs text-muted-foreground">
							Page {page} of {totalPages} · {total} lead{total === 1 ? '' : 's'}
						</span>
						<Button
							size="sm"
							variant="outline"
							disabled={page >= totalPages || loading}
							onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
						>
							Next
						</Button>
					</CardContent>
				)}
			</Card>
		</section>
	);
}
