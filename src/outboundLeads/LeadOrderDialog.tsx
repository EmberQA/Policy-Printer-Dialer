/**
 * Create / edit a lead purchase order (ENG-234 Subplan 02).
 *
 * Same radix-inline shell as LicensedStatesDialog: header / scrolling body /
 * sticky footer, so the price line, the state warning and Save stay in view
 * while the 51-state grid scrolls.
 *
 * Price rule, mirrored from the backend: a NEW order takes the org's current
 * price (`summary.new_order_price_cents`); an EXISTING order keeps the price it
 * was placed at (`order.unit_price_cents`) no matter what is edited here.
 */

import {useEffect, useMemo, useState} from 'react';
import {Loader2, X} from 'lucide-react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
	createLeadOrder,
	updateLeadOrder,
	type LeadCoverageType,
	type LeadOrderInput,
	type LeadOrderSummary,
	type LeadPurchaseOrder
} from '@/lib/api';
import {readError} from '@/lib/errors';
import {
	LEAD_COVERAGE_OPTIONS,
	MAX_DAILY_CAP,
	MAX_LEAD_AGE_YEARS,
	MAX_MAX_CAP,
	canonicalStateCode,
	diffStates,
	formatDollars,
	listTimeZones,
	stateLabel,
	validateLeadOrderInputClient
} from './leadOrderForm';

export interface LeadOrderDialogProps {
	open: boolean;
	mode: 'create' | 'edit';
	/** The form's starting values (defaults for create, the saved order for edit). */
	initial: LeadOrderInput;
	/** The order being edited; undefined on create. */
	order?: LeadPurchaseOrder;
	summary: LeadOrderSummary;
	onClose: () => void;
	onSaved: () => void;
}

const parseIntOrNull = (raw: string): number | null => {
	if (raw.trim() === '') return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : Number.NaN;
};

