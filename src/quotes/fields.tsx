/**
 * Shared building blocks for the quote page (ENG-286): panels, stacked-label
 * fields, the segmented control, and the client profile form used by both the
 * Quoter and Quote Compare workspaces.
 */

import type {ReactNode} from 'react';
import {Input} from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select';
import {US_JURISDICTION_NAMES} from '@/lib/phone';
import {cn} from '@/lib/utils';
import {
	ITK_PAYMENT_TYPES,
	TOBACCO_OPTIONS,
	type ItkPaymentType,
	type QuoteClientInputs
} from './types';

export const STATE_OPTIONS = Object.entries(US_JURISDICTION_NAMES)
	.map(([code, name]) => ({code, name}))
	.sort((a, b) => a.name.localeCompare(b.name));

export const toNumberOrNull = (raw: string): number | null => {
	const n = Number(raw.replace(/[$,\s]/g, ''));
	return raw.trim() && Number.isFinite(n) ? n : null;
};

export const money = (raw: string | number | null | undefined): string => {
	if (raw === null || raw === undefined || raw === '') return '—';
	const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
	return Number.isFinite(n)
		? n.toLocaleString('en-US', {style: 'currency', currency: 'USD'})
		: String(raw);
};

/** Whole-dollar face amounts read better ("$10,000" not "$10,000.00"). */
export const wholeMoney = (raw: string | number | null | undefined): string => {
	const s = money(raw);
	return s.endsWith('.00') ? s.slice(0, -3) : s;
};

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Panel({
	title,
	description,
	action,
	children,
	className,
	bodyClassName
}: {
	title?: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
}) {
	return (
		<section className={cn('rounded-xl border bg-card shadow-xs', className)}>
			{(title || action) && (
				<header className="flex items-start justify-between gap-3 border-b px-4 py-2.5">
					<div className="min-w-0">
						{title && <h3 className="text-sm font-semibold">{title}</h3>}
						{description && (
							<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
						)}
					</div>
					{action}
				</header>
			)}
			<div className={cn('p-4', bodyClassName)}>{children}</div>
		</section>
	);
}

export function Field({
	label,
	hint,
	children,
	className
}: {
	label: string;
	hint?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn('space-y-1', className)}>
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-xs font-medium text-muted-foreground">{label}</span>
				{hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
			</div>
			{children}
		</div>
	);
}

