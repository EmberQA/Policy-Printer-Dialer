import {Calculator, Loader2, Phone} from 'lucide-react';
import {Link} from 'react-router-dom';
import {Button, buttonVariants} from '@/components/ui/button';
import {TableCell, TableRow} from '@/components/ui/table';
import type {DirectDeliveredLead, LicensedJurisdiction} from '@/lib/api';
import {QuoteButton} from '@/quotes/QuoteButton';
import {openQuoteComparison} from '@/quotes/quoteLink';
import {
	formatLeadPhone,
	formatReceived,
	leadFullName,
	stateLabel
} from './leadDisplay';

export function DirectDeliveredLeadRow({
	lead,
	jurisdictions,
	onCall,
	dialing,
	canDial
}: {
	lead: DirectDeliveredLead;
	jurisdictions: LicensedJurisdiction[];
	onCall: (lead: DirectDeliveredLead) => void;
	dialing: boolean;
	canDial: boolean;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">
				{leadFullName(lead)}
				<p className="text-xs font-normal text-muted-foreground">Direct post</p>
			</TableCell>
			<TableCell className="font-mono text-xs">
				{formatLeadPhone(lead.phone)}
			</TableCell>
			<TableCell>
				{lead.state ? stateLabel(lead.state, jurisdictions) : '—'}
			</TableCell>
			<TableCell>—</TableCell>
			<TableCell className="text-muted-foreground">—</TableCell>
			<TableCell className="text-muted-foreground">
				{formatReceived(lead.assigned_at)}
			</TableCell>
			<TableCell>{lead.disposition_label || '—'}</TableCell>
			<TableCell className="text-right">
				<div className="flex items-center justify-end gap-2">
					<Button
						size="icon"
						variant="outline"
						aria-label={`Call ${leadFullName(lead)}`}
						title={
							canDial
								? `Call ${formatLeadPhone(lead.phone)}`
								: 'Go ready and finish your current call to dial'
						}
						disabled={!canDial || dialing}
						onClick={() => onCall(lead)}
					>
						{dialing ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Phone className="size-4" />
						)}
					</Button>
					<QuoteButton
						size="sm"
						variant="outline"
						onClick={() => openQuoteComparison(lead.id)}
					>
						<Calculator className="size-4" />
						Quote
					</QuoteButton>
					<Link
						className={buttonVariants({size: 'sm', variant: 'outline'})}
						to={`/crm?lead_id=${encodeURIComponent(lead.id)}`}
					>
						View
					</Link>
				</div>
			</TableCell>
		</TableRow>
	);
}
