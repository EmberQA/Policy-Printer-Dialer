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
	Pencil,
	Phone,
	RefreshCw,
	Save,
	Search,
	Upload,
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
	getLeadFormBundle,
	listCampaigns,
	listCrmContacts,
	updateLead,
	type ActivityFilters,
	type ActivityListItem,
	type DialerCampaign,
	type DialerDisposition,
	type DialerForm,
	type LeadDetailResponse
} from '@/lib/api';
import {normalizeDialInput} from '@/lib/phone';
import {cn} from '@/lib/utils';
import {useDialerSession} from '@/session/DialerSessionProvider';
import {getUser} from '@/auth/session';
import {FormRenderer, type LeadFormData} from '@/leads/FormRenderer';
import {getSavedDispositionFallback} from './crmDisposition';
import {
	buildLeadEditFormData,
	deriveLeadName,
	formHasNameFields
} from './crmLeadEdit';
import {
	TLD_FORM_SCHEMA,
	contactFormData,
	filterImportedContacts,
	findMatchingAgentKey,
	importTldRows,
	importedContactToActivity,
	listTldAgents,
	loadTldContacts,
	parseTldCsv,
	rowsForAgent,
	statusSummary,
	type ImportedTldContact,
	type TldCsvRow
} from './tldImport';

const PAGE_SIZE = 25;

