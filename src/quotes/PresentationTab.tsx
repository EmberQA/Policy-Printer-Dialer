/**
 * Presentation (ENG-286): the up-to-three quotes the agent pinned from the
 * Quoter, laid out as option cards to read to the client — the "here are your
 * three options" step of a final-expense call. Labels are editable and saved.
 */

import {ExternalLink, Pin, X} from 'lucide-react';
import {Button, buttonVariants} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {EmptyState, money, wholeMoney} from './fields';
import {CarrierLogo, hasEapp, quoteKey} from './QuoteResults';
import {MAX_PINNED_QUOTES, type QuoteSessionState} from './types';

const DEFAULT_LABELS = ['Option 1', 'Option 2', 'Option 3'];

export function PresentationTab({
	state,
	update,
	clientName
}: {
	state: QuoteSessionState;
	update: (fn: (s: QuoteSessionState) => QuoteSessionState) => void;
	clientName: string | null;
}) {
	const pinned = state.presentation;
	return (
		<div className="space-y-5">
			<div>
				<h2 className="text-lg font-semibold tracking-tight">
					{clientName ? `Options for ${clientName}` : 'Coverage options'}
				</h2>
				<p className="text-sm text-muted-foreground">
					{pinned.length}/{MAX_PINNED_QUOTES} pinned · rename each option to match how you present it.
				</p>
			</div>
			{pinned.length === 0 ? (
				<EmptyState icon={<Pin className="size-5" />} title="Nothing pinned yet">
					Pin up to three plans from the Quoter to walk the client through them side by side.
				</EmptyState>
			) : (
				<div className="grid gap-4 md:grid-cols-3">
					{pinned.map((p, i) => {
						const featured = pinned.length === 3 && i === 1;
						return (
							<div
								key={quoteKey(p)}
								className={cn(
									'relative flex flex-col rounded-2xl border bg-card p-6 shadow-xs',
									featured && 'border-primary ring-1 ring-primary'
								)}
							>
								<div className="flex items-center justify-between gap-2">
									<input
										value={p.label}
										placeholder={DEFAULT_LABELS[i]}
										onChange={(e) =>
											update((s) => ({
												...s,
												presentation: s.presentation.map((x, j) =>
													j === i ? {...x, label: e.target.value.slice(0, 60)} : x
												)
											}))
										}
										className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-sm font-semibold outline-none placeholder:text-foreground hover:bg-muted focus:bg-muted"
									/>
									<Button
										size="icon"
										variant="ghost"
										className="size-8 text-muted-foreground"
										aria-label="Remove"
										onClick={() =>
											update((s) => ({
												...s,
												presentation: s.presentation.filter((_, j) => j !== i)
											}))
										}
									>
										<X className="size-4" />
									</Button>
								</div>
								<div className="mt-4 flex items-center gap-3">
									<CarrierLogo src={p.logo} name={p.company} className="h-10 w-24" />
									<div className="min-w-0 text-xs text-muted-foreground">
										<div className="truncate font-medium text-foreground">{p.company}</div>
										<div className="truncate">{p.plan_name || p.tier_name}</div>
									</div>
								</div>
								<div className="mt-6">
									<div className="flex items-baseline gap-1">
										<span className="text-4xl font-semibold tracking-tight tabular-nums">
											{money(p.monthly)}
										</span>
										<span className="text-sm text-muted-foreground">/mo</span>
									</div>
									<div className="text-xs text-muted-foreground tabular-nums">
										{money(p.yearly)} per year
									</div>
								</div>
								<dl className="mt-6 space-y-2.5 border-t pt-4 text-sm">
									<div className="flex justify-between">
										<dt className="text-muted-foreground">Coverage</dt>
										<dd className="font-semibold tabular-nums">{wholeMoney(p.face_amount)}</dd>
									</div>
									<div className="flex justify-between">
										<dt className="text-muted-foreground">With accidental death</dt>
										<dd className="font-medium tabular-nums">{p.addnd ? `${money(p.addnd)}/mo` : '—'}</dd>
									</div>
								</dl>
								<div className="mt-auto pt-6">
									{hasEapp(p) && (
										<a
											href={p.eapp_link}
											target="_blank"
											rel="noopener noreferrer"
											className={buttonVariants({
												variant: featured ? 'default' : 'outline',
												className: 'w-full'
											})}
										>
											Start E-App <ExternalLink className="size-3.5" />
										</a>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
