/**
 * CRM page — one current contact card per caller rather than Activity's
 * chronological call/lead log. The server supplies each contact's newest
 * interaction, while the activity page remains the full audit trail.
 */

import {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
	Check,
	Copy,
	Loader2,
	Phone,
	RefreshCw,
	Search,
	Users,
	X
} from 'lucide-react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
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
	getLeadDetail,
	listCampaigns,
	listCrmContacts,
	startOutboundCall,
	type ActivityFilters,
	type ActivityListItem,
	type DialerCampaign,
	type LeadDetailResponse
} from '@/lib/api';
import {normalizeDialInput} from '@/lib/phone';
import {cn} from '@/lib/utils';
import {useDialerSession} from '@/session/DialerSessionProvider';

const PAGE_SIZE = 25;

export default function Crm() {
	const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
	const [contacts, setContacts] = useState<ActivityListItem[]>([]);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [totalPages, setTotalPages] = useState(1);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [campaignId, setCampaignId] = useState('');
	const [search, setSearch] = useState('');
	const [applied, setApplied] = useState<ActivityFilters>({});
	const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
	const [dialingId, setDialingId] = useState<string | null>(null);
	const {device, canDialBase} = useDialerSession();
	const navigate = useNavigate();

	useEffect(() => {
		listCampaigns()
			.then((res) => setCampaigns(res.campaigns ?? []))
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		listCrmContacts(applied, PAGE_SIZE, page)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setError(res.statusMessage || 'Failed to load CRM');
					return;
				}
				setContacts(res.items ?? []);
				setTotal(res.total ?? 0);
				setTotalPages(res.totalPages ?? 1);
			})
			.catch((err) => {
				if (!cancelled) setError(readError(err, 'Failed to load CRM'));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [applied, page]);

	const applyFilters = () => {
		const query = search.trim();
		const looksLikePhone = /\d/.test(query) && /^[\d\s()+.-]+$/.test(query);
		setSelectedLeadId(null);
		setPage(1);
		setApplied({
			campaign_id: campaignId || null,
			name: query && !looksLikePhone ? query : null,
			caller_phone: query && looksLikePhone ? query : null
		});
	};

	const resetFilters = () => {
		setCampaignId('');
		setSearch('');
		setSelectedLeadId(null);
		setPage(1);
		setApplied({});
	};

	const onClickToDial = (contact: ActivityListItem) => {
		const destination = contact.caller_phone
			? normalizeDialInput(contact.caller_phone)
			: null;
		if (!destination || !canDialBase || dialingId) return;
		void device.armAudio();
		setDialingId(contact.id);
		navigate('/dial');
		startOutboundCall(destination)
			.then((res) => {
				if (res.statusCode !== 'SP100') {
					throw new Error(res.statusMessage || 'Could not place the call');
				}
				device.armOutbound(destination);
			})
			.catch((err) => setError(readError(err, 'Could not place the call')))
			.finally(() => setDialingId(null));
	};

	return (
		<div className="mx-auto max-w-6xl space-y-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
					<p className="text-sm leading-6 text-muted-foreground">
						Your saved lead records, organized by contact instead of individual calls.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="outline">{total} contacts</Badge>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setApplied((current) => ({...current}))}
						disabled={loading}
					>
						<RefreshCw className={cn('size-4', loading && 'animate-spin')} />
						Refresh
					</Button>
				</div>
			</div>

			<Card className="shadow-xs">
				<CardContent className="p-4">
					<div className="grid gap-3 md:grid-cols-[1fr_1.5fr_auto] md:items-end">
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
							<Label htmlFor="crm-search">Search contacts</Label>
							<div className="relative">
								<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									id="crm-search"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									onKeyDown={(event) => event.key === 'Enter' && applyFilters()}
									placeholder="Name or phone starts with…"
									className="pl-9"
								/>
							</div>
						</div>
						<div className="flex gap-2">
							<Button size="sm" onClick={applyFilters}>
								Apply filters
							</Button>
							<Button size="sm" variant="outline" onClick={resetFilters}>
								Reset
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{error && (
				<div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
					{error}
				</div>
			)}

			{loading ? (
				<Card className="shadow-xs">
					<CardContent className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Loading contacts…
					</CardContent>
				</Card>
			) : contacts.length === 0 ? (
				<Card className="shadow-xs">
					<CardContent className="flex h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
						<Users className="size-6" />
						<p>No contacts found.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{contacts.map((contact) => (
						<ContactCard
							key={contact.id}
							contact={contact}
							onCall={() => onClickToDial(contact)}
							canDial={
								canDialBase && normalizeDialInput(contact.caller_phone ?? '') !== null
							}
							dialing={dialingId === contact.id}
							onViewRecord={() =>
								contact.lead_id && setSelectedLeadId(contact.lead_id)
							}
						/>
					))}
				</div>
			)}

			{totalPages > 1 && (
				<div className="flex items-center justify-between">
					<Button
						size="sm"
						variant="outline"
						disabled={page <= 1 || loading}
						onClick={() => setPage((current) => Math.max(1, current - 1))}
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
						onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
					>
						Next
					</Button>
				</div>
			)}

			<LeadRecordDialog
				leadId={selectedLeadId}
				onOpenChange={(open) => !open && setSelectedLeadId(null)}
			/>
		</div>
	);
}

