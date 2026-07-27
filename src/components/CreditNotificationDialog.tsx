import {CheckCircle2} from 'lucide-react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Button} from '@/components/ui/button';
import type {CreditNotification} from '@/lib/api';

export function CreditNotificationDialog({
	open,
	notification,
	onAcknowledge
}: {
	open: boolean;
	notification: CreditNotification | null;
	onAcknowledge: () => void;
}) {
	if (!notification) return null;

	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onAcknowledge();
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg">
					<div className="flex items-start gap-3">
						<CheckCircle2 className="mt-0.5 size-6 shrink-0 text-green-600" />
						<div className="space-y-1">
							<DialogPrimitive.Title className="text-lg font-semibold">
								Call Refund
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								A recent call didn't meet our standards. We're sorry about that.
								One call credit has been added to your account.
							</DialogPrimitive.Description>
						</div>
					</div>
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md bg-muted/50 px-4 py-3 text-sm">
						<dt className="text-muted-foreground">Caller ID</dt>
						<dd className="font-medium">
							{formatPhone(notification.caller_phone)}
						</dd>
						<dt className="text-muted-foreground">Call time</dt>
						<dd className="font-medium">
							{formatCallTime(notification.call_started_at)}
						</dd>
						<dt className="text-muted-foreground">Campaign</dt>
						<dd className="font-medium">
							{notification.campaign_name || 'Unknown'}
						</dd>
						<dt className="text-muted-foreground">Reason</dt>
						<dd className="font-medium">
							{formatReason(notification.credit_outcome)}
						</dd>
					</dl>
					<div className="flex justify-end">
						<Button type="button" onClick={onAcknowledge}>
							Got it
						</Button>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function formatPhone(value: string | null): string {
	if (!value) return 'Unknown';
	let digits = value.replace(/\D/g, '');
	if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
	if (digits.length !== 10) return value;
	return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatCallTime(value: string | null): string {
	if (!value) return 'Unknown';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return 'Unknown';
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	}).format(date);
}

function formatReason(value: string): string {
	const labels: Record<string, string> = {
		wrong_number: 'Caller said they dialed the wrong number.',
		grocery_angle: 'Caller was inquiring about a grocery benefit.',
		over_89: 'Caller was over 89 years old.',
		dead_air_call: 'The call had dead air.',
		onset_caller_hangup: 'Caller hung up at the start of the call.',
		manual_test: 'Manual test'
	};
	return labels[value] ?? value.replaceAll('_', ' ');
}