export function EmptyState({
	icon,
	title,
	children
}: {
	icon: ReactNode;
	title: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center">
			<div className="mb-3 flex size-11 items-center justify-center rounded-full bg-secondary text-primary">
				{icon}
			</div>
			<p className="text-sm font-semibold">{title}</p>
			{children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export function NumberInput({
	value,
	onChange,
	placeholder,
	className,
	prefix,
	suffix
}: {
	value: number | null;
	onChange: (v: number | null) => void;
	placeholder?: string;
	className?: string;
	prefix?: string;
	suffix?: string;
}) {
	return (
		<div className={cn('relative', className)}>
			{prefix && (
				<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
					{prefix}
				</span>
			)}
			<Input
				inputMode="decimal"
				value={value ?? ''}
				placeholder={placeholder}
				onChange={(e) => onChange(toNumberOrNull(e.target.value))}
				className={cn('bg-card tabular-nums', prefix && 'pl-6', suffix && 'pr-9')}
			/>
			{suffix && (
				<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
					{suffix}
				</span>
			)}
		</div>
	);
}

export function SimpleSelect({
	value,
	onChange,
	options,
	placeholder,
	className,
	disabled
}: {
	value: string | null;
	onChange: (v: string) => void;
	options: readonly {value: string; label: string}[] | readonly string[];
	placeholder?: string;
	className?: string;
	disabled?: boolean;
}) {
	const opts = options.map((o) => (typeof o === 'string' ? {value: o, label: o} : o));
	return (
		<Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger className={cn('w-full bg-card', className)}>
				<SelectValue placeholder={placeholder ?? 'Select…'} />
			</SelectTrigger>
			<SelectContent>
				{opts.map((o) => (
					<SelectItem key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Muted track with a raised white thumb — the dialer/EmberQA toggle look. */
export function Segmented<T extends string>({
	value,
	options,
	onChange,
	size = 'default',
	className
}: {
	value: T | null;
	options: readonly {value: T; label: ReactNode}[];
	onChange: (v: T) => void;
	size?: 'sm' | 'default';
	className?: string;
}) {
	return (
		<div className={cn('inline-flex rounded-lg bg-muted p-0.5', className)}>
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					onClick={() => onChange(o.value)}
					className={cn(
						'flex-1 cursor-pointer rounded-md font-medium whitespace-nowrap transition-all',
						size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
						value === o.value
							? 'bg-card text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Client profile                                                              */
/* -------------------------------------------------------------------------- */

/** Sex, state, birthday-or-age, height/weight, nicotine, payment — stacked. */
export function ClientFields({
	client,
	onChange,
	showBuild = true
}: {
	client: QuoteClientInputs;
	onChange: (patch: Partial<QuoteClientInputs>) => void;
	showBuild?: boolean;
}) {
	const hasDob = !!(client.dobMonth && client.dobDay && client.dobYear);
	return (
		<div className="grid grid-cols-2 gap-x-3 gap-y-3">
			<Field label="Sex">
				<Segmented
					className="w-full"
					value={client.sex}
					options={[
						{value: 'Male', label: 'Male'},
						{value: 'Female', label: 'Female'}
					]}
					onChange={(sex) => onChange({sex})}
				/>
			</Field>
			<Field label="State">
				<SimpleSelect
					value={client.state}
					onChange={(state) => onChange({state})}
					options={STATE_OPTIONS.map((s) => ({value: s.code, label: s.name}))}
					placeholder="Select"
				/>
			</Field>
			<Field label="Date of birth" className="col-span-2">
				<div className="grid grid-cols-[1fr_1fr_1.4fr_auto_1fr] items-center gap-2">
					<NumberInput
						placeholder="MM"
						value={client.dobMonth}
						onChange={(dobMonth) => onChange({dobMonth})}
					/>
					<NumberInput
						placeholder="DD"
						value={client.dobDay}
						onChange={(dobDay) => onChange({dobDay})}
					/>
					<NumberInput
						placeholder="YYYY"
						value={client.dobYear}
						onChange={(dobYear) => onChange({dobYear})}
					/>
					<span className="px-0.5 text-xs text-muted-foreground">or</span>
					<NumberInput
						placeholder="Age"
						value={client.age}
						onChange={(age) => onChange({age})}
					/>
				</div>
				{!hasDob && client.age !== null && (
					<p className="text-xs text-amber-700">
						Underwriting is less accurate without the exact date of birth.
					</p>
				)}
			</Field>
			{showBuild && (
				<Field label="Height & weight" hint="Optional" className="col-span-2">
					<div className="grid grid-cols-3 gap-2">
						<NumberInput
							suffix="ft"
							value={client.heightFeet}
							onChange={(heightFeet) => onChange({heightFeet})}
						/>
						<NumberInput
							suffix="in"
							value={client.heightInches}
							onChange={(heightInches) => onChange({heightInches})}
						/>
						<NumberInput
							suffix="lbs"
							value={client.weight}
							onChange={(weight) => onChange({weight})}
						/>
					</div>
				</Field>
			)}
			<Field label="Nicotine use">
				<SimpleSelect
					value={client.tobacco}
					onChange={(tobacco) => onChange({tobacco})}
					options={TOBACCO_OPTIONS}
				/>
			</Field>
			<Field label="Payment type">
				<SimpleSelect
					value={client.paymentType}
					onChange={(paymentType) => onChange({paymentType: paymentType as ItkPaymentType})}
					options={ITK_PAYMENT_TYPES}
				/>
			</Field>
		</div>
	);
}

/** True once the inputs ITK requires are present. */
export const isQuotable = (c: QuoteClientInputs): boolean =>
	!!c.sex && !!c.state && (!!(c.dobMonth && c.dobDay && c.dobYear) || !!c.age);
