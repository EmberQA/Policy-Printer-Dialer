/**
 * One purchased lead (ENG-234 Subplan 05): the summary row plus an expandable
 * detail panel (contact details, TrustedForm, the agent's outcome + note, and
 * the attempt history the backend keeps).
 *
 * The Call button only STARTS a call; `call_count` / `first_called_at` /
 * `last_called_at` / `attempted` are written by the backend once the carrier
 * leg is accepted, so nothing here mutates them. `contacted` means the agent
 * confirms they spoke with the person — it is never set automatically.
 */

import {useState} from 'react';
import {Loader2, Phone, ExternalLink} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {TableCell, TableRow} from '@/components/ui/table';
import {Textarea} from '@/components/ui/textarea';
import {
	AGENT_SETTABLE_LEAD_STATUSES,
	type LicensedJurisdiction,
	type OutboundLead,
	type OutboundLeadStatus
} from '@/lib/api';
import {cn} from '@/lib/utils';
import {
	coverageLabel,
	formatCoverageAmount,
	formatDateTime,
	formatDollars,
	formatLeadPhone,
	formatReceived,
	leadFullName,
	leadIsCallable,
	leadStatusLabel,
	leadStatusTone,
	stateLabel
} from './leadDisplay';

export const PURCHASED_LEAD_COLUMNS = 8;

export interface PurchasedLeadRowProps {
	lead: OutboundLead;
	jurisdictions: LicensedJurisdiction[];
	expanded: boolean;
	onToggle: () => void;
	/** Place the call from the click gesture; the parent owns the in-flight guard. */
	onCall: (lead: OutboundLead) => void;
	/** True while THIS lead's start request is in flight. */
	dialing: boolean;
	/** Base dial gate from the session (provisioned, device registered, idle). */
	canDial: boolean;
	/** Save an outcome + note; resolves with the server's error text, if any. */
	onStatusChange: (
		lead: OutboundLead,
		status: OutboundLeadStatus,
		note: string
	) => Promise<string | null>;
}

export function PurchasedLeadRow({
	lead,
	jurisdictions,
	expanded,
	onToggle,
	onCall,
	dialing,
	canDial,
	onStatusChange
}: PurchasedLeadRowProps) {
	const refunded = lead.status === 'refunded';
	const callable = leadIsCallable(lead) && canDial;

	return (
		<>
			<TableRow
				aria-expanded={expanded}
				className={cn(refunded && 'text-muted-foreground opacity-70')}
			>
				<TableCell className="font-medium">{leadFullName(lead)}</TableCell>
				<TableCell className="font-mono text-xs">
					{formatLeadPhone(lead.phone)}
				</TableCell>
				<TableCell>{stateLabel(lead.state, jurisdictions)}</TableCell>
				<TableCell>{lead.age}</TableCell>
				<TableCell className="text-muted-foreground">
					{coverageLabel(lead.coverage_type)}
				</TableCell>
				<TableCell className="text-muted-foreground">
					{formatReceived(lead.assigned_at)}
				</TableCell>
				<TableCell>
					<Badge variant={leadStatusTone(lead.status)}>
						{leadStatusLabel(lead.status)}
					</Badge>
				</TableCell>
				<TableCell className="text-right">
					<div className="flex items-center justify-end gap-2">
						{!refunded && (
							<Button
								size="icon"
								variant="outline"
								aria-label={`Call ${leadFullName(lead)}`}
								title={
									callable
										? `Call ${formatLeadPhone(lead.phone)}`
										: 'Go ready and finish your current call to dial'
								}
								disabled={!callable || dialing}
								onClick={() => onCall(lead)}
							>
								{dialing ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Phone className="size-4" />
								)}
							</Button>
						)}
						<Button size="sm" variant="outline" onClick={onToggle}>
							{expanded ? 'Close' : 'View'}
						</Button>
					</div>
				</TableCell>
			</TableRow>
			{expanded && (
				<TableRow className="bg-muted/30 hover:bg-muted/30">
					<TableCell colSpan={PURCHASED_LEAD_COLUMNS} className="p-0">
						<LeadDetailPanel
							lead={lead}
							jurisdictions={jurisdictions}
							onStatusChange={onStatusChange}
						/>
					</TableCell>
				</TableRow>
			)}
		</>
	);
}

function Detail({label, value}: {label: string; value: React.ReactNode}) {
	return (
		<div className="space-y-0.5">
			<p className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<p className="text-sm">{value}</p>
		</div>
	);
}

