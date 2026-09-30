/** Enter commits a field without silently leaving the rest of a checklist. */
export function focusNextScriptField(input: HTMLElement): void {
	const step = input.closest('[data-script-step]');
	const current = input.closest('[data-script-field]');
	if (!step || !current) return;
	const fields = Array.from(
		step.querySelectorAll<HTMLElement>('[data-script-field]')
	);
	for (
		let i = fields.indexOf(current as HTMLElement) + 1;
		i < fields.length;
		i++
	) {
		const target = fields[i].querySelector<HTMLElement>(
			'input:not([disabled]), textarea:not([disabled]), button:not([disabled])'
		);
		if (target) {
			target.focus();
			return;
		}
	}
}

/** Tab visits answer controls only, skipping acknowledgments and navigation.
 * Use document order so the last script field can continue into the lead form.
 */
export function handleScriptTab(event: {
	key: string;
	shiftKey: boolean;
	target: EventTarget | null;
	preventDefault(): void;
}): void {
	if (event.key !== 'Tab' || !(event.target instanceof HTMLElement)) return;
	const target = event.target;
	const all = Array.from(
		target.ownerDocument.querySelectorAll<HTMLElement>(
			'input, textarea, select, button, [tabindex], a[href]'
		)
	);
	const eligible = (element: HTMLElement) =>
		!element.matches(
			'[disabled], [readonly], [aria-disabled="true"], [type="hidden"], [type="checkbox"], [type="radio"], [type="submit"]'
		) &&
		element.tabIndex >= 0 &&
		element.getClientRects().length > 0 &&
		element.matches('input, textarea, select, [data-script-answer]');
	const at = all.indexOf(target);
	if (at < 0) return;
	const ordered = event.shiftKey
		? all.slice(0, at).reverse()
		: all.slice(at + 1);
	const next =
		ordered.find(eligible) ??
		(event.shiftKey ? [...all].reverse() : all).find(eligible);
	if (next) {
		event.preventDefault();
		next.focus();
	}
}
