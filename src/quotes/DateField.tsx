/**
 * Date entry for the underwriting questionnaire (ENG-286) and the lead form's
 * `date` fields (`compact` matches the form's h-9 inputs).
 *
 * One masked text input — type digits, the slashes insert themselves
 * (0 3 1 5 2 0 1 9 → 03/15/2019). The caret stays where you put it: typing or
 * deleting in the middle edits that spot, Backspace/Delete beside a slash
 * remove the digit next to it, and typing into a full date overwrites, and a pasted date in any format parse.ts understands
 * ("Jan 2 2021", "1/2/21", "2021-01-02") is reformatted. Beside it, a
 * calendar button opens a month grid with month + year dropdowns, so a date
 * years back is two clicks away.
 *
 * Replaces the browser's <input type="date">, whose calendar is drawn by the
 * browser and can't be styled. Emits ISO "YYYY-MM-DD" once the date is
 * complete and real, else "".
 */

import {useEffect, useMemo, useRef, useState} from 'react';
import {CalendarDays, ChevronLeft, ChevronRight} from 'lucide-react';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {cn} from '@/lib/utils';
import {parseDob} from './parse';

const pad = (n: number) => String(n).padStart(2, '0');

/** "03152019" → "03/15/2019" (partial input formats as far as it goes). */
const mask = (digits: string): string => {
	const d = digits.slice(0, 8);
	if (d.length <= 2) return d;
	if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
	return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

/** Caret position in masked text just after its `n`-th digit — past a slash
 *  that directly follows, so typing carries on into the next part. */
const caretAfterDigits = (masked: string, n: number): number => {
	if (n <= 0) return 0;
	let seen = 0;
	for (let i = 0; i < masked.length; i++) {
		if (!/\d/.test(masked[i])) continue;
		if (++seen === n) return masked[i + 1] === '/' ? i + 2 : i + 1;
	}
	return masked.length;
};

const digitsBefore = (text: string, caret: number) => text.slice(0, caret).replace(/\D/g, '').length;

const isoToText = (iso: string): string => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
};

const textToIso = (text: string): string => {
	if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return '';
	const p = parseDob(text);
	return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : '';
};