function ContactCard({
	contact,
	onCall,
	canDial,
	dialing,
	onViewRecord
}: {
	contact: ActivityListItem;
	onCall: () => void;
	canDial: boolean;
	dialing: boolean;
	onViewRecord: () => void;
}) {
	return (
		<Card className="overflow-hidden shadow-xs">
			<CardHeader className="space-y-3 pb-4">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<CardTitle className="truncate text-lg">
							{contact.name || 'Unknown contact'}
						</CardTitle>
						<p className="mt-1 font-mono text-xs text-muted-foreground">
							{contact.caller_phone || 'No phone number'}
						</p>
					</div>
					<Badge variant="secondary">Lead</Badge>
				</div>
				<div className="grid grid-cols-2 gap-3 text-xs">
					<CrmField label="Campaign" value={contact.campaign_name || '—'} />
					<CrmField label="Disposition" value={contact.disposition_label || '—'} />
					<CrmField label="Saved" value={fmt(contact.activity_at)} />
				</div>
			</CardHeader>
			<CardContent className="space-y-4 border-t pt-4">
				<div className="flex flex-wrap gap-2">
					{canDial && (
						<Button size="sm" onClick={onCall} disabled={dialing}>
							{dialing ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Phone className="size-4" />
							)}
							Call
						</Button>
					)}
					<Button size="sm" variant="outline" onClick={onViewRecord}>
						View record
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function LeadRecordDialog({
	leadId,
	onOpenChange
}: {
	leadId: string | null;
	onOpenChange: (open: boolean) => void;
}) {
	const [detail, setDetail] = useState<LeadDetailResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		let cancelled = false;
		if (!leadId) {
			setDetail(null);
			setError(null);
			return;
		}
		getLeadDetail(leadId)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setError(res.statusMessage || 'Failed to load record');
					return;
				}
				setDetail(res);
			})
			.catch((err) => !cancelled && setError(readError(err, 'Failed to load record')));
		return () => {
			cancelled = true;
		};
	}, [leadId]);

	const copyText = useMemo(() => leadToText(detail), [detail]);
	const onCopy = () => {
		if (!copyText || !navigator.clipboard) return;
		void navigator.clipboard
			.writeText(copyText)
			.then(() => {
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => undefined);
	};

	return (
		<DialogPrimitive.Root open={!!leadId} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-popover text-popover-foreground shadow-lg">
					<div className="flex items-start justify-between gap-4 border-b p-5">
						<div className="min-w-0 space-y-1">
							<DialogPrimitive.Title className="truncate text-lg font-semibold">
								{detail?.lead?.name || 'Lead record'}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								Select any value to copy it, or copy the whole record.
							</DialogPrimitive.Description>
						</div>
						<div className="flex shrink-0 gap-2">
							<Button size="sm" variant="outline" onClick={onCopy} disabled={!copyText}>
								{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
								{copied ? 'Copied' : 'Copy all'}
							</Button>
							<DialogPrimitive.Close asChild>
								<Button size="icon" variant="ghost" aria-label="Close lead record">
									<X className="size-4" />
								</Button>
							</DialogPrimitive.Close>
						</div>
					</div>
					<div className="overflow-y-auto p-5">
						{error ? (
							<p className="text-sm text-destructive">{error}</p>
						) : !detail?.lead ? (
							<p className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading record…
							</p>
						) : (
							<LeadRecordContent detail={detail} />
						)}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function LeadRecordContent({detail}: {detail: LeadDetailResponse}) {
	const lead = detail.lead!;
	const schema = lead.form_schema_snapshot ?? [];
	return (
		<div className="space-y-6">
			<section className="space-y-3">
				<h2 className="text-sm font-semibold">Lead details</h2>
				<div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
					<CopyableField label="Name" value={lead.name || '—'} />
					<CopyableField label="Phone" value={lead.caller_phone || '—'} />
					<CopyableField label="Campaign" value={detail.campaign_name || '—'} />
					<CopyableField
						label="Disposition"
						value={lead.disposition_label || '—'}
					/>
					<CopyableField label="Created" value={fmtDateTime(lead.created_at)} />
					<CopyableField label="Last updated" value={fmtDateTime(lead.updated_at)} />
				</div>
			</section>

			<section className="space-y-3 border-t pt-5">
				<h2 className="text-sm font-semibold">Form responses</h2>
				{schema.length > 0 ? (
					<div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
						{schema.map((field) => (
							<CopyableField
								key={field.key}
								label={field.label || field.key}
								value={formatValue(lead.form_data?.[field.key])}
							/>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">No form fields were captured.</p>
				)}
			</section>

			{detail.events && detail.events.length > 0 && (
				<section className="space-y-3 border-t pt-5">
					<h2 className="text-sm font-semibold">Lead history</h2>
					<ul className="space-y-2 text-sm select-text">
						{detail.events.map((event) => (
							<li key={event.id} className="flex justify-between gap-4">
								<span>{event.event_type}</span>
								<span className="text-muted-foreground">
									{fmtDateTime(event.created_at)}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

function CopyableField({label, value}: {label: string; value: string}) {
	return (
		<div className="min-w-0 rounded-md border bg-muted/20 p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 whitespace-pre-wrap break-words text-sm select-text">{value}</p>
		</div>
	);
}

function CrmField({label, value}: {label: string; value: string}) {
	return (
		<div className="min-w-0">
			<p className="text-muted-foreground">{label}</p>
			<p className="truncate font-medium" title={value}>
				{value}
			</p>
		</div>
	);
}

function fmt(iso: string | null | undefined): string {
	if (!iso) return '—';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function fmtDateTime(iso: string | null | undefined): string {
	if (!iso) return '—';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—';
	if (Array.isArray(value)) return value.join(', ');
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value === 'object') return JSON.stringify(value, null, 2);
	return String(value);
}

function leadToText(detail: LeadDetailResponse | null): string {
	if (!detail?.lead) return '';
	const lead = detail.lead;
	const lines = [
		`Name: ${lead.name || '—'}`,
		`Phone: ${lead.caller_phone || '—'}`,
		`Campaign: ${detail.campaign_name || '—'}`,
		`Disposition: ${lead.disposition_label || '—'}`,
		`Created: ${fmtDateTime(lead.created_at)}`,
		`Last updated: ${fmtDateTime(lead.updated_at)}`
	];
	for (const field of lead.form_schema_snapshot ?? []) {
		lines.push(`${field.label || field.key}: ${formatValue(lead.form_data?.[field.key])}`);
	}
	return lines.join('\n');
}

function readError(err: any, fallback: string): string {
	return err?.response?.data?.statusMessage || err?.message || fallback;
}
