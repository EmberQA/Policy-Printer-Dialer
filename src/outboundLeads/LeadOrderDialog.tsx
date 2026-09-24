/**
 * Create / edit a lead purchase order (ENG-234 Subplan 02).
 *
 * Sequential order setup with step validation and a final review.
 *
 * Price rule, mirrored from the backend: a NEW order takes the org's current
 * price (`summary.new_order_price_cents`); an EXISTING order keeps the price it
 * was placed at (`order.unit_price_cents`) no matter what is edited here.
 */

import {useEffect, useMemo, useRef, useState} from 'react';
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
import {LeadPurchasePolicyDialog} from './LeadPurchasePolicyDialog';
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

const ORDER_STEPS = ['Lead volume', 'Targeting', 'Delivery hours', 'Review'];

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
	const [step, setStep] = useState(0);
	const stepHeadingRef = useRef<HTMLHeadingElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const [form, setForm] = useState<LeadOrderInput>(initial);
	const [showTzPicker, setShowTzPicker] = useState(false);
	const [stateSearch, setStateSearch] = useState('');
	const [saving, setSaving] = useState(false);
	const [showPolicy, setShowPolicy] = useState(false);
	const placeOrderRef = useRef<HTMLButtonElement>(null);
	const [error, setError] = useState<string | null>(null);

	// Re-seed on every open so a cancelled edit never leaks into the next one.
	useEffect(() => {
		if (open) {
			setForm(initial);
			setStep(0);
			setShowTzPicker(false);
			setStateSearch('');
			setShowPolicy(false);
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

	const visibleJurisdictions = summary.jurisdictions.filter((jurisdiction) =>
		`${jurisdiction.name} ${jurisdiction.abbr}`
			.toLowerCase()
			.includes(stateSearch.trim().toLowerCase())
	);

	const clientError = validateLeadOrderInputClient(form);
	// Validate only the current step. Later fields must not block earlier steps.
	const stepError =
		step === 3
			? clientError
			: validateLeadOrderInputClient({
					...form,
					...(step !== 0
						? {
								daily_cap: 1,
								max_cap: 1,
								coverage_types: ['final_expense' as const]
							}
						: {}),
					...(step !== 1
						? {states: ['us-tx'], min_age: null, max_age: null}
						: {}),
					...(step !== 2
						? {
								working_hours_start: '09:00',
								working_hours_end: '17:00',
								timezone: 'America/New_York'
							}
						: {})
				});
	const goToStep = (next: number) => {
		setError(null);
		setStep(next);
	};
	useEffect(() => {
		bodyRef.current?.scrollTo({top: 0});
		stepHeadingRef.current?.focus();
	}, [step]);

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
		if (
			saving ||
			(mode === 'create' && (!showPolicy || !summary.can_create_order))
		)
			return;
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
			onOpenChange={(next) => !next && !saving && onClose()}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[92dvh] w-[94vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden rounded-xl border bg-popover p-5 sm:p-6 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
					<div className="flex items-start justify-between gap-3">
						<div className="space-y-1">
							<DialogPrimitive.Title className="text-lg font-semibold">
								{mode === 'edit' ? 'Edit lead order' : 'New lead order'}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground"></DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-8 shrink-0"
								aria-label="Close lead order"
								disabled={saving}
							>
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					<div
						ref={bodyRef}
						className="-mx-1 min-h-0 overflow-y-auto px-1 py-1 [scrollbar-gutter:stable]"
					>
						<ol
							aria-label="Order progress"
							className="mb-6 grid grid-cols-4 gap-2"
						>
							{ORDER_STEPS.map((label, index) => (
								<li
									key={label}
									aria-current={step === index ? 'step' : undefined}
									className="space-y-2"
								>
									<div
										className={`h-1 rounded-full ${index <= step ? 'bg-primary' : 'bg-muted'}`}
									/>
									<p
										className={`text-xs ${index === step ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
									>
										{index + 1}. {label}
									</p>
								</li>
							))}
						</ol>
						<div className="mb-5 space-y-1">
							<h3
								ref={stepHeadingRef}
								tabIndex={-1}
								className="text-xl font-semibold outline-none"
							>
								{
									[
										'How many leads would you like?',
										'Where should your leads come from?',
										'When should leads arrive?',
										'Review your order'
									][step]
								}
							</h3>
							<p className="text-sm text-muted-foreground">
								{
									[
										'Choose your volume and the coverage types you sell.',
										'Select your target states and an optional age range.',
										'Set your delivery window in your local timezone.',
										'Check your selections before continuing to the purchase policy.'
									][step]
								}
							</p>
						</div>
						{step === 0 && (
							<div className="space-y-6">
								{/* Caps */}
								<section className="space-y-3">
									<h3 className="text-lg font-semibold">Lead volume</h3>
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
												onChange={(e) =>
													patch({daily_cap: Number(e.target.value)})
												}
											/>
										</div>
										<div className="space-y-1.5">
											<Label htmlFor="lead-order-max">Total leads</Label>
											<Input
												id="lead-order-max"
												type="number"
												min={1}
												max={MAX_MAX_CAP}
												value={form.max_cap}
												disabled={saving}
												onChange={(e) =>
													patch({max_cap: Number(e.target.value)})
												}
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
								{/* Coverage */}
								<section className="space-y-3">
									<h3 className="text-lg font-semibold">Coverage types</h3>
									<div className="flex flex-wrap gap-2">
										{LEAD_COVERAGE_OPTIONS.map((option) => {
											const checked = form.coverage_types.includes(
												option.value
											);
											return (
												<label
													key={option.value}
													className={`flex cursor-pointer has-[:disabled]:cursor-default items-center gap-2 rounded-md border px-3 py-2 text-sm ${
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
														className="size-4 enabled:cursor-pointer disabled:cursor-default accent-primary"
													/>
													{option.label}
												</label>
											);
										})}
									</div>
								</section>
							</div>
						)}
						{step === 1 && (
							<div className="space-y-5">
								{/* States */}
								<section className="min-w-0 space-y-3">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<h3 className="text-lg font-semibold">
											Target states{' '}
											<span className="ml-1 text-xs font-normal text-muted-foreground">
												{form.states.length} selected
											</span>
										</h3>
										<div className="flex items-center gap-2">
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={saving}
												onClick={() =>
													patch({
														states: summary.jurisdictions.map((j) => j.code)
													})
												}
											>
												Select all
											</Button>
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={
													saving || summary.licensed_states.length === 0
												}
												onClick={() =>
													patch({states: [...summary.licensed_states]})
												}
											>
												Licensed only
											</Button>
										</div>
									</div>
									<Input
										type="search"
										aria-label="Search states"
										placeholder="Search states…"
										value={stateSearch}
										disabled={saving}
										onChange={(event) => setStateSearch(event.target.value)}
									/>
									<div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto overscroll-contain rounded-md p-1 [scrollbar-gutter:stable] sm:grid-cols-3">
										{visibleJurisdictions.length === 0 && (
											<p className="col-span-2 py-6 text-center text-sm text-muted-foreground">
												No states match your search.
											</p>
										)}
										{visibleJurisdictions.map((jurisdiction) => {
											const checked = selectedCodes.has(jurisdiction.code);
											return (
												<label
													key={jurisdiction.code}
													className={`flex cursor-pointer has-[:disabled]:cursor-default items-center gap-2 min-w-0 rounded-md border px-2 py-2 text-sm transition-colors hover:bg-accent ${
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
														className="size-4 enabled:cursor-pointer disabled:cursor-default accent-primary"
													/>
													<span className="min-w-0 break-words">
														{jurisdiction.name}
													</span>
												</label>
											);
										})}
									</div>
									{licensedDiff.differs && (
										<p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200">
											This selection differs from the states you&apos;re
											licensed in.
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
								{/* Ages */}
								<section className="space-y-3">
									<h3 className="text-lg font-semibold">Age range</h3>
									<div id="lead-order-ages">
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
										<p className="text-xs text-muted-foreground">
											Leave either field blank for no limit.
										</p>
									</div>
								</section>
							</div>
						)}
						{step === 2 && (
							<div className="space-y-5">
								{/* Working hours */}
								<section className="space-y-3">
									<h3 className="text-lg font-semibold">Delivery hours</h3>
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
												onChange={(e) =>
													patch({working_hours_end: e.target.value})
												}
											/>
										</div>
									</div>
									<div className="flex flex-wrap items-center gap-2 text-sm">
										<span className="text-muted-foreground">Timezone:</span>
										{showTzPicker ? (
											<select
												aria-label="Timezone"
												className="max-w-full enabled:cursor-pointer disabled:cursor-not-allowed h-9 rounded-md border border-input bg-transparent px-2 text-sm"
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
													className="enabled:cursor-pointer text-xs text-primary underline-offset-2 hover:underline"
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
											This window crosses midnight. Leads arrive from{' '}
											{form.working_hours_start} until {form.working_hours_end}{' '}
											the next morning.
										</p>
									)}
								</section>
								<p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
									Leads can arrive and be charged during these hours even while
									you are offline. Each lead is billed to your wallet on
									arrival. Leads already bid for may arrive after you pause,
									cancel, or reach a cap, and may take your wallet below zero.
								</p>
							</div>
						)}
						{step === 3 && (
							<div className="space-y-4">
								{[
									{
										title: 'Lead volume',
										target: 0,
										detail: `${form.daily_cap} leads per day · ${form.max_cap} total leads`,
										extra: LEAD_COVERAGE_OPTIONS.filter((option) =>
											form.coverage_types.includes(option.value)
										)
											.map((option) => option.label)
											.join(', ')
									},
									{
										title: 'Targeting',
										target: 1,
										detail: form.states
											.map((code) => stateLabel(code, summary.jurisdictions))
											.join(', '),
										extra:
											form.min_age === null && form.max_age === null
												? 'All ages'
												: `Ages ${form.min_age ?? 'Any'} to ${form.max_age ?? 'Any'}`
									},
									{
										title: 'Delivery hours',
										target: 2,
										detail: `${form.working_hours_start} to ${form.working_hours_end}${form.working_hours_start > form.working_hours_end ? ' (next day)' : ''}`,
										extra: form.timezone
									}
								].map((item) => (
									<section
										key={item.title}
										className="flex items-start justify-between gap-4 rounded-lg border p-4"
									>
										<div className="min-w-0 space-y-1">
											<h4 className="text-lg font-semibold">{item.title}</h4>
											<p className="text-sm leading-6">{item.detail}</p>
											<p className="text-xs text-muted-foreground">
												{item.extra}
											</p>
										</div>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={saving}
											aria-label={`Edit ${item.title.toLowerCase()}`}
											onClick={() => goToStep(item.target)}
										>
											Edit
										</Button>
									</section>
								))}
								<p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
									Leads can arrive and be charged during these hours even while
									you are offline. Each lead is billed to your wallet on
									arrival. Leads already bid for may arrive after you pause,
									cancel, or reach a cap, and may take your wallet below zero.
								</p>
							</div>
						)}
					</div>

					<div className="space-y-3 border-t pt-4">
						{step === 3 ? (
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
										{/* <p className="text-xs text-muted-foreground">
											{mode === 'edit'
												? 'Your order keeps this price. Future campaign price changes apply to new orders only.'
												: 'This price is locked in when you place the order. Future price changes apply to new orders only.'}
										</p> */}
									</>
								) : (
									<p className="text-xs text-destructive">
										Lead pricing is not configured for your agency yet.
									</p>
								)}
								<p className="text-xs text-muted-foreground">
									Wallet balance: {formatDollars(summary.balance_cents)}
									{priceCents !== null &&
										summary.balance_cents < priceCents && (
											<span className="text-amber-700 dark:text-amber-300">
												{' '}
												is below one lead&apos;s price. Top up to resume new
												bids; leads already bid for can still be delivered and
												charged.
											</span>
										)}
								</p>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								{priceCents !== null ? (
									<>
										<span className="font-semibold text-foreground">
											{formatDollars(priceCents)}
										</span>{' '}
										per lead
										{spendCents !== null && (
											<>
												{' '}
												· Estimated {mode === 'edit' ? 'remaining' : 'max'}{' '}
												spend{' '}
												<span className="font-semibold text-foreground">
													{formatDollars(spendCents)}
												</span>
											</>
										)}
									</>
								) : (
									'Lead pricing is not configured for your agency yet.'
								)}
							</p>
						)}
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 text-sm">
								{error ? (
									<span className="text-destructive">{error}</span>
								) : stepError ? (
									<span className="text-muted-foreground">{stepError}</span>
								) : (
									<span className="text-muted-foreground">
										{step < 3
											? `Step ${step + 1} of 4`
											: mode === 'create'
												? 'Review the purchase policy next.'
												: 'Changes apply to future deliveries.'}
									</span>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Button
									type="button"
									variant="outline"
									disabled={saving}
									onClick={() => (step > 0 ? goToStep(step - 1) : onClose())}
								>
									{step > 0 ? 'Back' : 'Cancel'}
								</Button>
								<Button
									type="button"
									variant={step === 3 ? 'success' : 'default'}
									ref={placeOrderRef}
									disabled={
										saving ||
										stepError !== null ||
										(step === 3 &&
											mode === 'create' &&
											!summary.can_create_order)
									}
									onClick={() => {
										if (step < 3) {
											goToStep(step + 1);
											return;
										}
										if (mode === 'edit') void save();
										else {
											setError(null);
											setShowPolicy(true);
										}
									}}
								>
									{saving && <Loader2 className="size-4 animate-spin" />}
									{saving
										? 'Saving…'
										: step < 3
											? 'Next'
											: mode === 'edit'
												? 'Save changes'
												: 'Place order'}
								</Button>
							</div>
						</div>
					</div>
					{showPolicy && (
						<LeadPurchasePolicyDialog
							open={open}
							saving={saving}
							error={error}
							onBack={() => {
								setShowPolicy(false);
								setError(null);
							}}
							onConfirm={() => void save()}
							onReturnFocus={() => placeOrderRef.current?.focus()}
						/>
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
