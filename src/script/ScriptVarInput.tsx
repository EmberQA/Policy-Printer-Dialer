/**
 * Inline input for a script variable (ENG-278), rendered by the var's input
 * kind. `onChange` updates the script session as the agent types (so Next
 * un-blocks immediately); `onCommit` fires when the value is final — blur,
 * Enter, or a pick — and is what pushes the value OUT to the bound lead form.
 */

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
	/** Enter in a single-line input: commit, then advance. */
	onSubmit?: () => void;
	autoFocus?: boolean;
}) {
	const input = def.input ?? {kind: 'text' as const};
	const str = value === undefined ? '' : String(value);

	if (input.kind === 'choice' || input.kind === 'boolean') {
		const options =
			input.kind === 'choice'
				? (input.config?.options ?? [])
				: [
						{value: 'true', label: input.config?.true_label ?? 'Yes'},
						{value: 'false', label: input.config?.false_label ?? 'No'}
					];
		return (
			<div className="flex flex-wrap gap-2">
				{options.map((o) => {
					const selected = str === o.value;
					return (
						<Button
							key={o.value}
							type="button"
							size="sm"
							variant={selected ? 'default' : 'outline'}
							onClick={() => {
								const v: ScriptVarValue =
									input.kind === 'boolean' ? o.value === 'true' : o.value;
								onChange(v);
								onCommit(v);
							}}
						>
							{o.label}
						</Button>
					);
				})}
			</div>
		);
	}

	if (input.kind === 'text' && input.config?.multiline) {
		return (
			<Textarea
				value={str}
				rows={3}
				autoFocus={autoFocus}
				onChange={(e) => onChange(e.target.value)}
				onBlur={(e) => onCommit(e.target.value)}
			/>
		);
	}

	const type =
		input.kind === 'phone' ? 'tel' : input.kind === 'email' ? 'email' : 'text';
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
					onSubmit?.();
				}}
			/>
		</div>
	);
}
