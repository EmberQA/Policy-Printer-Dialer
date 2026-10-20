import {Button} from '@/components/ui/button';

export type SpeakerPauseState = 'pausing' | 'paused' | 'failed' | null;

export function SpeakerUnavailableBanner({blocked, pauseState, onOpenAudioSetup, onRetry}: {
	blocked: boolean;
	pauseState: SpeakerPauseState;
	onOpenAudioSetup: () => void;
	onRetry: () => void;
}) {
	if (!blocked && pauseState !== 'pausing' && pauseState !== 'failed') return null;
	return <div role="alert" className="flex flex-wrap items-center justify-center gap-3 border-t border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
		<p className="min-w-0">
			<strong>{blocked ? 'Your selected speaker disconnected.' : 'Speaker restored.'}</strong>{' '}
			{blocked && 'Reconnect it or choose another speaker in Audio Setup. '}
			{pauseState === 'paused'
				? 'New calls are paused.'
				: pauseState === 'failed'
					? 'We could not confirm the pause for new calls and are retrying.'
					: 'Pausing availability for new calls…'}
		</p>
		<Button size="sm" variant="outline" onClick={onOpenAudioSetup}>Open Audio Setup</Button>
		{pauseState === 'failed' && <Button size="sm" variant="outline" onClick={onRetry}>Retry pause</Button>}
	</div>;
}
