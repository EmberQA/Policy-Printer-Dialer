/**
 * ENG-220: the agent edits the states they are licensed in, from the dialer header.
 *
 * The list is the source of truth for every one of their Retreaver buyers — one per
 * campaign — so a save here changes which calls they receive on all of them. The backend
 * writes the database row before responding and pushes Retreaver in the background, so
 * the spinner covers the part that actually matters and a slow carrier never holds the
 * agent up.
 *
 * A modal rather than a popover: 51 jurisdictions want a multi-column grid, which needs
 * far more width than a header-anchored panel has, and picking states is a deliberate
 * task worth taking over the screen for. Built on radix-ui's Dialog inline, the way
 * TrainingVideoDialog does, since the app has no ui/dialog.tsx.
 */

import {useCallback, useEffect, useState} from 'react';
import {Loader2, X} from 'lucide-react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Button} from '@/components/ui/button';
import {
	fetchLicensedStates,
	saveLicensedStates,
	type LicensedJurisdiction
} from '@/lib/api';
import {readError} from '@/lib/errors';

export function LicensedStatesDialog({
	open,
	onOpenChange
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [jurisdictions, setJurisdictions] = useState<LicensedJurisdiction[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Loaded on open rather than on mount: this is never on the path to taking a call,
	// and an agent who never opens it should not make the request at all.
	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetchLicensedStates();
			if (res.statusCode !== 'SP100') {
				setError(res.statusMessage || 'Could not load your states');
				return;
			}
			setJurisdictions(res.jurisdictions ?? []);
			setSelected(res.states ?? []);
		} catch (err) {
			setError(readError(err, 'Could not load your states'));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const toggle = (code: string) =>
		setSelected((current) =>
			current.includes(code)
				? current.filter((value) => value !== code)
				: [...current, code]
		);

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const res = await saveLicensedStates(selected);
			if (res.statusCode !== 'SP100') {
				setError(res.statusMessage || 'Could not save your states');
				return;
			}
			// Take the server's normalized list back, so what stays on screen is what was
			// actually stored rather than what was clicked.
			setSelected(res.states ?? selected);
			onOpenChange(false);
		} catch (err) {
			setError(readError(err, 'Could not save your states'));
		} finally {
			setSaving(false);
		}
	};

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
				{/* Rows: header / scrolling grid / footer — the grid is the only part that
				    scrolls, so the warning and the Save button are always in view. */}
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[85vh] w-[92vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
					<div className="flex items-start justify-between gap-3">
						<div className="space-y-1">
							<DialogPrimitive.Title className="text-lg font-semibold">
								States you&apos;re licensed in
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								Only select states you are licensed to sell in. Volume depends on
								how many you cover — under 15 can mean 30+ minutes between calls.
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-8 shrink-0"
								aria-label="Close licensed states"
							>
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					<div className="min-h-0 overflow-y-auto">
						{loading ? (
							<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading your states…
							</div>
						) : (
							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{jurisdictions.map((jurisdiction) => {
									const checked = selected.includes(jurisdiction.code);
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
												onChange={() => toggle(jurisdiction.code)}
												className="size-4 accent-primary"
											/>
											<span className="min-w-0 truncate">{jurisdiction.name}</span>
											<span className="ml-auto pl-1 font-mono text-xs text-muted-foreground">
												{jurisdiction.abbr}
											</span>
										</label>
									);
								})}
							</div>
						)}
					</div>

					<div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0 text-sm text-muted-foreground">
							{error ? (
								<span className="text-destructive">{error}</span>
							) : (
								`${selected.length} of ${jurisdictions.length} selected`
							)}
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<DialogPrimitive.Close asChild>
								<Button type="button" variant="outline" disabled={saving}>
									Cancel
								</Button>
							</DialogPrimitive.Close>
							<Button
								type="button"
								variant="success"
								// An empty list is refused by the API rather than stored: it could
								// never reach Retreaver, which declines to strip a buyer's filters
								// entirely.
								disabled={saving || loading || selected.length === 0}
								onClick={save}
							>
								{saving && <Loader2 className="size-4 animate-spin" />}
								{saving ? 'Saving…' : 'Save states'}
							</Button>
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
