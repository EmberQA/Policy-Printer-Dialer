/**
 * FormRenderer — renders a lead form from its schema (Subplan 04).
 *
 * The schema is an ordered array of FormField objects served by the backend
 * (leadForm/get). One control per FieldType. Labels and help text are rendered as
 * TEXT (never HTML) — the backend stores schema, not markup. This component is
 * fully controlled: it owns no field state, only emits onChange so the parent
 * (LeadForm) holds the form_data and drives save.
 *
 * Client-side required/format hints are for UX only — the backend is the source
 * of truth and re-validates everything on save.
 */

import type {FormField} from '@/lib/api';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';

export type LeadFormData = Record<string, unknown>;

export function FormRenderer({
	schema,
	value,
	onChange,
	disabled,
	excludeKeys = []
}: {
	schema: FormField[];
	value: LeadFormData;
	onChange: (key: string, fieldValue: unknown) => void;
	disabled?: boolean;
	/** Fields rendered elsewhere while keeping the same parent form state. */
	excludeKeys?: string[];
}) {
	const activeFields = [...schema].filter((f) => f.active !== false);
	const fields = activeFields
		.filter((f) => !excludeKeys.includes(f.key))
		.sort((a, b) => a.sort_order - b.sort_order);

	if (fields.length === 0) {
		if (activeFields.length > 0) return null;
		return (
			<p className="text-sm text-muted-foreground">
				This campaign’s form has no fields yet.
			</p>
		);
	}

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{fields.map((field) => (
				<Field
					key={field.key}
					field={field}
					value={value[field.key]}
					onChange={(v) => onChange(field.key, v)}
					disabled={disabled}
				/>
			))}
		</div>
	);
}

function Field({
	field,
	value,
	onChange,
	disabled
}: {
	field: FormField;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled?: boolean;
}) {
	const id = `lf_${field.key}`;
	return (
		<div
			className={cn(
				'space-y-2',
				(field.type === 'textarea' || field.type === 'checkbox') &&
					'sm:col-span-2'
			)}
		>
			{field.type !== 'boolean' && (
				<Label className="text-sm text-foreground" htmlFor={id}>
					{field.label}
					{field.required && <span className="text-destructive"> *</span>}
				</Label>
			)}
			<Control field={field} id={id} value={value} onChange={onChange} disabled={disabled} />
			{field.help && (
				<p className="text-xs text-muted-foreground">{field.help}</p>
			)}
		</div>
	);
}

function Control({
	field,
	id,
	value,
	onChange,
	disabled
}: {
	field: FormField;
	id: string;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled?: boolean;
}) {
	const str = typeof value === 'string' ? value : '';

	switch (field.type) {
		case 'textarea':
			return (
				<Textarea
					id={id}
					value={str}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
					rows={4}
				/>
			);

		case 'select':
			return (
				<Select
					value={str || '__empty'}
					disabled={disabled}
					onValueChange={(next) => onChange(next === '__empty' ? '' : next)}
				>
					<SelectTrigger id={id} className="w-full">
						<SelectValue placeholder="Select…" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__empty">Select…</SelectItem>
						{(field.options ?? []).map((o) => (
							<SelectItem key={o.value} value={o.value}>
								{o.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);

		case 'radio':
			return (
				<div className="flex flex-wrap gap-2 pt-1">
					{(field.options ?? []).map((o) => (
						<label
							key={o.value}
							className={cn(
								'inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
								str === o.value
									? 'border-primary bg-primary/5 text-foreground'
									: 'border-input bg-card text-muted-foreground hover:bg-accent'
							)}
						>
							<input
								type="radio"
								name={id}
								checked={str === o.value}
								disabled={disabled}
								onChange={() => onChange(o.value)}
								className="size-3.5 accent-primary"
							/>
							{o.label}
						</label>
					))}
				</div>
			);

		case 'checkbox': {
			const arr = Array.isArray(value) ? (value as string[]) : [];
			const toggle = (optValue: string) => {
				const next = arr.includes(optValue)
					? arr.filter((v) => v !== optValue)
					: [...arr, optValue];
				onChange(next);
			};
			return (
				<div className="grid gap-2 pt-1 sm:grid-cols-2">
					{(field.options ?? []).map((o) => (
						<label
							key={o.value}
							className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
						>
							<input
								type="checkbox"
								checked={arr.includes(o.value)}
								disabled={disabled}
								onChange={() => toggle(o.value)}
								className="size-4 accent-primary"
							/>
							{o.label}
						</label>
					))}
				</div>
			);
		}

		case 'boolean':
			return (
				<label className="flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm">
					<span>
						{field.label}
						{field.required && <span className="text-destructive"> *</span>}
					</span>
					<Switch
						id={id}
						checked={value === true}
						disabled={disabled}
						onCheckedChange={onChange}
					/>
				</label>
			);

		case 'number':
			return (
				<Input
					id={id}
					type="number"
					value={typeof value === 'number' ? value : str}
					disabled={disabled}
					onChange={(e) =>
						onChange(e.target.value === '' ? '' : Number(e.target.value))
					}
				/>
			);

		case 'date':
			return (
				<Input
					id={id}
					type="date"
					value={str}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
				/>
			);

		case 'email':
			return (
				<Input
					id={id}
					type="email"
					value={str}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
				/>
			);

		case 'phone':
			return (
				<Input
					id={id}
					type="tel"
					value={str}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
				/>
			);

		case 'text':
		default:
			return (
				<Input
					id={id}
					type="text"
					value={str}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
				/>
			);
	}
}