export function DateField({
	value,
	onChange,
	disabled,
	autoFocus,
	label,
	id,
	compact = false
}: {
	value: string;
	onChange: (iso: string) => void;
	disabled?: boolean;
	autoFocus?: boolean;
	label?: string;
	id?: string;
	compact?: boolean;
}) {
	const [text, setText] = useState(() => isoToText(value));
	const [open, setOpen] = useState(false);

	// Follow external resets (a new question) without clobbering typing.
	useEffect(() => {
		if (value !== textToIso(text)) setText(isoToText(value));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	const inputRef = useRef<HTMLInputElement>(null);

	const set = (next: string) => {
		setText(next);
		onChange(textToIso(next));
	};

	/**
	 * Re-mask `digits` and put the caret after `caretDigits` of them. The DOM is
	 * written directly as well: when the masked text comes out identical (e.g. a
	 * deleted slash the mask re-adds) React skips the render, and the box would
	 * keep showing the raw edit out of step with state.
	 */
	const commit = (digits: string, caretDigits: number) => {
		const next = mask(digits);
		const el = inputRef.current;
		if (el) {
			el.value = next;
			const at = caretAfterDigits(next, caretDigits);
			el.setSelectionRange(at, at);
		}
		set(next);
	};

	const onType = (el: HTMLInputElement) => {
		const raw = el.value;
		// A pasted / autofilled date in another format: parse it whole.
		if (/[a-z]/i.test(raw) || /^\d{4}-/.test(raw)) {
			const p = parseDob(raw);
			if (p) return commit(`${pad(p.month)}${pad(p.day)}${p.year}`, 8);
		}
		const before = digitsBefore(raw, el.selectionStart ?? raw.length);
		let digits = raw.replace(/\D/g, '');
		// Typing into a full date overwrites the digit after the caret.
		if (digits.length > 8) digits = (digits.slice(0, before) + digits.slice(before + 1)).slice(0, 8);
		commit(digits, before);
	};

	/** Backspace / Delete next to a slash removes the neighbouring digit (the
	 *  slash itself is the mask's, deleting it alone would change nothing). */
	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		const el = e.currentTarget;
		const at = el.selectionStart ?? 0;
		if (at !== el.selectionEnd) return; // a selection deletes normally
		const digits = text.replace(/\D/g, '');
		const before = digitsBefore(text, at);
		if (e.key === 'Backspace' && text[at - 1] === '/' && before > 0) {
			e.preventDefault();
			commit(digits.slice(0, before - 1) + digits.slice(before), before - 1);
		} else if (e.key === 'Delete' && text[at] === '/') {
			e.preventDefault();
			commit(digits.slice(0, before) + digits.slice(before + 1), before);
		}
	};

	const complete = !!textToIso(text);
	const invalid = text.length === 10 && !complete;

	return (
		<div className="space-y-1">
			<div
				className={cn(
					compact ? 'h-9 rounded-md border-input' : 'h-11 rounded-lg',
					'flex w-full items-center border bg-card shadow-xs transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40',
					invalid && 'border-destructive focus-within:border-destructive focus-within:ring-destructive/25',
					disabled && 'pointer-events-none opacity-50'
				)}
			>
				<input
					ref={inputRef}
					id={id}
					value={text}
					inputMode="numeric"
					autoComplete="off"
					autoFocus={autoFocus}
					aria-label={label ?? 'Date'}
					placeholder="MM/DD/YYYY"
					disabled={disabled}
					onChange={(e) => onType(e.currentTarget)}
					onKeyDown={onKeyDown}
					onPaste={(e) => {
						const p = parseDob(e.clipboardData.getData('text'));
						if (!p) return;
						e.preventDefault();
						set(`${pad(p.month)}/${pad(p.day)}/${p.year}`);
					}}
					className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm tabular-nums tracking-wide outline-none placeholder:text-muted-foreground/60"
				/>
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							disabled={disabled}
							aria-label="Open calendar"
							className={cn(
								'mr-1 flex cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
								compact ? 'size-7' : 'size-9'
							)}
						>
							<CalendarDays className="size-4" />
						</button>
					</PopoverTrigger>
					<PopoverContent align="end" className="w-auto p-3">
						<Calendar
							value={textToIso(text)}
							onSelect={(iso) => {
								set(isoToText(iso));
								setOpen(false);
							}}
						/>
					</PopoverContent>
				</Popover>
			</div>
			{invalid && <p className="text-xs text-destructive">That date doesn't exist.</p>}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                    */
/* -------------------------------------------------------------------------- */

const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** UTC calendar arithmetic only (no local-time drift): days in month, weekday of the 1st. */
const daysIn = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
const firstWeekday = (year: number, month0: number) => new Date(Date.UTC(year, month0, 1)).getUTCDay();

function Calendar({value, onSelect}: {value: string; onSelect: (iso: string) => void}) {
	const today = useMemo(() => {
		const d = new Date();
		return {y: d.getFullYear(), m: d.getMonth(), d: d.getDate()};
	}, []);
	const selected = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	const [view, setView] = useState(() =>
		selected ? {y: +selected[1], m: +selected[2] - 1} : {y: today.y, m: today.m}
	);

	const years = useMemo(
		() => Array.from({length: today.y - 1920 + 1}, (_, i) => today.y - i),
		[today.y]
	);
	const shift = (delta: number) =>
		setView(({y, m}) => {
			const t = y * 12 + m + delta;
			return {y: Math.floor(t / 12), m: ((t % 12) + 12) % 12};
		});

	const lead = firstWeekday(view.y, view.m);
	const count = daysIn(view.y, view.m);
	const cells: (number | null)[] = [
		...Array.from({length: lead}, () => null),
		...Array.from({length: count}, (_, i) => i + 1)
	];

	const selectClass =
		'cursor-pointer rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring';

	return (
		<div className="w-[17.5rem] select-none">
			<div className="mb-2 flex items-center justify-between gap-1">
				<button
					type="button"
					onClick={() => shift(-1)}
					aria-label="Previous month"
					className="flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted"
				>
					<ChevronLeft className="size-4" />
				</button>
				<div className="flex items-center">
					<select
						aria-label="Month"
						value={view.m}
						onChange={(e) => setView((v) => ({...v, m: +e.target.value}))}
						className={selectClass}
					>
						{MONTH_NAMES.map((n, i) => (
							<option key={n} value={i}>
								{n}
							</option>
						))}
					</select>
					<select
						aria-label="Year"
						value={view.y}
						onChange={(e) => setView((v) => ({...v, y: +e.target.value}))}
						className={selectClass}
					>
						{years.map((y) => (
							<option key={y} value={y}>
								{y}
							</option>
						))}
					</select>
				</div>
				<button
					type="button"
					onClick={() => shift(1)}
					aria-label="Next month"
					className="flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted"
				>
					<ChevronRight className="size-4" />
				</button>
			</div>
			<div className="grid grid-cols-7 gap-0.5 text-center">
				{WEEKDAYS.map((w) => (
					<div key={w} className="py-1 text-[11px] font-medium text-muted-foreground">
						{w}
					</div>
				))}
				{cells.map((day, i) => {
					if (day === null) return <div key={`e${i}`} />;
					const iso = `${view.y}-${pad(view.m + 1)}-${pad(day)}`;
					const isSelected = iso === value;
					const isToday = view.y === today.y && view.m === today.m && day === today.d;
					return (
						<button
							key={iso}
							type="button"
							onClick={() => onSelect(iso)}
							className={cn(
								'flex size-9 cursor-pointer items-center justify-center rounded-md text-sm tabular-nums transition-colors',
								isSelected
									? 'bg-primary font-semibold text-primary-foreground'
									: isToday
										? 'font-semibold text-primary ring-1 ring-inset ring-primary/40 hover:bg-secondary'
										: 'hover:bg-muted'
							)}
						>
							{day}
						</button>
					);
				})}
			</div>
			<div className="mt-2 flex justify-end border-t pt-2">
				<button
					type="button"
					onClick={() => onSelect(`${today.y}-${pad(today.m + 1)}-${pad(today.d)}`)}
					className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-secondary"
				>
					Today
				</button>
			</div>
		</div>
	);
}
