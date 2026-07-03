/**
 * Activity page — the agent's own unified lead + call tracker.
 *
 * Lists the caller's activity (server-side scoped to their agent_id): every saved
 * LEAD and every CALL, so a call whose form was never saved still appears and its
 * recording stays reachable. Rows are one of three kinds — Lead, Call, or Lead+Call.
 * Filters (campaign, phone/name prefix, date range), pagination, and an expandable
 * detail:
 *   - rows with a lead → the FROZEN form snapshot + answers, disposition, timeline,
 *     recording (LeadDetailPanel, unchanged).
 *   - call-only rows → a compact call summary, the recording, and a "Log lead"
 *     button that opens LeadForm prefilled with the call's caller/campaign/CallSid,
 *     so saving turns the call into a lead (it relinks by CallSid).
 *
 * The recording URL is fetched on demand (short-lived SAS), via getLeadRecording
 * when the row has a lead_id, else getCallRecording by call_id.
 */

import {useEffect, useMemo, useState} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {
	listCampaigns,
	listActivity,
	getLeadDetail,
	getLeadRecording,
	getCallRecording,
	type DialerCampaign,
	type LeadDetailResponse,
	type ActivityFilters,
	type ActivityListItem,
	type ActivityKind
} from '@/lib/api';
import {FormRenderer} from '@/leads/FormRenderer';
import {LeadForm} from '@/leads/LeadForm';

const PAGE_SIZE = 25;
const inputClasses =
	'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const KIND_LABEL: Record<ActivityKind, string> = {
	lead: 'Lead',
	call: 'Call',
	both: 'Lead + Call'
};

