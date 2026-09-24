import {useEffect, useRef, useState} from 'react';
import {FileText, Loader2, X} from 'lucide-react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Button} from '@/components/ui/button';
import {getUser} from '@/auth/session';

interface Props {
	open: boolean;
	saving: boolean;
	error: string | null;
	onBack: () => void;
	onConfirm: () => void;
	onReturnFocus: () => void;
}

const exclusions = [
	'Do not answer the phone or respond to contact attempts',
	'Have disconnected, incorrect, or outdated contact information',
	'State that they are no longer interested',
	'Deny or do not recall submitting their information',
	'Have already purchased insurance or are working with another agent',
	'Do not qualify for coverage',
	"Are outside of the agent's preferred underwriting criteria",
	'Are otherwise unable or unwilling to purchase a policy'
];

export function LeadPurchasePolicyDialog({
	open,
	saving,
	error,
	onBack,
	onConfirm,
	onReturnFocus
}: Props) {
	const [ipAddress, setIpAddress] = useState<string | null>(null);
	const [ipLoading, setIpLoading] = useState(true);
	const user = getUser();
	const agentName = [user?.first_name, user?.last_name]
		.filter(Boolean)
		.join(' ')
		.trim();
	useEffect(() => {
		if (!open) return;
		const controller = new AbortController();
		let active = true;
		const timeout = window.setTimeout(() => controller.abort(), 8000);
		setIpLoading(true);
		setIpAddress(null);
		// Public IP lookup only. Never send session credentials or agent details.
		fetch('https://api64.ipify.org?format=json', {
			signal: controller.signal,
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			cache: 'no-store'
		})
			.then(async (response) => {
				if (!response.ok) throw new Error('IP lookup unavailable');
				const data: unknown = await response.json();
				if (
					active &&
					data &&
					typeof data === 'object' &&
					'ip' in data &&
					typeof data.ip === 'string' &&
					data.ip.length <= 45 &&
					/^[0-9a-fA-F:.]+$/.test(data.ip)
				) {
					setIpAddress(data.ip);
				}
			})
			.catch(() => {
				/* Display an unavailable state without blocking the order. */
			})
			.finally(() => {
				window.clearTimeout(timeout);
				if (active) setIpLoading(false);
			});
		return () => {
			active = false;
			window.clearTimeout(timeout);
			controller.abort();
		};
	}, [open]);
	const [acknowledged, setAcknowledged] = useState(false);
	const [sectionsRead, setSectionsRead] = useState([
		false,
		false,
		false,
		false
	]);
	const canConfirm = acknowledged && sectionsRead.every(Boolean);
	const sectionAcknowledgment = (index: number, summary: string) => (
		<label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-950 has-[:disabled]:cursor-default dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
			<input
				type="checkbox"
				className="mt-1 size-4 shrink-0 cursor-pointer accent-red-600 disabled:cursor-default"
				checked={sectionsRead[index]}
				disabled={saving}
				onChange={(event) => {
					const checked = event.target.checked;
					setSectionsRead((current) =>
						current.map((value, i) => (i === index ? checked : value))
					);
				}}
			/>
			<span>{summary}</span>
		</label>
	);
	const titleRef = useRef<HTMLHeadingElement>(null);

	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={(next) => !next && !saving && onBack()}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
				<DialogPrimitive.Content
					className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[94vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						onReturnFocus();
					}}
					onEscapeKeyDown={(event) => saving && event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						titleRef.current?.focus();
					}}
				>
					<header className="flex shrink-0 items-start gap-3 border-b px-5 py-5 sm:px-8">
						<div className="hidden rounded-lg bg-primary/10 p-2.5 text-primary sm:block">
							<FileText className="size-5" />
						</div>
						<div className="min-w-0 flex-1 space-y-1.5">
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								Before you place your order
							</p>
							<DialogPrimitive.Title
								ref={titleRef}
								tabIndex={-1}
								className="text-xl font-semibold tracking-tight outline-none"
							>
								Posted Lead Purchase &amp; Replacement Policy
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								Please read and check each section, then confirm the final
								acknowledgment to complete your purchase.
							</DialogPrimitive.Description>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-8 shrink-0"
							aria-label="Back to lead order"
							disabled={saving}
							onClick={onBack}
						>
							<X className="size-4" />
						</Button>
					</header>
					<div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 [scrollbar-gutter:stable]">
						<article className="space-y-7 text-sm leading-7 text-muted-foreground [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_p+p]:mt-3">
							<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
								<p>
									Policy Printer is committed to providing Final Expense leads
									at competitive, cost-efficient pricing. To maintain these
									prices,{' '}
									<strong className="font-semibold">
										all posted lead purchases are final and are not eligible for
										refunds, credits, returns, or replacements.
									</strong>
								</p>
							</div>
							<p>
								By purchasing posted leads from Policy Printer, you acknowledge
								and agree to the following:
							</p>
							<section>
								<h3>No Returns or Replacements</h3>
								<p>
									Policy Printer does not offer returns, refunds, credits, or
									replacements for posted leads, including, but not limited to,
									leads that:
								</p>
								<ul className="my-3 list-disc space-y-1 pl-5 marker:text-primary/60">
									{exclusions.map((item) => (
										<li key={item} className="pl-1">
											{item}
										</li>
									))}
								</ul>
								<p>
									Lead information reflects the information available to Policy
									Printer at the time the lead is delivered. Policy Printer does
									not guarantee that any individual lead will answer, respond,
									qualify for coverage, attend an appointment, purchase
									insurance, or result in a commission or sale.
								</p>
								{sectionAcknowledgment(
									0,
									'I understand that posted leads are not eligible for refunds, credits, returns, or replacements, even if they cannot be contacted or do not result in a sale.'
								)}
							</section>
							<section className="border-t pt-5">
								<h3>Why We Have This Policy</h3>
								<p>
									Our posted leads are priced with a no-return and
									no-replacement model in mind. Rather than increasing lead
									prices to account for replacement requests, administrative
									review, and unsuccessful leads, we aim to provide leads at the
									lowest practical cost and allow agents to work the lead volume
									accordingly.
								</p>
								<p>
									As with any form of lead generation, individual lead quality
									and outcomes will vary. Purchasing leads involves the risk
									that some leads will not result in contact, qualification, or
									a sale.
								</p>
								{sectionAcknowledgment(
									1,
									'I understand that discounted pricing reflects a no-return, no-replacement model and that some leads may not result in contact, qualification, or a sale.'
								)}
							</section>
							<section className="border-t pt-5">
								<h3>Agent Responsibility</h3>
								<p>
									It is the purchasing agent's responsibility to review campaign
									details, geographic targeting, lead specifications, pricing,
									and any other applicable criteria before purchasing.
								</p>
								<p>
									Agents are also responsible for ensuring their use of lead
									information complies with all applicable laws, regulations,
									carrier requirements, licensing requirements, and solicitation
									rules.
								</p>
								{sectionAcknowledgment(
									2,
									'I understand that I am responsible for reviewing all purchase criteria and using lead information in compliance with applicable laws, licensing, carrier requirements, and solicitation rules.'
								)}
							</section>
							<section className="border-t pt-5">
								<h3>Final Sale Acknowledgment</h3>
								<p>
									By completing your purchase, you acknowledge that you
									understand and accept that all posted lead sales are final and
									that Policy Printer does not provide refunds, credits,
									returns, or replacement leads based on lead performance,
									contactability, qualification, or sales outcome.
								</p>
								{sectionAcknowledgment(
									3,
									'I understand that completing my purchase confirms my acceptance of final-sale terms, regardless of lead performance, contactability, qualification, or sales outcome.'
								)}
							</section>
						</article>
						<div className="mt-6 space-y-3 rounded-lg border bg-muted/30 p-4">
							<dl className="grid gap-3 text-sm sm:grid-cols-2">
								<div>
									<dt className="text-muted-foreground">Agent name</dt>
									<dd className="mt-1 font-medium">
										{agentName || 'Name unavailable'}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Your IP address</dt>
									<dd
										aria-live="polite"
										className="mt-1 break-all font-mono text-sm"
									>
										{ipLoading
											? 'Loading…'
											: ipAddress || 'Unable to retrieve IP address'}
									</dd>
								</div>
							</dl>
							<p className="text-xs leading-5 text-muted-foreground">
								Your IP address and agent name will be logged with your policy
								acknowledgment when you place this order.
							</p>
						</div>
						<label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-950 has-[:checked]:border-red-500 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100 has-[:disabled]:cursor-default">
							<input
								type="checkbox"
								className="mt-1 size-4 shrink-0 cursor-pointer accent-red-600 disabled:cursor-default"
								checked={acknowledged}
								disabled={saving}
								onChange={(event) => setAcknowledged(event.target.checked)}
							/>
							<span>
								I understand that posted leads are sold at discounted pricing on
								a final-sale basis. Posted leads are not eligible for refunds,
								credits, returns, or replacements, and individual lead
								contactability, qualification, or sales results are not
								guaranteed.
							</span>
						</label>
					</div>
					<footer className="shrink-0 space-y-3 border-t px-5 py-4 sm:px-8">
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<Button
								type="button"
								variant="outline"
								disabled={saving}
								onClick={onBack}
							>
								Back to order
							</Button>
							<Button
								type="button"
								variant="success"
								disabled={!canConfirm || saving}
								onClick={() => canConfirm && !saving && onConfirm()}
							>
								{saving && <Loader2 className="size-4 animate-spin" />}
								{saving ? 'Placing order…' : 'Confirm and place order'}
							</Button>
						</div>
					</footer>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
