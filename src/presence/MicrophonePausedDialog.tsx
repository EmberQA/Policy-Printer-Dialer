import {Dialog} from 'radix-ui';
import {Button} from '@/components/ui/button';
import type {MicrophoneProblem} from '@/voice/VoiceTransport';

export interface MicrophonePauseNotice {
	reason: MicrophoneProblem;
	state: 'pausing' | 'paused' | 'failed';
}

export function MicrophonePausedDialog({notice, callInProgress = false, onDismiss, onRetry}: {
	notice: MicrophonePauseNotice | null;
	callInProgress?: boolean;
	onDismiss: () => void;
	onRetry: () => void;
}) {
	// Keep the notice pending until the call ends. No portal, overlay, or focus trap
	// during calls: Audio Setup and call controls must remain usable even if pausing fails.
	if (callInProgress) {
		if (!notice) return null;
		return <div role="alert" className="flex flex-wrap items-center justify-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
			<p>
				<strong>{notice.reason === 'disconnected' ? 'Microphone disconnected.' : 'Microphone unavailable.'}</strong>{' '}
				{notice.state === 'paused'
					? 'New calls are paused.'
					: notice.state === 'failed'
						? 'We could not confirm the pause for new calls and are retrying.'
						: 'Pausing availability for new calls…'}{' '}
				Reconnect your microphone or select another one in Audio Setup.
			</p>
			{notice.state === 'failed' && <Button size="sm" variant="outline" onClick={onRetry}>Retry pause</Button>}
		</div>;
	}
	return <Dialog.Root open={notice !== null} onOpenChange={open => {if (!open && notice?.state === 'paused') onDismiss();}}>
		<Dialog.Portal>
			<Dialog.Overlay className="fixed inset-0 z-[60] bg-black/45" />
			<Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl">
				<Dialog.Title className="text-lg font-semibold">
					{notice?.state === 'paused' ? 'You’re paused' : notice?.state === 'failed' ? 'Could not confirm pause' : 'Pausing calls…'}
				</Dialog.Title>
				<Dialog.Description className="mt-2 text-sm text-muted-foreground" aria-live="polite">
					{notice?.state === 'paused'
						? notice.reason === 'disconnected'
							? 'You were paused because your microphone disconnected.'
							: 'You were paused because your microphone is unavailable.'
						: notice?.state === 'failed'
							? 'Your microphone is unavailable. We could not confirm the pause with the server and are retrying.'
							: 'Your microphone is unavailable. Pausing your availability for new calls.'}
					{' '}Reconnect your microphone or select another one in Audio Setup, then click Go Ready when it works. Reconnecting will not make you Ready automatically.
				</Dialog.Description>
				<div className="mt-5 flex justify-end">
					{notice?.state === 'failed'
						? <Button onClick={onRetry}>Retry pause</Button>
						: <Button disabled={notice?.state !== 'paused'} onClick={onDismiss}>Got it</Button>}
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>;
}
