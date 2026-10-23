import {isTerminalState} from './callStateEvents';

/** The SDK stores the stream here for deaf/undeaf, mixing and finalization. */
export interface TelnyxPlaybackCall {
	state: string;
	options: {
		remoteElement?: HTMLMediaElement | string | null;
		remoteStream?: MediaStream | null;
	};
	readonly remoteStream: MediaStream | null;
	readonly peer?: {instance?: RTCPeerConnection | null} | null;
}

/**
 * SDK 2.27.9 clears remoteElement unconditionally when an ending call has no
 * remoteStream. Its synchronous destroy notification precedes that cleanup.
 * Disown only that ending call's element when another live call provably owns it.
 */
export function protectTerminalAudio(
	call: TelnyxPlaybackCall,
	element: HTMLAudioElement | null,
	owners: Iterable<TelnyxPlaybackCall>
): boolean {
	try {
		if (call.state !== 'destroy' || !element || call.remoteStream ||
			call.options.remoteElement !== element || !element.srcObject) return false;
		for (const owner of owners) {
			if (owner === call || isTerminalState(owner.state) || owner.state === 'recovering' ||
				owner.options.remoteElement !== element || owner.remoteStream !== element.srcObject) continue;
			const peer = owner.peer?.instance;
			if (!peer || peer.connectionState === 'closed') continue;
			const tracks = owner.remoteStream?.getAudioTracks() ?? [];
			const receivers = peer.getReceivers().map(receiver => receiver.track);
			if (!tracks.length || tracks.some(track => track.readyState !== 'live' || !receivers.includes(track))) continue;
			call.options.remoteElement = null;
			return true;
		}
	} catch { /* Playback protection must never interrupt SDK call-state routing. */ }
	return false;
}

/** Bounded attachment repair. Never reconnects, changes tracks or pauses a call. */
export class TelnyxPlaybackRecovery {
	private attempts = new WeakMap<TelnyxPlaybackCall, number>();

	async recover(
		call: TelnyxPlaybackCall,
		peer: RTCPeerConnection,
		element: HTMLAudioElement,
		isCurrent: () => boolean
	): Promise<'skipped' | 'attached' | 'play-rejected' | 'failed'> {
		try {
			const eligible = () => isCurrent() && call.state === 'active' &&
				call.peer?.instance === peer && peer.connectionState === 'connected' &&
				call.options.remoteElement === element && element.srcObject == null &&
				!element.currentSrc && !element.getAttribute('src');
			if (!eligible() || (this.attempts.get(call) ?? 0) >= 2) return 'skipped';
			const tracks = peer.getReceivers().map(receiver => receiver.track).filter(track =>
				track.kind === 'audio' && track.readyState === 'live' && track.enabled);
			if (!tracks.length) return 'skipped';
			let stream = call.remoteStream;
			const existingTracks = stream?.getAudioTracks() ?? [];
			if (!existingTracks.length || existingTracks.some(track => !tracks.includes(track))) {
				stream = new MediaStream(tracks);
			}
			if (!stream || !eligible()) return 'skipped';
			this.attempts.set(call, (this.attempts.get(call) ?? 0) + 1);
			// Updating only the element would leave SDK Hold and consultation broken.
			call.options.remoteStream = stream;
			element.srcObject = stream;
			try {
				await element.play();
				return 'attached';
			} catch {
				// No rollback: the call/peer/element may have a new owner by now.
				return 'play-rejected';
			}
		} catch {
			return 'failed';
		}
	}
}
