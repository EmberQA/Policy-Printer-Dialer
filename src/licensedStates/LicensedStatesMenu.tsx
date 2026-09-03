/**
 * ENG-220: the agent edits the states they are licensed in, from the dialer header.
 *
 * The list is the source of truth for every one of their Retreaver buyers — one per
 * campaign — so a save here changes which calls they receive on all of them. The backend
 * writes the database row before responding and pushes Retreaver in the background, so
 * the spinner covers the part that actually matters and a slow carrier never holds the
 * agent up.
 *
 * Built on the app's existing dropdown-menu primitive rather than a new popover:
 * DropdownMenuCheckboxItem is exactly a multi-select row, and DropdownMenuContent
 * already scrolls within the viewport, which a 51-row list needs.
 */

import {useCallback, useEffect, useState} from 'react';
import {Loader2, MapPinned} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
	fetchLicensedStates,
	saveLicensedStates,
	type LicensedJurisdiction
} from '@/lib/api';
import {readError} from '@/lib/errors';

export function LicensedStatesMenu() {
	const [open, setOpen] = useState(false);
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
			setOpen(false);
		} catch (err) {
			setError(readError(err, 'Could not save your states'));
		} finally {
			setSaving(false);
		}
	};

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-7"
					title="Adjust states"
					aria-label="Adjust the states you are licensed in"
				>
					<MapPinned className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel className="pb-0">
					States you're licensed in
				</DropdownMenuLabel>
				<p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
					Only select states you are licensed to sell in. Volume depends on how many
					you cover — under 15 can mean 30+ minutes between calls.
				</p>
				<DropdownMenuSeparator />

				{loading ? (
					<div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Loading your states…
					</div>
				) : (
					jurisdictions.map((jurisdiction) => (
						<DropdownMenuCheckboxItem
							key={jurisdiction.code}
							checked={selected.includes(jurisdiction.code)}
							disabled={saving}
							// Ticking a state must not dismiss the menu — this is a multi-select
							// with an explicit Save, not a command list.
							onSelect={(event) => event.preventDefault()}
							onCheckedChange={() => toggle(jurisdiction.code)}
						>
							{jurisdiction.name}
							<span className="ml-auto pl-2 text-xs text-muted-foreground">
								{jurisdiction.abbr}
							</span>
						</DropdownMenuCheckboxItem>
					))
				)}

				<DropdownMenuSeparator />
				{error && (
					<p className="px-2 pb-2 text-xs text-destructive">{error}</p>
				)}
				<div className="flex items-center justify-between gap-2 px-2 py-1">
					<span className="text-xs text-muted-foreground">
						{selected.length} selected
					</span>
					<Button
						type="button"
						size="sm"
						variant="success"
						// An empty list is refused by the API rather than stored: it could never
						// reach Retreaver, which declines to strip a buyer's filters entirely.
						disabled={saving || loading || selected.length === 0}
						onClick={save}
					>
						{saving && <Loader2 className="size-4 animate-spin" />}
						{saving ? 'Saving…' : 'Save'}
					</Button>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
