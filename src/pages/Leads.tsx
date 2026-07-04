/**
 * Activity page — the agent's own unified lead + call tracker.
 *
 * Lists every saved lead and every call scoped to the current agent. Calls whose
 * lead form was never saved still appear, so the agent can retrieve a recording
 * or log the lead after the fact.
 */

import {useEffect, useMemo, useState} from 'react';
import {
	CalendarDays,
	Headphones,
	Loader2,
	RefreshCw,
	Search,
	Volume2
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow
} from '@/components/ui/table';
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
import {cn} from '@/lib/utils';

const PAGE_SIZE = 25;

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

	const [campaignId, setCampaignId] = useState('');
	const [search, setSearch] = useState('');
	const [kind, setKind] = useState<'' | ActivityKind>('');
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
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
		const q = search.trim();
		const looksLikePhone = /\d/.test(q) && /^[\d\s()+.-]+$/.test(q);
		setExpandedId(null);
		setPage(1);
		setApplied({
			campaign_id: campaignId || null,
			name: q && !looksLikePhone ? q : null,
			caller_phone: q && looksLikePhone ? q : null,
			kind: kind || null,
			created_from: from || null,
			created_to: to ? `${to} 23:59:59` : null
		});
	};

	const onReset = () => {
		setCampaignId('');
		setSearch('');
		setKind('');
		setFrom('');
		setTo('');
		setExpandedId(null);
		setPage(1);
		setApplied({});
	};

	return (
		<div className="mx-auto max-w-6xl space-y-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
					<p className="text-sm leading-6 text-muted-foreground">
						Your calls and saved leads.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="outline">{total} records</Badge>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setApplied((cur) => ({...cur}))}
						disabled={loading}
					>
						<RefreshCw className={cn('size-4', loading && 'animate-spin')} />
						Refresh
					</Button>
				</div>
			</div>

			<Card className="shadow-xs">
				<CardContent className="p-4">
					<div className="grid gap-3 lg:grid-cols-[1.1fr_0.8fr_1.5fr_0.9fr_0.9fr_auto] lg:items-end">
						<div className="space-y-2">
							<Label>Campaign</Label>
							<Select
								value={campaignId || 'all'}
								onValueChange={(next) =>
									setCampaignId(next === 'all' ? '' : next)
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All campaigns</SelectItem>
									{campaigns.map((campaign) => (
										<SelectItem key={campaign.id} value={campaign.id}>
											{campaign.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label>Type</Label>
							<Select
								value={kind || 'all'}
								onValueChange={(next) =>
									setKind(next === 'all' ? '' : (next as ActivityKind))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All</SelectItem>
									<SelectItem value="lead">Lead</SelectItem>
									<SelectItem value="call">Call</SelectItem>
									<SelectItem value="both">Lead + Call</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label htmlFor="activity-search">Search</Label>
							<div className="relative">
								<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									id="activity-search"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && onApply()}
									placeholder="Name or phone starts with…"
									className="pl-9"
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="activity-from">From</Label>
							<Input
								id="activity-from"
								type="date"
								value={from}
								onChange={(e) => setFrom(e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="activity-to">To</Label>
							<Input
								id="activity-to"
								type="date"
								value={to}
								onChange={(e) => setTo(e.target.value)}
							/>
						</div>

						<div className="flex gap-2">
							<Button size="sm" onClick={onApply}>
								Apply filters
							</Button>
							<Button size="sm" variant="outline" onClick={onReset}>
								Reset
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card className="overflow-hidden shadow-xs">
				{error && (
					<div className="border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
						{error}
					</div>
				)}
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/50 hover:bg-muted/50">
							<TableHead>Type</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Phone</TableHead>
							<TableHead>Campaign</TableHead>
							<TableHead>Disposition</TableHead>
							<TableHead>Last activity</TableHead>
							<TableHead className="text-right">Action</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading && (
							<TableRow>
								<TableCell colSpan={7} className="h-24 text-center">
									<span className="inline-flex items-center gap-2 text-muted-foreground">
										<Loader2 className="size-4 animate-spin" />
										Loading activity…
									</span>
								</TableCell>
							</TableRow>
						)}
						{!loading && items.length === 0 && (
							<TableRow>
								<TableCell colSpan={7} className="h-24 text-center">
									<div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-muted-foreground">
										<CalendarDays className="size-5" />
										<p>No activity found.</p>
									</div>
								</TableCell>
							</TableRow>
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
					</TableBody>
				</Table>

				{totalPages > 1 && (
					<div className="flex items-center justify-between border-t px-4 py-3">
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
			</Card>
		</div>
	);
}

function KindBadge({kind}: {kind: ActivityKind}) {
	const tone =
		kind === 'both'
			? 'border-success/30 bg-success/5 text-success'
			: kind === 'call'
				? 'border-blue-200 bg-blue-50 text-blue-700'
				: 'bg-secondary text-secondary-foreground';

	return (
		<Badge variant="outline" className={tone}>
			{kind === 'call' && <Headphones className="size-3" />}
			{KIND_LABEL[kind]}
		</Badge>
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
		<>
			<TableRow aria-expanded={expanded}>
				<TableCell>
					<KindBadge kind={item.kind} />
				</TableCell>
				<TableCell className="font-medium">{item.name || 'Unknown caller'}</TableCell>
				<TableCell className="font-mono text-xs">
					{item.caller_phone || '—'}
				</TableCell>
				<TableCell className="text-muted-foreground">
					{item.campaign_name || '—'}
				</TableCell>
				<TableCell className="text-muted-foreground">
					{item.disposition_label || '—'}
				</TableCell>
				<TableCell className="text-muted-foreground">
					{fmt(item.activity_at ?? item.started_at ?? item.ended_at)}
				</TableCell>
				<TableCell className="text-right">
					<Button size="sm" variant="outline" onClick={onToggle}>
						{expanded
							? 'Close'
							: item.kind === 'call'
								? 'Log lead'
								: 'View'}
					</Button>
				</TableCell>
			</TableRow>
			{expanded && (
				<TableRow className="bg-muted/30 hover:bg-muted/30">
					<TableCell colSpan={7} className="p-0">
						{item.lead_id ? (
							<LeadDetailPanel leadId={item.lead_id} />
						) : (
							<CallDetailPanel item={item} campaigns={campaigns} />
						)}
					</TableCell>
				</TableRow>
			)}
		</>
	);
}

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
		<div className="space-y-2">
			<p className="text-sm font-medium">Recording</p>
			{!hasRecording ? (
				<p className="text-sm text-muted-foreground">No recording.</p>
			) : recording === undefined ? (
				<Button size="sm" variant="outline" onClick={onLoad} disabled={recLoading}>
					{recLoading ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Volume2 className="size-4" />
					)}
					{recLoading ? 'Checking…' : 'Load recording'}
				</Button>
			) : recording ? (
				<a
					href={recording}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
				>
					<Volume2 className="size-4" />
					Play recording
				</a>
			) : (
				<p className="text-sm text-muted-foreground">Recording not available yet.</p>
			)}
		</div>
	);
}

function CallDetailPanel({
	item,
	campaigns
}: {
	item: ActivityListItem;
	campaigns: DialerCampaign[];
}) {
	const [logging, setLogging] = useState(false);
	const [pickedCampaign, setPickedCampaign] = useState(item.campaign_id ?? '');
	const effectiveCampaign = item.campaign_id ?? pickedCampaign;

	return (
		<div className="space-y-5 px-4 py-4">
			<div className="grid gap-5 md:grid-cols-[1fr_1fr_auto] md:items-start">
				<div className="space-y-3">
					<p className="text-sm font-medium">Call details</p>
					<div className="grid gap-2 text-sm">
						<Row label="Status" value={item.call_status || '—'} />
						<Row label="Started" value={fmt(item.started_at)} />
						<Row label="Ended" value={fmt(item.ended_at)} />
						<Row label="Campaign" value={item.campaign_name || '—'} />
					</div>
				</div>

				<RecordingControl
					hasRecording={item.has_recording}
					fetchUrl={() =>
						getCallRecording(item.call_id!).then((r) => r.recording_url ?? null)
					}
				/>

				{!logging && (
					<Button size="sm" onClick={() => setLogging(true)}>
						Log lead from call
					</Button>
				)}
			</div>

			{logging && !effectiveCampaign && (
				<div className="max-w-sm space-y-2">
					<Label>Campaign</Label>
					<Select value={pickedCampaign || undefined} onValueChange={setPickedCampaign}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select campaign…" />
						</SelectTrigger>
						<SelectContent>
							{campaigns.map((campaign) => (
								<SelectItem key={campaign.id} value={campaign.id}>
									{campaign.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{logging && effectiveCampaign && (
				<div className="max-w-3xl">
					<LeadForm
						campaignId={effectiveCampaign}
						callSid={item.twilio_call_sid}
						callerPhone={item.caller_phone}
					/>
				</div>
			)}
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
		return (
			<div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" />
				Loading detail…
			</div>
		);
	}
	if (error) {
		return <p className="px-4 py-4 text-sm text-destructive">{error}</p>;
	}
	if (!detail?.lead) return null;

	const hasRecording = !!detail.call?.id;

	return (
		<div className="space-y-5 px-4 py-4">
			{schema.length > 0 ? (
				<FormRenderer
					schema={schema}
					value={detail.lead.form_data ?? {}}
					onChange={() => undefined}
					disabled
				/>
			) : (
				<p className="text-sm text-muted-foreground">No form captured for this lead.</p>
			)}

			<div className="grid gap-5 border-t pt-4 md:grid-cols-2">
				<div className="grid gap-2 text-sm">
					<Row label="Campaign" value={detail.campaign_name || '—'} />
					<Row label="Disposition" value={detail.lead.disposition_label || '—'} />
					<Row label="Created" value={fmt(detail.lead.created_at)} />
					<Row label="Phone" value={detail.lead.caller_phone || '—'} />
				</div>

				<RecordingControl
					hasRecording={hasRecording}
					fetchUrl={() =>
						getLeadRecording(leadId).then((r) => r.recording_url ?? null)
					}
				/>
			</div>

			{detail.events && detail.events.length > 0 && (
				<div className="border-t pt-4">
					<p className="mb-2 text-sm font-medium">Activity</p>
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
			<span className="text-right font-mono">{value}</span>
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