export default function Crm({
	callbacksOnly = false
}: {
	callbacksOnly?: boolean;
}) {
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
	const [selectedImportedId, setSelectedImportedId] = useState<string | null>(
		null
	);
	const [importOpen, setImportOpen] = useState(false);
	const [dialingId, setDialingId] = useState<string | null>(null);
	const signedInUser = getUser();
	const signedInUserId = signedInUser?.user_id ?? '';
	const signedInName = [signedInUser?.first_name, signedInUser?.last_name]
		.filter(Boolean)
		.join(' ');
	const [importedContacts, setImportedContacts] = useState<
		ImportedTldContact[]
	>(() => loadTldContacts(signedInUserId));
	const {device, canDialBase} = useDialerSession();
	const navigate = useNavigate();

	const visibleImportedContacts = useMemo(
		() => filterImportedContacts(importedContacts, applied, callbacksOnly),
		[applied, callbacksOnly, importedContacts]
	);
	const selectedImportedContact =
		importedContacts.find((contact) => contact.id === selectedImportedId) ??
		null;

	useEffect(() => {
		listCampaigns()
			.then((res) => setCampaigns(res.campaigns ?? []))
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		listCrmContacts(applied, PAGE_SIZE, page, callbacksOnly)
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
	}, [applied, callbacksOnly, page]);

	const refreshContacts = () => {
		setImportedContacts(loadTldContacts(signedInUserId));
		setApplied((current) => ({...current}));
	};

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
		setSelectedImportedId(null);
		setPage(1);
		setApplied({});
	};

	const onClickToDial = (contact: ActivityListItem) => {
		const destination = contact.caller_phone
			? normalizeDialInput(contact.caller_phone)
			: null;
		if (!destination || !canDialBase || dialingId) return;
		setDialingId(contact.id);
		const attempt = device.startOutbound(destination);
		navigate('/dial');
		attempt
			.catch((err) => setError(readError(err, 'Could not place the call')))
			.finally(() => setDialingId(null));
	};

	return (
		<div className="mx-auto max-w-6xl space-y-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">
						{callbacksOnly ? 'Callbacks' : 'CRM'}
					</h1>
					<p className="text-sm leading-6 text-muted-foreground">
						{/* {callbacksOnly
							? 'Contacts whose latest disposition is Callback.'
							: 'Your saved lead records, organized by contact instead of individual calls.'} */}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="outline">
						{total + visibleImportedContacts.length} contacts
					</Badge>
					{!callbacksOnly && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setImportOpen(true)}
						>
							<Upload className="size-4" />
							Import TLD
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={refreshContacts}
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
			) : contacts.length === 0 && visibleImportedContacts.length === 0 ? (
				<Card className="shadow-xs">
					<CardContent className="flex h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
						<Users className="size-6" />
						<p>
							{callbacksOnly ? 'No callbacks found.' : 'No contacts found.'}
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{page === 1 &&
						visibleImportedContacts.map((contact) => {
							const activity = importedContactToActivity(contact);
							return (
								<ContactCard
									key={activity.id}
									contact={activity}
									importedFromTld
									onCall={() => onClickToDial(activity)}
									canDial={
										canDialBase &&
										normalizeDialInput(activity.caller_phone ?? '') !== null
									}
									dialing={dialingId === activity.id}
									onViewRecord={() => setSelectedImportedId(contact.id)}
								/>
							);
						})}
					{contacts.map((contact) => (
						<ContactCard
							key={contact.id}
							contact={contact}
							onCall={() => onClickToDial(contact)}
							canDial={
								canDialBase &&
								normalizeDialInput(contact.caller_phone ?? '') !== null
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
						onClick={() =>
							setPage((current) => Math.min(totalPages, current + 1))
						}
					>
						Next
					</Button>
				</div>
			)}

			<LeadRecordDialog
				leadId={selectedLeadId}
				onOpenChange={(open) => !open && setSelectedLeadId(null)}
				onUpdated={() => {
					setSelectedLeadId(null);
					refreshContacts();
				}}
			/>
			<ImportedTldRecordDialog
				contact={selectedImportedContact}
				onOpenChange={(open) => !open && setSelectedImportedId(null)}
			/>
			{!callbacksOnly && (
				<TldImportDialog
					open={importOpen}
					onOpenChange={setImportOpen}
					signedInUserId={signedInUserId}
					signedInName={signedInName}
					onImported={(contacts) => {
						setImportedContacts(contacts);
						setPage(1);
					}}
				/>
			)}
		</div>
	);
}

function ContactCard({
	contact,
	onCall,
	canDial,
	dialing,
	onViewRecord,
	importedFromTld = false
}: {
	contact: ActivityListItem;
	onCall: () => void;
	canDial: boolean;
	dialing: boolean;
	onViewRecord: () => void;
	importedFromTld?: boolean;
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
					<Badge variant="secondary">
						{importedFromTld ? 'TLD import' : 'Lead'}
					</Badge>
				</div>
				<div className="grid grid-cols-2 gap-3 text-xs">
					<CrmField label="Campaign" value={contact.campaign_name || '—'} />
					<CrmField
						label="Disposition"
						value={contact.disposition_label || '—'}
					/>
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

function TldImportDialog({
	open,
	onOpenChange,
	signedInUserId,
	signedInName,
	onImported
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	signedInUserId: string;
	signedInName: string;
	onImported: (contacts: ImportedTldContact[]) => void;
}) {
	const [rows, setRows] = useState<TldCsvRow[]>([]);
	const [fileName, setFileName] = useState('');
	const [selectedAgentKey, setSelectedAgentKey] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [importMessage, setImportMessage] = useState<string | null>(null);
	const agents = useMemo(() => listTldAgents(rows), [rows]);
	const selectedRows = useMemo(
		() => rowsForAgent(rows, selectedAgentKey),
		[rows, selectedAgentKey]
	);
	const statuses = useMemo(() => statusSummary(selectedRows), [selectedRows]);

	const reset = () => {
		setRows([]);
		setFileName('');
		setSelectedAgentKey('');
		setError(null);
		setImportMessage(null);
	};

	const handleOpenChange = (next: boolean) => {
		onOpenChange(next);
		if (!next) reset();
	};

	const handleFile = async (file: File | undefined) => {
		if (!file) return;
		setError(null);
		setImportMessage(null);
		try {
			const parsed = parseTldCsv(await file.text());
			const parsedAgents = listTldAgents(parsed);
			setRows(parsed);
			setFileName(file.name);
			setSelectedAgentKey(
				findMatchingAgentKey(parsedAgents, signedInName) ||
					(parsedAgents.length === 1 ? parsedAgents[0].key : '')
			);
		} catch (err) {
			setRows([]);
			setFileName(file.name);
			setSelectedAgentKey('');
			setError(readError(err, 'Could not read the TLD export'));
		}
	};

	const runImport = () => {
		if (!signedInUserId) {
			setError('The signed-in Policy Printer user could not be identified.');
			return;
		}
		if (selectedRows.length === 0) {
			setError('Choose a TLD user with at least one row.');
			return;
		}
		try {
			const result = importTldRows(signedInUserId, selectedRows);
			onImported(result.contacts);
			setImportMessage(
				`Imported ${selectedRows.length} rows: ${result.added} new, ${result.updated} updated.`
			);
			setError(null);
		} catch (err) {
			setError(readError(err, 'Could not save the front-end TLD import'));
		}
	};

	return (
		<DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-popover text-popover-foreground shadow-lg">
					<div className="flex items-start justify-between gap-4 border-b p-5">
						<div className="space-y-1">
							<DialogPrimitive.Title className="text-lg font-semibold">
								Import TLD contacts
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								Upload a TLD CSV export, then choose the TLD user whose contacts
								belong to this Policy Printer account.
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button size="icon" variant="ghost" aria-label="Close TLD import">
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					<div className="space-y-5 overflow-y-auto p-5">
						<div className="space-y-2">
							<Label htmlFor="tld-import-file">TLD export file</Label>
							<Input
								id="tld-import-file"
								type="file"
								accept=".csv,text/csv"
								onChange={(event) => {
									void handleFile(event.target.files?.[0]);
									event.target.value = '';
								}}
							/>
							{fileName && (
								<p className="text-xs text-muted-foreground">
									{fileName} {rows.length > 0 && `• ${rows.length} rows`}
								</p>
							)}
						</div>

						{rows.length > 0 && (
							<>
								<div className="space-y-2">
									<Label>TLD user to import</Label>
									<Select
										value={selectedAgentKey}
										onValueChange={setSelectedAgentKey}
									>
										<SelectTrigger className="w-full">
											<SelectValue placeholder="Choose a user from this export" />
										</SelectTrigger>
										<SelectContent>
											{agents.map((agent) => (
												<SelectItem key={agent.key} value={agent.key}>
													{agent.name}
													{agent.userId ? ` (#${agent.userId})` : ''} •{' '}
													{agent.count}
													{agent.count === 1 ? ' row' : ' rows'}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{signedInName && !selectedAgentKey && (
										<p className="text-xs text-muted-foreground">
											No exact match was found for signed-in user {signedInName}
											. Choose the correct TLD user manually.
										</p>
									)}
								</div>

								{selectedRows.length > 0 && (
									<div className="space-y-3 rounded-md border bg-muted/20 p-4">
										<div className="flex items-center justify-between gap-3">
											<div>
												<p className="text-sm font-medium">
													Disposition mapping
												</p>
												<p className="text-xs text-muted-foreground">
													Original TLD codes remain in Notes for review.
												</p>
											</div>
											<Badge variant="outline">
												{selectedRows.length} selected
											</Badge>
										</div>
										<div className="grid gap-2 sm:grid-cols-2">
											{statuses.map(({status, count, mapping}) => (
												<div
													key={status}
													className="flex items-center justify-between gap-3 rounded border bg-background px-3 py-2 text-xs"
												>
													<span className="font-mono">
														{status}{' '}
														<span className="text-muted-foreground">
															×{count}
														</span>
													</span>
													<span className="text-right">{mapping.label}</span>
												</div>
											))}
										</div>
									</div>
								)}
							</>
						)}

						{error && (
							<div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
								{error}
							</div>
						)}
						{importMessage && (
							<div className="rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
								{importMessage}
							</div>
						)}
					</div>

					<div className="flex items-center justify-between gap-3 border-t p-5">
						<p className="text-xs text-muted-foreground">
							Stored in this browser for the signed-in Policy Printer user.
						</p>
						<div className="flex gap-2">
							<DialogPrimitive.Close asChild>
								<Button variant="outline" size="sm">
									{importMessage ? 'Done' : 'Cancel'}
								</Button>
							</DialogPrimitive.Close>
							<Button
								size="sm"
								onClick={runImport}
								disabled={selectedRows.length === 0 || !!importMessage}
							>
								<Upload className="size-4" />
								Import {selectedRows.length || ''} contacts
							</Button>
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function ImportedTldRecordDialog({
	contact,
	onOpenChange
}: {
	contact: ImportedTldContact | null;
	onOpenChange: (open: boolean) => void;
}) {
	const [copied, setCopied] = useState(false);
	const formData = contact ? contactFormData(contact) : {};
	const copyText = contact
		? [
				`Name: ${contact.fullName || '—'}`,
				`Phone: ${contact.phone || contact.alternatePhone || '—'}`,
				`Campaign: ${contact.listName || 'TLD import'}`,
				`Disposition: ${contact.dispositionLabel}`,
				...TLD_FORM_SCHEMA.map(
					(field) => `${field.label}: ${formatValue(formData[field.key])}`
				)
			].join('\n')
		: '';

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
		<DialogPrimitive.Root open={!!contact} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-popover text-popover-foreground shadow-lg">
					<div className="flex items-start justify-between gap-4 border-b p-5">
						<div className="min-w-0 space-y-1">
							<div className="flex items-center gap-2">
								<DialogPrimitive.Title className="truncate text-lg font-semibold">
									{contact?.fullName || 'TLD contact'}
								</DialogPrimitive.Title>
								<Badge variant="secondary">TLD import</Badge>
							</div>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								Front-end contact imported from TLD.
							</DialogPrimitive.Description>
						</div>
						<div className="flex shrink-0 gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={onCopy}
								disabled={!copyText}
							>
								{copied ? (
									<Check className="size-4" />
								) : (
									<Copy className="size-4" />
								)}
								{copied ? 'Copied' : 'Copy all'}
							</Button>
							<DialogPrimitive.Close asChild>
								<Button
									size="icon"
									variant="ghost"
									aria-label="Close TLD record"
								>
									<X className="size-4" />
								</Button>
							</DialogPrimitive.Close>
						</div>
					</div>

					{contact && (
						<div className="space-y-6 overflow-y-auto p-5">
							<section className="space-y-3">
								<h2 className="text-sm font-semibold">Lead details</h2>
								<div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
									<CopyableField label="Name" value={contact.fullName || '—'} />
									<CopyableField
										label="Phone"
										value={contact.phone || contact.alternatePhone || '—'}
									/>
									<CopyableField
										label="Campaign"
										value={contact.listName || 'TLD import'}
									/>
									<CopyableField
										label="Saved disposition"
										value={contact.dispositionLabel}
									/>
									<CopyableField
										label="TLD status"
										value={contact.tldStatus || '—'}
									/>
									<CopyableField
										label="TLD lead ID"
										value={contact.sourceLeadId || '—'}
									/>
									<CopyableField
										label="Created in TLD"
										value={fmtDateTime(contact.entryDate)}
									/>
									<CopyableField
										label="Imported"
										value={fmtDateTime(contact.importedAt)}
									/>
								</div>
							</section>

							<section className="space-y-3 border-t pt-5">
								<h2 className="text-sm font-semibold">Form responses</h2>
								<div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
									{TLD_FORM_SCHEMA.map((field) => (
										<CopyableField
											key={field.key}
											label={field.label}
											value={formatValue(formData[field.key])}
										/>
									))}
								</div>
							</section>
						</div>
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function LeadRecordDialog({
	leadId,
	onOpenChange,
	onUpdated
}: {
	leadId: string | null;
	onOpenChange: (open: boolean) => void;
	onUpdated: () => void;
}) {
	const [detail, setDetail] = useState<LeadDetailResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [dispositions, setDispositions] = useState<DialerDisposition[]>([]);
	const [currentForm, setCurrentForm] = useState<DialerForm | null>(null);
	const [dispositionKey, setDispositionKey] = useState('');
	const [loadingDispositions, setLoadingDispositions] = useState(false);
	const [savingDisposition, setSavingDisposition] = useState(false);
	const [dispositionError, setDispositionError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [editName, setEditName] = useState('');
	const [editFormData, setEditFormData] = useState<LeadFormData>({});
	const [savingLead, setSavingLead] = useState(false);
	const [editError, setEditError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!leadId) {
			setDetail(null);
			setError(null);
			setDispositions([]);
			setCurrentForm(null);
			setDispositionKey('');
			setDispositionError(null);
			setLoadingDispositions(false);
			setSavingDisposition(false);
			setEditing(false);
			setEditName('');
			setEditFormData({});
			setSavingLead(false);
			setEditError(null);
			return;
		}
		setDetail(null);
		setError(null);
		setDispositions([]);
		setCurrentForm(null);
		setDispositionKey('');
		setDispositionError(null);
		setLoadingDispositions(false);
		setSavingDisposition(false);
		setEditing(false);
		setEditName('');
		setEditFormData({});
		setSavingLead(false);
		setEditError(null);
		getLeadDetail(leadId)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setError(res.statusMessage || 'Failed to load record');
					return;
				}
				setDetail(res);
				setDispositionKey(res.lead?.disposition_id ?? '');
				setEditName(res.lead?.name ?? '');
			})
			.catch(
				(err) => !cancelled && setError(readError(err, 'Failed to load record'))
			);
		return () => {
			cancelled = true;
		};
	}, [leadId]);

	useEffect(() => {
		let cancelled = false;
		const campaignId = detail?.lead?.campaign_id;
		if (!campaignId) {
			setDispositions([]);
			setCurrentForm(null);
			setLoadingDispositions(false);
			setDispositionError(null);
			return;
		}
		setDispositions([]);
		setCurrentForm(null);
		setLoadingDispositions(true);
		setDispositionError(null);
		getLeadFormBundle(campaignId)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setDispositionError(
						res.statusMessage || 'Failed to load dispositions'
					);
					return;
				}
				setDispositions(res.dispositions ?? []);
				setCurrentForm(res.form ?? null);
				if (res.form && detail?.lead) {
					setEditFormData(
						buildLeadEditFormData(
							res.form.schema,
							detail.lead.form_schema_snapshot,
							detail.lead.form_data
						)
					);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setDispositionError(readError(err, 'Failed to load dispositions'));
				}
			})
			.finally(() => {
				if (!cancelled) setLoadingDispositions(false);
			});
		return () => {
			cancelled = true;
		};
	}, [detail?.lead?.campaign_id]);

	const beginEditing = () => {
		if (!detail?.lead) return;
		setEditName(detail.lead.name ?? '');
		setDispositionKey(detail.lead.disposition_id ?? '');
		setEditFormData(
			currentForm
				? buildLeadEditFormData(
						currentForm.schema,
						detail.lead.form_schema_snapshot,
						detail.lead.form_data
					)
				: {}
		);
		setEditError(null);
		setEditing(true);
	};

	const cancelEditing = () => {
		if (detail?.lead) {
			setDispositionKey(detail.lead.disposition_id ?? '');
		}
		setEditError(null);
		setEditing(false);
	};

	const saveLeadEdits = async () => {
		const lead = detail?.lead;
		if (!lead) return;
		setSavingLead(true);
		setEditError(null);
		try {
			const dispositionChanged = dispositionKey !== lead.disposition_id;
			const res = await updateLead({
				lead_id: lead.id,
				name: deriveLeadName(
					currentForm?.schema ?? [],
					editFormData,
					editName
				),
				...(dispositionChanged
					? {disposition_id: dispositionKey || null}
					: {}),
				...(currentForm ? {form_data: editFormData} : {})
			});
			if (res.statusCode !== 'SP100') {
				throw new Error(res.statusMessage || 'Failed to update lead');
			}
			onUpdated();
		} catch (err) {
			setEditError(readError(err, 'Failed to update lead'));
		} finally {
			setSavingLead(false);
		}
	};

	const saveDisposition = async () => {
		const lead = detail?.lead;
		if (!lead || !dispositionKey || dispositionKey === lead.disposition_id)
			return;
		setSavingDisposition(true);
		setDispositionError(null);
		try {
			const res = await updateLead({
				lead_id: lead.id,
				disposition_id: dispositionKey
			});
			if (res.statusCode !== 'SP100') {
				throw new Error(res.statusMessage || 'Failed to update disposition');
			}
			onUpdated();
		} catch (err) {
			setDispositionError(readError(err, 'Failed to update disposition'));
		} finally {
			setSavingDisposition(false);
		}
	};

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
								{editing
									? 'Update the contact details, disposition, or form responses.'
									: 'Select any value to copy it, or copy the whole record.'}
							</DialogPrimitive.Description>
						</div>
						<div className="flex shrink-0 gap-2">
							{editing ? (
								<Button
									size="sm"
									variant="outline"
									onClick={cancelEditing}
									disabled={savingLead}
								>
									Cancel
								</Button>
							) : (
								<>
									<Button
										size="sm"
										variant="outline"
										onClick={beginEditing}
										disabled={!detail?.lead || loadingDispositions}
									>
										<Pencil className="size-4" />
										Edit lead
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={onCopy}
										disabled={!copyText}
									>
										{copied ? (
											<Check className="size-4" />
										) : (
											<Copy className="size-4" />
										)}
										{copied ? 'Copied' : 'Copy all'}
									</Button>
								</>
							)}
							<DialogPrimitive.Close asChild>
								<Button
									size="icon"
									variant="ghost"
									aria-label="Close lead record"
								>
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
						) : editing ? (
							<LeadEditContent
								detail={detail}
								form={currentForm}
								formData={editFormData}
								onFormFieldChange={(key, value) =>
									setEditFormData((current) => ({...current, [key]: value}))
								}
								name={editName}
								onNameChange={setEditName}
								dispositions={dispositions}
								dispositionKey={dispositionKey}
								onDispositionChange={setDispositionKey}
								bundleError={dispositionError}
								saving={savingLead}
								error={editError}
								onCancel={cancelEditing}
								onSave={saveLeadEdits}
							/>
						) : (
							<LeadRecordContent
								detail={detail}
								dispositions={dispositions}
								dispositionKey={dispositionKey}
								onDispositionChange={setDispositionKey}
								onSaveDisposition={saveDisposition}
								loadingDispositions={loadingDispositions}
								savingDisposition={savingDisposition}
								dispositionError={dispositionError}
							/>
						)}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function LeadEditContent({
	detail,
	form,
	formData,
	onFormFieldChange,
	name,
	onNameChange,
	dispositions,
	dispositionKey,
	onDispositionChange,
	bundleError,
	saving,
	error,
	onCancel,
	onSave
}: {
	detail: LeadDetailResponse;
	form: DialerForm | null;
	formData: LeadFormData;
	onFormFieldChange: (key: string, value: unknown) => void;
	name: string;
	onNameChange: (value: string) => void;
	dispositions: DialerDisposition[];
	dispositionKey: string;
	onDispositionChange: (value: string) => void;
	bundleError: string | null;
	saving: boolean;
	error: string | null;
	onCancel: () => void;
	onSave: () => void;
}) {
	const lead = detail.lead!;
	const savedDispositionFallback = getSavedDispositionFallback(
		lead.disposition_id,
		lead.disposition_label,
		dispositions
	);
	const hasNameFields = formHasNameFields(form?.schema ?? []);

	return (
		<div className="space-y-6">
			<section className="space-y-4">
				<h2 className="text-sm font-semibold">Lead details</h2>
				<div className="grid gap-4 sm:grid-cols-2">
					{!hasNameFields && (
						<div className="space-y-2">
							<Label htmlFor="crm_lead_name">Contact name</Label>
							<Input
								id="crm_lead_name"
								value={name}
								onChange={(event) => onNameChange(event.target.value)}
								disabled={saving}
							/>
						</div>
					)}
					<div className="space-y-2">
						<Label>Disposition</Label>
						<Select
							value={dispositionKey}
							onValueChange={onDispositionChange}
							disabled={saving || dispositions.length === 0}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select disposition" />
							</SelectTrigger>
							<SelectContent>
								{savedDispositionFallback && (
									<SelectItem value={savedDispositionFallback.key} disabled>
										{savedDispositionFallback.label} (saved; no longer active)
									</SelectItem>
								)}
								{dispositions.map((disposition) => (
									<SelectItem
										key={disposition.disposition_key}
										value={disposition.disposition_key}
									>
										{disposition.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<CopyableField label="Phone" value={lead.caller_phone || '—'} />
					<CopyableField
						label="Campaign"
						value={detail.campaign_name || '—'}
					/>
				</div>
				<p className="text-xs text-muted-foreground">
					Phone and campaign come from the original call and cannot be changed
					here.
				</p>
			</section>

			<section className="space-y-4 border-t pt-5">
				<div className="space-y-1">
					<h2 className="text-sm font-semibold">Form responses</h2>
					{form && (
						<p className="text-xs text-muted-foreground">
							Editing with the campaign’s current published form.
						</p>
					)}
				</div>
				{form ? (
					<FormRenderer
						schema={form.schema}
						value={formData}
						onChange={onFormFieldChange}
						disabled={saving}
					/>
				) : (
					<p className="text-sm text-muted-foreground">
						No published form is currently available. You can still update the
						lead name or disposition.
					</p>
				)}
				{bundleError && (
					<p className="text-sm text-destructive">{bundleError}</p>
				)}
			</section>

			{error && <p className="text-sm text-destructive">{error}</p>}

			<div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={saving}
				>
					Cancel
				</Button>
				<Button type="button" onClick={onSave} disabled={saving}>
					{saving ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Save className="size-4" />
					)}
					{saving ? 'Saving…' : 'Save changes'}
				</Button>
			</div>
		</div>
	);
}

function LeadRecordContent({
	detail,
	dispositions,
	dispositionKey,
	onDispositionChange,
	onSaveDisposition,
	loadingDispositions,
	savingDisposition,
	dispositionError
}: {
	detail: LeadDetailResponse;
	dispositions: DialerDisposition[];
	dispositionKey: string;
	onDispositionChange: (value: string) => void;
	onSaveDisposition: () => void;
	loadingDispositions: boolean;
	savingDisposition: boolean;
	dispositionError: string | null;
}) {
	const lead = detail.lead!;
	const schema = lead.form_schema_snapshot ?? [];
	const savedDispositionFallback = getSavedDispositionFallback(
		lead.disposition_id,
		lead.disposition_label,
		dispositions
	);
	return (
		<div className="space-y-6">
			<section className="space-y-3">
				<h2 className="text-sm font-semibold">Lead details</h2>
				<div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
					<CopyableField label="Name" value={lead.name || '—'} />
					<CopyableField label="Phone" value={lead.caller_phone || '—'} />
					<CopyableField label="Campaign" value={detail.campaign_name || '—'} />
					<CopyableField
						label="Saved disposition"
						value={lead.disposition_label || '—'}
					/>
					<div className="space-y-2 rounded-md border bg-muted/20 p-3 sm:col-span-2">
						<Label>Change disposition</Label>
						<div className="flex flex-col gap-2 sm:flex-row">
							<Select
								value={dispositionKey}
								onValueChange={onDispositionChange}
								disabled={
									loadingDispositions ||
									savingDisposition ||
									dispositions.length === 0
								}
							>
								<SelectTrigger className="w-full sm:max-w-sm">
									<SelectValue
										placeholder={
											loadingDispositions ? 'Loading…' : 'Select disposition'
										}
									/>
								</SelectTrigger>
								<SelectContent>
									{savedDispositionFallback && (
										<SelectItem value={savedDispositionFallback.key} disabled>
											{savedDispositionFallback.label} (saved; no longer active)
										</SelectItem>
									)}
									{dispositions.map((disposition) => (
										<SelectItem
											key={disposition.disposition_key}
											value={disposition.disposition_key}
										>
											{disposition.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								size="sm"
								onClick={onSaveDisposition}
								disabled={
									loadingDispositions ||
									savingDisposition ||
									!dispositionKey ||
									dispositionKey === lead.disposition_id
								}
							>
								{savingDisposition && (
									<Loader2 className="size-4 animate-spin" />
								)}
								Save disposition
							</Button>
						</div>
						{dispositionError && (
							<p className="text-xs text-destructive">{dispositionError}</p>
						)}
					</div>
					<CopyableField label="Created" value={fmtDateTime(lead.created_at)} />
					<CopyableField
						label="Last updated"
						value={fmtDateTime(lead.updated_at)}
					/>
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
					<p className="text-sm text-muted-foreground">
						No form fields were captured.
					</p>
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
			<p className="mt-1 whitespace-pre-wrap break-words text-sm select-text">
				{value}
			</p>
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
		lines.push(
			`${field.label || field.key}: ${formatValue(lead.form_data?.[field.key])}`
		);
	}
	return lines.join('\n');
}

function readError(err: any, fallback: string): string {
	return err?.response?.data?.statusMessage || err?.message || fallback;
}
