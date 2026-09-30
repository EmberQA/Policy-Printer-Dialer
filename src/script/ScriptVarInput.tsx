/**
 * Inline input for a script variable (ENG-278), rendered by the var's input
 * kind. `onChange` updates the script session as the agent types (so Next
 * un-blocks immediately); `onCommit` fires when the value is final — blur,
 * Enter, or a pick — and is what pushes the value OUT to the bound lead form.
 */

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import type {ScriptVarDef, ScriptVarValue} from './types';

export function ScriptVarInput({
	def,
	value,
	onChange,
	onCommit,
	onSubmit,
	autoFocus
}: {
	def: ScriptVarDef;
	value: ScriptVarValue | undefined;
	onChange: (value: ScriptVarValue) => void;
	onCommit: (value: ScriptVarValue) => void;
	/** Enter in a single-line input: commit, then let the step move focus or advance. */
	onSubmit?: (input: HTMLInputElement) => void;
	autoFocus?: boolean;
}) {
	const input = def.input ?? {kind: 'text' as const};
	const str = value === undefined ? '' : String(value);
	const [otherOpen, setOtherOpen] = useState(false);

	if (input.kind === 'choice' || input.kind === 'boolean') {
		const options =
			input.kind === 'choice'
				? (input.config?.options ?? [])
				: [
						{value: 'true', label: input.config?.true_label ?? 'Yes'},
						{value: 'false', label: input.config?.false_label ?? 'No'}
					];
		// "Other" + a free-text answer when the script's choice sets allow_other.
		const withOther = input.kind === 'choice' && !!input.config?.allow_other;
		const isListed = options.some((o) => o.value === str);
		const otherActive = withOther && (otherOpen || (str !== '' && !isListed));
		return (
			<div className="space-y-2" role="group" aria-label={def.label}>
				<div className="flex flex-wrap gap-2">
					{options.map((o) => {
						const selected = str === o.value;
						return (
							<Button
								data-script-answer
								key={o.value}
								type="button"
								size="sm"
								aria-pressed={selected}
								variant={selected ? 'default' : 'outline'}
								onClick={() => {
									const v: ScriptVarValue =
										input.kind === 'boolean' ? o.value === 'true' : o.value;
									setOtherOpen(false);
									onChange(v);
									onCommit(v);
								}}
							>
								{o.label}
							</Button>
						);
					})}
					{withOther && (
						<Button
							data-script-answer
							type="button"
							size="sm"
							variant={otherActive ? 'default' : 'outline'}
							onClick={() => {
								setOtherOpen(true);
								// Picking Other clears a listed answer; the text box holds the new one.
								if (isListed) {
									onChange('');
									onCommit('');
								}
							}}
						>
							Other
						</Button>
					)}
				</div>
				{otherActive && (
					<Input
						aria-label={def.label}
						value={isListed ? '' : str}
						placeholder="Their answer…"
						autoFocus={otherOpen}
						onChange={(e) => onChange(e.target.value)}
						onBlur={(e) => onCommit(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								onCommit(e.currentTarget.value);
								onSubmit?.(e.currentTarget);
							}
						}}
					/>
				)}
			</div>
		);
	}

	if (input.kind === 'text' && input.config?.multiline) {
		return (
			<Textarea
				aria-label={def.label}
				value={str}
				rows={3}
				autoFocus={autoFocus}
				onChange={(e) => onChange(e.target.value)}
				onBlur={(e) => onCommit(e.target.value)}
			/>
		);
	}

	const type =
		input.kind === 'phone'
			? 'tel'
			: input.kind === 'email'
				? 'email'
				: input.kind === 'date'
					? 'date'
					: 'text';
	return (
		<div className="relative">
			{input.kind === 'currency' && (
				<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
					$
				</span>
			)}
			<Input
				type={type}
				inputMode={
					input.kind === 'number' || input.kind === 'currency'
						? 'decimal'
						: undefined
				}
				aria-label={def.label}
				value={str}
				autoFocus={autoFocus}
				placeholder={def.label}
				className={cn(input.kind === 'currency' && 'pl-7')}
				onChange={(e) => onChange(e.target.value)}
				onBlur={(e) => onCommit(e.target.value)}
				onKeyDown={(e) => {
					if (e.key !== 'Enter') return;
					e.preventDefault();
					onCommit(e.currentTarget.value);
					onSubmit?.(e.currentTarget);
				}}
			/>
		</div>
	);
}
