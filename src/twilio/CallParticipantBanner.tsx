import {Loader2, Merge, PhoneOff, PhoneOutgoing, Users} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import type {CallParticipantState} from '@/voice/VoiceTransport';

export function CallParticipantBanner({participant, onMerge, onEnd}: {
	participant: CallParticipantState;
	onMerge: () => Promise<void>;
	onEnd: () => Promise<void>;
}) {
	const {phase, to} = participant;
	const privateCall = phase === 'private';
	const merged = phase === 'merged';
	const transitioning = ['preparing', 'dialing', 'ringing', 'merging', 'ending'].includes(phase);
	const title = {
		preparing: 'Holding caller…', dialing: 'Calling added person…', ringing: 'Ringing added person…',
		private: 'Private conversation', merging: 'Merging calls…', merged: 'Three-way call',
		ending: 'Returning to original call…', completed: 'Original call resumed', failed: 'Added call ended'
	}[phase];
	const description = merged ? 'Everyone can hear and speak to each other.' : phase === 'merging' ?
		'Connecting all three participants.' : phase === 'ending' ? 'Ending the added call and restoring the original caller.' :
		privateCall ? 'Original caller hears hold music. Only you and the added person can hear this conversation.' :
		'Your original caller is being held while you call another person.';
	return (
		<div className="space-y-3 rounded-lg border bg-card px-4 py-3 shadow-xs" role="status" aria-live="polite">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${merged ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-amber-600'}`}>
						{transitioning ? <Loader2 className="size-4 animate-spin" /> : merged ? <Users className="size-4" /> : <PhoneOutgoing className="size-4" />}
					</div>
					<div>
						<Badge variant="outline">{title}</Badge>
						<div className="mt-1 font-mono text-sm">{to}</div>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{privateCall && <Button size="sm" variant="success" onClick={() => void onMerge().catch(() => undefined)}><Merge className="size-4" />Merge calls</Button>}
					<Button size="sm" variant="outline" disabled={phase === 'merging' || (phase === 'ending' && !participant.message)} onClick={() => void onEnd().catch(() => undefined)}>
						<PhoneOff className="size-4" />{phase === 'ending' ? 'Retry ending call' : privateCall || merged ? 'End added call' : 'Cancel added call'}
					</Button>
				</div>
			</div>
			<p className="text-sm text-muted-foreground">{participant.message ?? description}</p>
		</div>
	);
}