function LeadDetailPanel({
	lead,
	jurisdictions,
	onStatusChange
}: {
	lead: OutboundLead;
	jurisdictions: LicensedJurisdiction[];
	onStatusChange: PurchasedLeadRowProps['onStatusChange'];
}) {
	const refunded = lead.status === 'refunded';
	const [status, setStatus] = useState<OutboundLeadStatus | ''>(
		AGENT_SETTABLE_LEAD_STATUSES.includes(lead.status) ? lead.status : ''
	);
	const [note, setNote] = useState(lead.agent_note ?? '');
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const dirty =
		(status !== '' && status !== lead.status) ||
		note.trim() !== (lead.agent_note ?? '');

	const save = async () => {
		if (!status) {
			setSaveError('Pick an outcome first');
			return;
		}
		setSaving(true);
		setSaveError(null);
		setSaved(false);
		const err = await onStatusChange(lead, status, note.trim());
		setSaving(false);
		if (err) setSaveError(err);
		else setSaved(true);
	};

	const address = [
		lead.address,
		lead.city,
		stateLabel(lead.state, jurisdictions),
		lead.zip
	]
		.filter((v) => v && String(v).trim())
		.join(', ');

	return (
		<div className="grid gap-6 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<div className="grid grid-cols-2 gap-x-6 gap-y-3">
				<Detail label="Phone" value={formatLeadPhone(lead.phone)} />
				<Detail label="Email" value={lead.email || '—'} />
				<Detail label="Address" value={address || '—'} />
				<Detail
					label="Date of birth"
					value={`${lead.date_of_birth} (${lead.age})`}
				/>
				<Detail
					label="Coverage"
					value={`${coverageLabel(lead.coverage_type)} · ${formatCoverageAmount(lead.coverage_amount)}`}
				/>
				<Detail label="Paid" value={formatDollars(lead.price_cents)} />
				<Detail
					label="TrustedForm"
					value={
						lead.trusted_form_url ? (
							<a
								href={lead.trusted_form_url}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
							>
								Certificate <ExternalLink className="size-3" />
							</a>
						) : (
							'—'
						)
					}
				/>
				<Detail label="Received" value={formatDateTime(lead.assigned_at)} />
				<Detail label="Call attempts" value={lead.call_count} />
				<Detail
					label="First called"
					value={formatDateTime(lead.first_called_at)}
				/>
				<Detail
					label="Last called"
					value={formatDateTime(lead.last_called_at)}
				/>
				{refunded && (
					<Detail
						label="Refunded"
						value={`${formatDateTime(lead.refunded_at)}${
							lead.refund_reason ? ` — ${lead.refund_reason}` : ''
						}`}
					/>
				)}
			</div>

			<div className="space-y-3">
				<div className="space-y-1.5">
					<Label htmlFor={`lead-status-${lead.id}`}>Outcome</Label>
					<select
						id={`lead-status-${lead.id}`}
						className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
						value={status}
						disabled={refunded || saving}
						onChange={(e) => {
							setStatus(e.target.value as OutboundLeadStatus | '');
							setSaved(false);
						}}
					>
						<option value="">
							{refunded
								? 'Refunded'
								: `Not set (${leadStatusLabel(lead.status)})`}
						</option>
						{AGENT_SETTABLE_LEAD_STATUSES.map((value) => (
							<option key={value} value={value}>
								{leadStatusLabel(value)}
							</option>
						))}
					</select>
					<p className="text-xs text-muted-foreground">
						Mark <span className="font-medium">Contacted</span> only after you
						spoke with the person. Call attempts are counted automatically.
					</p>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={`lead-note-${lead.id}`}>Note</Label>
					<Textarea
						id={`lead-note-${lead.id}`}
						rows={3}
						maxLength={2000}
						value={note}
						disabled={refunded || saving}
						onChange={(e) => {
							setNote(e.target.value);
							setSaved(false);
						}}
						placeholder="Anything worth remembering about this lead"
					/>
				</div>
				{saveError && <p className="text-sm text-destructive">{saveError}</p>}
				{!refunded && (
					<div className="flex items-center gap-3">
						<Button
							type="button"
							size="sm"
							disabled={saving || !dirty}
							onClick={() => void save()}
						>
							{saving && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
						{saved && !dirty && (
							<span className="text-xs text-muted-foreground">Saved</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
