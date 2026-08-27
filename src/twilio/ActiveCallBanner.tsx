import {useEffect, useState} from 'react';
import {
	Ellipsis,
	Loader2,
	Mic,
	MicOff,
	Pause,
	PhoneCall,
	PhoneOff,
	PhoneOutgoing,
	Play
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type {ActiveCall} from '@/twilio/useDevice';

/**
 * Active-call banner (Subplan 03). Shows the caller number, a live call timer, and
 * mute / hold / hang-up controls for the in-progress call. Pinned above the
 * softphone card while a call is connected; the lead form renders alongside it.
 */
export function ActiveCallBanner({
	call,
	campaignName,
	onMute,
	onHold,
	onHangup
}: {
	call: ActiveCall;
	campaignName: string | null;
	onMute: (muted: boolean) => void;
	onHold: (held: boolean) => Promise<void>;
	onHangup: () => void;
}) {
	const elapsed = useElapsedSeconds(call.startedAt);
	const isOutbound = call.direction === 'outbound';

	return (
		<div className="grid gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
			<div className="flex min-w-0 items-center gap-3 sm:col-start-1 sm:row-start-1">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
					{isOutbound ? (
						<PhoneOutgoing className="size-4" />
					) : (
						<PhoneCall className="size-4" />
					)}
				</div>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<Badge className="bg-success text-success-foreground">
							{isOutbound ? 'Outbound call' : 'Active call'}
						</Badge>
						{!isOutbound && (
							<Badge
								variant="outline"
								title={call.retreaverUuid ?? undefined}
							>
								{call.campaignId
									? `Campaign: ${campaignName ?? 'Unavailable'}`
									: call.retreaverUuid
										? `Retreaver · ${call.retreaverUuid.slice(0, 8)}`
										: 'Direct call'}
							</Badge>
						)}
						<span className="font-mono text-sm tabular-nums text-muted-foreground">
							{formatDuration(elapsed)}
						</span>
					</div>
					<div className="mt-1 truncate font-mono text-sm">{call.from}</div>
				</div>
			</div>

			{(call.held || call.muted) && (
				<div
					role="status"
					aria-live="polite"
					className="group relative justify-self-center sm:col-start-2 sm:row-start-1"
				>
					<button
						type="button"
						disabled={call.holdPending}
						aria-describedby="call-state-action-tooltip"
						onClick={() => {
							if (call.held) {
								void onHold(false).catch(() => undefined);
							} else {
								onMute(false);
							}
						}}
						className={
							call.held
								? 'flex cursor-pointer items-center justify-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70'
								: 'flex cursor-pointer items-center justify-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2'
						}
					>
						{call.held ? (
							call.holdPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Pause className="size-4" />
							)
						) : (
							<MicOff className="size-4" />
						)}
						{call.held ? 'Hold music playing' : "You're muted"}
					</button>
					<span
						id="call-state-action-tooltip"
						role="tooltip"
						className="pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
					>
						{call.held ? 'Click to take caller off hold' : 'Click to unmute'}
					</span>
				</div>
			)}

			<div className="flex flex-wrap items-center justify-end gap-2 justify-self-end sm:col-start-3 sm:row-start-1">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="icon"
							disabled={call.holdPending}
							aria-label="More call controls"
						>
							{call.holdPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Ellipsis className="size-4" />
							)}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-40">
						<DropdownMenuItem
							disabled={call.held || call.holdPending}
							onSelect={() => onMute(!call.muted)}
						>
							{call.muted ? (
								<Mic className="size-4" />
							) : (
								<MicOff className="size-4" />
							)}
							{call.muted ? 'Unmute' : 'Mute'}
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={call.holdPending}
							onSelect={() =>
								void onHold(!call.held).catch(() => undefined)
							}
						>
							{call.held ? (
								<Play className="size-4" />
							) : (
								<Pause className="size-4" />
							)}
							{call.held ? 'Resume' : 'Hold'}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button variant="destructive" size="sm" onClick={onHangup}>
					<PhoneOff className="size-4" />
					Hang up
				</Button>
			</div>
		</div>
	);
}

/** Seconds since `startedAt`, ticking once per second. */
function useElapsedSeconds(startedAt: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);
	return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatDuration(totalSeconds: number): string {
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
