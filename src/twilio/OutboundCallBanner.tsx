import {Loader2, PhoneOff, PhoneOutgoing} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import type {PendingOutboundCall} from '@/twilio/useDevice';
import type {StartingOutboundCall} from '@/twilio/outboundCallState';

export function OutboundCallBanner({
	toNumber,
	pending,
	starting,
	onCancel
}: {
	toNumber: string;
	pending: PendingOutboundCall | null;
	starting: StartingOutboundCall | null;
	onCancel: () => Promise<void>;
}) {
	const canceling = Boolean(pending?.canceling || starting?.canceling);
	const reconciling = Boolean(pending?.reconciling || starting?.reconciling);

	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-center gap-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
					<PhoneOutgoing className="size-4" />
				</div>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="secondary">
							{canceling
								? 'Canceling…'
								: reconciling
									? 'Confirming call…'
									: 'Calling outbound'}
						</Badge>
						{!canceling && !reconciling && (
							<span className="text-sm text-muted-foreground">Ringing…</span>
						)}
					</div>
					<div className="mt-1 truncate font-mono text-sm">{toNumber}</div>
				</div>
			</div>

			<Button
				variant="destructive"
				size="sm"
				disabled={canceling}
				onClick={() => void onCancel().catch(() => undefined)}
				className="self-end sm:self-auto"
			>
				{canceling ? <Loader2 className="size-4 animate-spin" /> : <PhoneOff className="size-4" />}
				Cancel call
			</Button>
		</div>
	);
}
