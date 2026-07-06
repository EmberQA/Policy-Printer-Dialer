import {useEffect, useState} from 'react';
import {Mic, MicOff, PhoneCall, PhoneOff, PhoneOutgoing} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import type {ActiveCall} from '@/twilio/useDevice';

/**
 * Active-call banner (Subplan 03). Shows the caller number, a live call timer, and
 * mute / hang-up controls for the in-progress call. Pinned above the softphone card
 * while a call is connected; the lead form (Subplan 04) renders alongside it.
 */
export function ActiveCallBanner({
	call,
	onMute,
	onHangup
}: {
	call: ActiveCall;
	onMute: (muted: boolean) => void;
	onHangup: () => void;
}) {
	const elapsed = useElapsedSeconds(call.startedAt);
	const isOutbound = call.direction === 'outbound';

	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-center gap-3">
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
						<span className="font-mono text-sm tabular-nums text-muted-foreground">
							{formatDuration(elapsed)}
						</span>
					</div>
					<div className="mt-1 truncate font-mono text-sm">{call.from}</div>
				</div>
			</div>

			<div className="flex items-center gap-2 self-end sm:self-auto">
				<Button
					variant={call.muted ? 'secondary' : 'outline'}
					size="sm"
					onClick={() => onMute(!call.muted)}
				>
					{call.muted ? (
						<Mic className="size-4" />
					) : (
						<MicOff className="size-4" />
					)}
					{call.muted ? 'Unmute' : 'Mute'}
				</Button>
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
