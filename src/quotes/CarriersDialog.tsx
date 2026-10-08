/**
 * My Carriers (ENG-286): the carriers this agent is appointed with. Opened
 * from the dialer header's settings menu, next to Licensed states — both are
 * saved on the agent's dialer profile (dialer_agents.quote_carriers). Sent as
 * ITK's carriersFilter on every quote. None selected = all carriers.
 */

import {useEffect, useMemo, useState} from 'react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Check, Loader2, Search, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {QS_SUCCESS, getMyCarriers, saveMyCarriers} from './api';

export function CarriersDialog({
	open,
	onOpenChange,
	onSaved
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved?: (carriers: string[] | null) => void;
}) {
	const [companies, setCompanies] = useState<string[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [filter, setFilter] = useState('');
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setLoading(true);
		setError(null);
		getMyCarriers()
			.then((res) => {
				if (res.statusCode !== QS_SUCCESS) {
					setError(res.statusMessage || 'Could not load carriers');
					return;
				}
				setCompanies(res.companies ?? []);
				setSelected(new Set(res.selected ?? []));
			})
			.catch((err) => setError(err?.message || 'Could not load carriers'))
			.finally(() => setLoading(false));
	}, [open]);

	const visible = useMemo(
		() => companies.filter((c) => c.toLowerCase().includes(filter.trim().toLowerCase())),
		[companies, filter]
	);

	const toggle = (c: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(c)) next.delete(c);
			else next.add(c);
			return next;
		});

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const res = await saveMyCarriers([...selected]);
			if (res.statusCode !== QS_SUCCESS) {
				setError(res.statusMessage || 'Save failed');
				return;
			}
			onSaved?.(res.selected ?? null);
			onOpenChange(false);
		} catch (err: any) {
			setError(err?.message || 'Save failed');
		} finally {
			setSaving(false);
		}
	};

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover text-popover-foreground shadow-xl">
					<div className="flex items-start justify-between gap-3 border-b px-5 py-4">
						<div>
							<DialogPrimitive.Title className="text-base font-semibold">My carriers</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								Quote only the carriers you're appointed with. None selected quotes all carriers.
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button variant="ghost" size="icon" className="size-8" aria-label="Close">
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					{loading ? (
						<div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading carriers…
						</div>
					) : (
						<>
							<div className="flex items-center gap-2 px-5 pt-4">
								<div className="relative flex-1">
									<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										value={filter}
										onChange={(e) => setFilter(e.target.value)}
										placeholder="Filter carriers"
										className="pl-9"
									/>
								</div>
								<Button variant="ghost" size="sm" onClick={() => setSelected(new Set(companies))}>
									All
								</Button>
								<Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
									None
								</Button>
							</div>
							<div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
								<div className="grid gap-1 sm:grid-cols-2">
									{visible.map((c) => {
										const on = selected.has(c);
										return (
											<button
												key={c}
												type="button"
												onClick={() => toggle(c)}
												className={cn(
													'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
													on ? 'border-primary/40 bg-secondary' : 'border-transparent hover:bg-muted'
												)}
											>
												<span
													className={cn(
														'flex size-4 shrink-0 items-center justify-center rounded border',
														on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card'
													)}
												>
													{on && <Check className="size-3" />}
												</span>
												<span className="truncate">{c}</span>
											</button>
										);
									})}
								</div>
							</div>
						</>
					)}

					<div className="flex items-center justify-between gap-3 border-t px-5 py-3">
						<span className="text-sm text-muted-foreground">
							{error ? (
								<span className="text-destructive">{error}</span>
							) : selected.size ? (
								`${selected.size} of ${companies.length} selected`
							) : (
								'All carriers'
							)}
						</span>
						<div className="flex gap-2">
							<DialogPrimitive.Close asChild>
								<Button variant="outline">Cancel</Button>
							</DialogPrimitive.Close>
							<Button onClick={save} disabled={saving || loading}>
								{saving && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