export function LeadOrderDialog({
	open,
	mode,
	initial,
	order,
	summary,
	onClose,
	onSaved
}: LeadOrderDialogProps) {
	const [form, setForm] = useState<LeadOrderInput>(initial);
	const [showTzPicker, setShowTzPicker] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Re-seed on every open so a cancelled edit never leaks into the next one.
	useEffect(() => {
		if (open) {
			setForm(initial);
			setShowTzPicker(false);
			setError(null);
		}
	}, [open, initial]);

	const timeZones = useMemo(
		() => (showTzPicker ? listTimeZones() : []),
		[showTzPicker]
	);

	const patch = (changes: Partial<LeadOrderInput>) =>
		setForm((current) => ({...current, ...changes}));

	const selectedCodes = useMemo(
		() => new Set(form.states.map(canonicalStateCode)),
		[form.states]
	);
	const toggleState = (code: string) =>
		setForm((current) => {
			const canon = canonicalStateCode(code);
			const has = current.states.some((s) => canonicalStateCode(s) === canon);
			return {
				...current,
				states: has
					? current.states.filter((s) => canonicalStateCode(s) !== canon)
					: [...current.states, canon]
			};
		});
	const toggleCoverage = (value: LeadCoverageType) =>
		setForm((current) => ({
			...current,
			coverage_types: current.coverage_types.includes(value)
				? current.coverage_types.filter((c) => c !== value)
				: [...current.coverage_types, value]
		}));

	const licensedDiff = useMemo(
		() => diffStates(form.states, summary.licensed_states),
		[form.states, summary.licensed_states]
	);

	const clientError = validateLeadOrderInputClient(form);

	// Create quotes the org's current price; edit uses the order's own snapshot.
	const priceCents =
		mode === 'edit' && order
			? order.unit_price_cents
			: summary.new_order_price_cents;
	const remainingLeads =
		mode === 'edit' && order
			? Math.max(0, form.max_cap - order.delivered_count)
			: form.max_cap;
	const spendCents =
		priceCents !== null && Number.isFinite(remainingLeads)
			? remainingLeads * priceCents
			: null;

	const save = async () => {
		const problem = validateLeadOrderInputClient(form);
		if (problem) {
			setError(problem);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const res =
				mode === 'edit' && order
					? await updateLeadOrder(order.id, form)
					: await createLeadOrder(form);
			if (res.statusCode !== 'SP100') {
				setError(res.statusMessage || 'Could not save your order');
				return;
			}
			onSaved();
		} catch (err) {
			setError(readError(err, 'Could not save your order'));
		} finally {
			setSaving(false);
		}
	};

	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={(next) => !next && onClose()}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[88vh] w-[94vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
					<div className="flex items-start justify-between gap-3">
						<div className="space-y-1">
							<DialogPrimitive.Title className="text-lg font-semibold">
								{mode === 'edit' ? 'Edit lead order' : 'New lead order'}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								Leads can be delivered and charged while you are offline during
								these working hours. Each lead is billed to your wallet when it
								arrives.
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-8 shrink-0"
								aria-label="Close lead order"
							>
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					<div className="min-h-0 space-y-6 overflow-y-auto pr-1">
						{/* Working hours */}
						<section className="space-y-3">
							<h3 className="text-sm font-semibold">Working hours</h3>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-1.5">
									<Label htmlFor="lead-order-start">Start</Label>
									<Input
										id="lead-order-start"
										type="time"
										value={form.working_hours_start}
										disabled={saving}
										onChange={(e) =>
											patch({working_hours_start: e.target.value})
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="lead-order-end">End</Label>
									<Input
										id="lead-order-end"
										type="time"
										value={form.working_hours_end}
										disabled={saving}
										onChange={(e) => patch({working_hours_end: e.target.value})}
									/>
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2 text-sm">
								<span className="text-muted-foreground">Timezone:</span>
								{showTzPicker ? (
									<select
										className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
										value={form.timezone}
										disabled={saving}
										onChange={(e) => patch({timezone: e.target.value})}
									>
										{!timeZones.includes(form.timezone) && (
											<option value={form.timezone}>{form.timezone}</option>
										)}
										{timeZones.map((tz) => (
											<option key={tz} value={tz}>
												{tz}
											</option>
										))}
									</select>
								) : (
									<>
										<span className="font-medium">{form.timezone}</span>
										<button
											type="button"
											className="text-xs text-primary underline-offset-2 hover:underline"
											onClick={() => setShowTzPicker(true)}
											disabled={saving}
										>
											change
										</button>
									</>
								)}
							</div>
							{form.working_hours_start > form.working_hours_end && (
								<p className="text-xs text-muted-foreground">
									This window crosses midnight — leads arrive from{' '}
									{form.working_hours_start} until {form.working_hours_end} the
									next morning.
								</p>
							)}
						</section>

						{/* Caps */}
						<section className="space-y-3">
							<h3 className="text-sm font-semibold">Caps</h3>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-1.5">
									<Label htmlFor="lead-order-daily">Leads per day</Label>
									<Input
										id="lead-order-daily"
										type="number"
										min={1}
										max={MAX_DAILY_CAP}
										value={form.daily_cap}
										disabled={saving}
										onChange={(e) => patch({daily_cap: Number(e.target.value)})}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="lead-order-max">
										Total leads for this order
									</Label>
									<Input
										id="lead-order-max"
										type="number"
										min={1}
										max={MAX_MAX_CAP}
										value={form.max_cap}
										disabled={saving}
										onChange={(e) => patch({max_cap: Number(e.target.value)})}
									/>
									{mode === 'edit' && order && (
										<p className="text-xs text-muted-foreground">
											{order.delivered_count} delivered so far. Setting the
											total at or below that closes the order.
										</p>
									)}
								</div>
							</div>
						</section>

						{/* States */}
						<section className="space-y-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<h3 className="text-sm font-semibold">States</h3>
								<div className="flex items-center gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={saving}
										onClick={() =>
											patch({states: summary.jurisdictions.map((j) => j.code)})
										}
									>
										Select all
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={saving || summary.licensed_states.length === 0}
										onClick={() =>
											patch({states: [...summary.licensed_states]})
										}
									>
										Licensed only
									</Button>
								</div>
							</div>
							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{summary.jurisdictions.map((jurisdiction) => {
									const checked = selectedCodes.has(jurisdiction.code);
									return (
										<label
											key={jurisdiction.code}
											className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent ${
												checked
													? 'border-primary/40 bg-accent/50 font-medium text-foreground'
													: 'border-input bg-card text-muted-foreground'
											}`}
										>
											<input
												type="checkbox"
												checked={checked}
												disabled={saving}
												onChange={() => toggleState(jurisdiction.code)}
												className="size-4 accent-primary"
											/>
											<span className="min-w-0 truncate">
												{jurisdiction.name}
											</span>
											<span className="ml-auto pl-1 font-mono text-xs text-muted-foreground">
												{jurisdiction.abbr}
											</span>
										</label>
									);
								})}
							</div>
							{licensedDiff.differs && (
								<p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200">
									This selection differs from the states you&apos;re licensed
									in.
									{licensedDiff.selected_not_saved.length > 0 && (
										<>
											{' '}
											Not licensed:{' '}
											{licensedDiff.selected_not_saved
												.map((c) => stateLabel(c, summary.jurisdictions))
												.join(', ')}
											.
										</>
									)}
									{licensedDiff.saved_not_selected.length > 0 && (
										<>
											{' '}
											Licensed but not selected:{' '}
											{licensedDiff.saved_not_selected
												.map((c) => stateLabel(c, summary.jurisdictions))
												.join(', ')}
											.
										</>
									)}{' '}
									You can still save.
								</p>
							)}
						</section>

						{/* Coverage */}
						<section className="space-y-3">
							<h3 className="text-sm font-semibold">Coverage types</h3>
							<div className="flex flex-wrap gap-2">
								{LEAD_COVERAGE_OPTIONS.map((option) => {
									const checked = form.coverage_types.includes(option.value);
									return (
										<label
											key={option.value}
											className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
												checked
													? 'border-primary/40 bg-accent/50 font-medium'
													: 'border-input bg-card text-muted-foreground'
											}`}
										>
											<input
												type="checkbox"
												checked={checked}
												disabled={saving}
												onChange={() => toggleCoverage(option.value)}
												className="size-4 accent-primary"
											/>
											{option.label}
										</label>
									);
								})}
							</div>
						</section>

						{/* Ages */}
						<section className="space-y-3">
							<h3 className="text-sm font-semibold">
								Age range{' '}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</h3>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-1.5">
									<Label htmlFor="lead-order-min-age">Minimum age</Label>
									<Input
										id="lead-order-min-age"
										type="number"
										min={0}
										max={MAX_LEAD_AGE_YEARS}
										value={form.min_age ?? ''}
										disabled={saving}
										onChange={(e) =>
											patch({min_age: parseIntOrNull(e.target.value)})
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="lead-order-max-age">Maximum age</Label>
									<Input
										id="lead-order-max-age"
										type="number"
										min={0}
										max={MAX_LEAD_AGE_YEARS}
										value={form.max_age ?? ''}
										disabled={saving}
										onChange={(e) =>
											patch({max_age: parseIntOrNull(e.target.value)})
										}
									/>
								</div>
							</div>
						</section>
					</div>

					<div className="space-y-3 border-t pt-4">
						<div className="space-y-1 text-sm">
							{priceCents !== null ? (
								<>
									<p>
										<span className="text-muted-foreground">
											{mode === 'edit'
												? 'Your order price:'
												: 'Price per lead:'}
										</span>{' '}
										<span className="font-medium">
											{formatDollars(priceCents)}
										</span>
										{spendCents !== null && (
											<>
												{' · '}
												<span className="text-muted-foreground">
													{mode === 'edit'
														? 'Remaining spend ≈'
														: 'Max spend ≈'}
												</span>{' '}
												<span className="font-medium">
													{formatDollars(spendCents)}
												</span>
												<span className="text-muted-foreground">
													{' '}
													({remainingLeads} × {formatDollars(priceCents)})
												</span>
											</>
										)}
									</p>
									<p className="text-xs text-muted-foreground">
										{mode === 'edit'
											? 'Your order keeps this price. Future campaign price changes apply to new orders only.'
											: 'This price is locked in when you place the order. Future price changes apply to new orders only.'}
									</p>
								</>
							) : (
								<p className="text-xs text-destructive">
									Lead pricing is not configured for your agency yet.
								</p>
							)}
							<p className="text-xs text-muted-foreground">
								Wallet balance: {formatDollars(summary.balance_cents)}
								{priceCents !== null && summary.balance_cents < priceCents && (
									<span className="text-amber-700 dark:text-amber-300">
										{' '}
										— below one lead&apos;s price, so no leads will be delivered
										until you top up.
									</span>
								)}
							</p>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 text-sm">
								{error ? (
									<span className="text-destructive">{error}</span>
								) : clientError ? (
									<span className="text-muted-foreground">{clientError}</span>
								) : (
									<span className="text-muted-foreground">
										{form.states.length} of {summary.jurisdictions.length}{' '}
										states
									</span>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Button
									type="button"
									variant="outline"
									disabled={saving}
									onClick={onClose}
								>
									Cancel
								</Button>
								<Button
									type="button"
									variant="success"
									disabled={
										saving ||
										clientError !== null ||
										(mode === 'create' && !summary.can_create_order)
									}
									onClick={save}
								>
									{saving && <Loader2 className="size-4 animate-spin" />}
									{saving
										? 'Saving…'
										: mode === 'edit'
											? 'Save changes'
											: 'Place order'}
								</Button>
							</div>
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