export default function Leads() {
	const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
	const [items, setItems] = useState<ActivityListItem[]>([]);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);

	// Draft filter inputs (applied on submit / page change).
	const [campaignId, setCampaignId] = useState('');
	const [search, setSearch] = useState('');
	const [searchKind, setSearchKind] = useState<'name' | 'phone'>('name');
	const [kind, setKind] = useState<'' | ActivityKind>('');
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	// The filters actually in effect (bumped on Apply).
	const [applied, setApplied] = useState<ActivityFilters>({});

	useEffect(() => {
		listCampaigns()
			.then((res) => setCampaigns(res.campaigns ?? []))
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		listActivity(applied, PAGE_SIZE, page)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setError(res.statusMessage || 'Failed to load activity');
					return;
				}
				setItems(res.items ?? []);
				setTotal(res.total ?? 0);
				setTotalPages(res.totalPages ?? 1);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(readError(err, 'Failed to load activity'));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [applied, page]);

	const onApply = () => {
		setExpandedId(null);
		setPage(1);
		setApplied({
			campaign_id: campaignId || null,
			name: searchKind === 'name' ? search || null : null,
			caller_phone: searchKind === 'phone' ? search || null : null,
			kind: kind || null,
			created_from: from || null,
			created_to: to ? `${to} 23:59:59` : null
		});
	};

	const onReset = () => {
		setCampaignId('');
		setSearch('');
		setSearchKind('name');
		setKind('');
		setFrom('');
		setTo('');
		setExpandedId(null);
		setPage(1);
		setApplied({});
	};

	return (
		<div className="mx-auto max-w-4xl space-y-4">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between">
						<span>Activity</span>
						<span className="text-xs font-normal text-muted-foreground">
							{total} total
						</span>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4 text-sm">
					{/* Filter bar */}
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
						<select
							value={campaignId}
							onChange={(e) => setCampaignId(e.target.value)}
							className={inputClasses}
							aria-label="Campaign"
						>
							<option value="">All campaigns</option>
							{campaigns.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>

						<select
							value={kind}
							onChange={(e) => setKind(e.target.value as '' | ActivityKind)}
							className={inputClasses}
							aria-label="Type"
						>
							<option value="">All types</option>
							<option value="call">Calls only</option>
							<option value="lead">Leads only</option>
							<option value="both">Lead + Call</option>
						</select>

						<div className="flex gap-2">
							<select
								value={searchKind}
								onChange={(e) => setSearchKind(e.target.value as 'name' | 'phone')}
								className={`${inputClasses} w-28`}
								aria-label="Search by"
							>
								<option value="name">Name</option>
								<option value="phone">Phone</option>
							</select>
							<input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && onApply()}
								placeholder={searchKind === 'name' ? 'Name starts with…' : 'Phone starts with…'}
								className={inputClasses}
							/>
						</div>

						<div className="flex gap-2">
							<label className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
								From
								<input
									type="date"
									value={from}
									onChange={(e) => setFrom(e.target.value)}
									className={inputClasses}
								/>
							</label>
							<label className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
								To
								<input
									type="date"
									value={to}
									onChange={(e) => setTo(e.target.value)}
									className={inputClasses}
								/>
							</label>
						</div>
					</div>

					<div className="flex gap-2">
						<Button size="sm" onClick={onApply}>
							Apply filters
						</Button>
						<Button size="sm" variant="outline" onClick={onReset}>
							Reset
						</Button>
					</div>

					{error && <p className="text-destructive">{error}</p>}

					{/* Table */}
					<div className="overflow-hidden rounded-md border border-border">
						<div className="grid grid-cols-[6rem_1fr_1fr_1fr_1fr] gap-2 border-b border-border bg-secondary/40 px-3 py-2 text-xs font-medium text-muted-foreground">
							<span>Type</span>
							<span>Name</span>
							<span>Phone</span>
							<span>Campaign</span>
							<span>Disposition</span>
						</div>

						{loading && (
							<p className="px-3 py-4 text-muted-foreground">Loading…</p>
						)}
						{!loading && items.length === 0 && (
							<p className="px-3 py-4 text-muted-foreground">No activity found.</p>
						)}

						{!loading &&
							items.map((item) => (
								<ActivityRow
									key={item.id}
									item={item}
									campaigns={campaigns}
									expanded={expandedId === item.id}
									onToggle={() =>
										setExpandedId(expandedId === item.id ? null : item.id)
									}
								/>
							))}
					</div>

					{/* Pagination */}
					{totalPages > 1 && (
						<div className="flex items-center justify-between">
							<Button
								size="sm"
								variant="outline"
								disabled={page <= 1 || loading}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
							>
								Previous
							</Button>
							<span className="text-xs text-muted-foreground">
								Page {page} of {totalPages}
							</span>
							<Button
								size="sm"
								variant="outline"
								disabled={page >= totalPages || loading}
								onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							>
								Next
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function KindBadge({kind}: {kind: ActivityKind}) {
	const tone =
		kind === 'both'
			? 'bg-success/15 text-success'
			: kind === 'lead'
				? 'bg-secondary text-secondary-foreground'
				: 'bg-muted text-muted-foreground';
	return (
		<span className={`inline-block w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
			{KIND_LABEL[kind]}
		</span>
	);
}

function ActivityRow({
	item,
	campaigns,
	expanded,
	onToggle
}: {
	item: ActivityListItem;
	campaigns: DialerCampaign[];
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="border-b border-border last:border-b-0">
			<button
				type="button"
				onClick={onToggle}
				className="grid w-full grid-cols-[6rem_1fr_1fr_1fr_1fr] items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/30"
			>
				<KindBadge kind={item.kind} />
				<span className="truncate">{item.name || '—'}</span>
				<span className="truncate font-mono text-xs">{item.caller_phone || '—'}</span>
				<span className="truncate text-muted-foreground">
					{item.campaign_name || '—'}
				</span>
				<span className="truncate text-muted-foreground">
					{item.disposition_label || '—'}
				</span>
			</button>
			{expanded &&
				(item.lead_id ? (
					<LeadDetailPanel leadId={item.lead_id} />
				) : (
					<CallDetailPanel item={item} campaigns={campaigns} />
				))}
		</div>
	);
}

/** Recording control shared by both detail panels: fetch-on-demand → open link. */
function RecordingControl({
	fetchUrl,
	hasRecording
}: {
	fetchUrl: () => Promise<string | null>;
	hasRecording: boolean;
}) {
	const [recording, setRecording] = useState<string | null | undefined>(undefined);
	const [recLoading, setRecLoading] = useState(false);

	const onLoad = async () => {
		setRecLoading(true);
		try {
			setRecording((await fetchUrl()) ?? null);
		} catch {
			setRecording(null);
		} finally {
			setRecLoading(false);
		}
	};

	return (
		<div className="border-t border-border pt-3">
			<p className="mb-1 text-xs text-muted-foreground">Recording</p>
			{!hasRecording ? (
				<p className="text-xs text-muted-foreground">No recording.</p>
			) : recording === undefined ? (
				<Button size="sm" variant="outline" onClick={onLoad} disabled={recLoading}>
					{recLoading ? 'Checking…' : 'Load recording'}
				</Button>
			) : recording ? (
				<a
					href={recording}
					target="_blank"
					rel="noreferrer"
					className="text-sm text-success underline"
				>
					Play recording ↗
				</a>
			) : (
				<p className="text-xs text-muted-foreground">Recording not available yet.</p>
			)}
		</div>
	);
}

/** Detail for a call-only activity row: summary + recording + "Log lead". */
function CallDetailPanel({
	item,
	campaigns
}: {
	item: ActivityListItem;
	campaigns: DialerCampaign[];
}) {
	const [logging, setLogging] = useState(false);
	// campaign_id may be null (agent hadn't selected one) — let them pick before logging.
	const [pickedCampaign, setPickedCampaign] = useState(item.campaign_id ?? '');
	const effectiveCampaign = item.campaign_id ?? pickedCampaign;

	return (
		<div className="space-y-4 bg-secondary/10 px-3 py-3 text-sm">
			<div className="grid grid-cols-2 gap-2 text-xs">
				<Row label="Status" value={item.call_status || '—'} />
				<Row label="Phone" value={item.caller_phone || '—'} />
				<Row label="Started" value={fmt(item.started_at)} />
				<Row label="Ended" value={fmt(item.ended_at)} />
			</div>

			<RecordingControl
				hasRecording={item.has_recording}
				fetchUrl={() =>
					getCallRecording(item.call_id!).then((r) => r.recording_url ?? null)
				}
			/>

			{/* Turn this call into a lead (relinks by CallSid). */}
			<div className="border-t border-border pt-3">
				{!logging ? (
					<Button size="sm" variant="outline" onClick={() => setLogging(true)}>
						Log lead
					</Button>
				) : !effectiveCampaign ? (
					<div className="space-y-2">
						<p className="text-xs text-muted-foreground">
							Pick a campaign to log this lead against:
						</p>
						<select
							value={pickedCampaign}
							onChange={(e) => setPickedCampaign(e.target.value)}
							className={inputClasses}
							aria-label="Campaign"
						>
							<option value="">Select campaign…</option>
							{campaigns.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
					</div>
				) : (
					<LeadForm
						campaignId={effectiveCampaign}
						callSid={item.twilio_call_sid}
						callerPhone={item.caller_phone}
					/>
				)}
			</div>
		</div>
	);
}

function LeadDetailPanel({leadId}: {leadId: string}) {
	const [detail, setDetail] = useState<LeadDetailResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		getLeadDetail(leadId)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setError(res.statusMessage || 'Failed to load detail');
					return;
				}
				setDetail(res);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(readError(err, 'Failed to load detail'));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [leadId]);

	const schema = useMemo(() => detail?.lead?.form_schema_snapshot ?? [], [detail]);

	if (loading) {
		return <p className="px-3 py-3 text-xs text-muted-foreground">Loading detail…</p>;
	}
	if (error) {
		return <p className="px-3 py-3 text-xs text-destructive">{error}</p>;
	}
	if (!detail?.lead) return null;

	const hasRecording = !!detail.call?.id;

	return (
		<div className="space-y-4 bg-secondary/10 px-3 py-3 text-sm">
			{/* Frozen form snapshot + answers (read-only). */}
			{schema.length > 0 ? (
				<FormRenderer
					schema={schema}
					value={detail.lead.form_data ?? {}}
					onChange={() => undefined}
					disabled
				/>
			) : (
				<p className="text-xs text-muted-foreground">No form captured for this lead.</p>
			)}

			<div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
				<Row label="Campaign" value={detail.campaign_name || '—'} />
				<Row label="Disposition" value={detail.lead.disposition_label || '—'} />
				<Row label="Created" value={fmt(detail.lead.created_at)} />
				<Row label="Phone" value={detail.lead.caller_phone || '—'} />
			</div>

			{/* Recording */}
			<RecordingControl
				hasRecording={hasRecording}
				fetchUrl={() =>
					getLeadRecording(leadId).then((r) => r.recording_url ?? null)
				}
			/>

			{/* Event timeline */}
			{detail.events && detail.events.length > 0 && (
				<div className="border-t border-border pt-3">
					<p className="mb-1 text-xs text-muted-foreground">Activity</p>
					<ul className="space-y-1">
						{detail.events.map((ev) => (
							<li key={ev.id} className="flex justify-between gap-4 text-xs">
								<span>{ev.event_type}</span>
								<span className="text-muted-foreground">{fmt(ev.created_at)}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function Row({label, value}: {label: string; value: string}) {
	return (
		<div className="flex justify-between gap-4">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-mono">{value}</span>
		</div>
	);
}

function fmt(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function readError(err: any, fallback: string): string {
	return err?.response?.data?.statusMessage || err?.message || fallback;
}
