/**
 * Browser-side hold on Telnyx (ENG-159 — Subplan 05).
 *
 * Telnyx has no `AudioProcessor` plugin API, so `HoldAudioController`'s mechanism does
 * not port. It reaches the same two outcomes through mechanisms the SDK already has:
 *
 *   silence the caller for the agent  → `call.deaf()` / `call.undeaf()`  (built in)
 *   replace the mic with music        → `RTCRtpSender.replaceTrack(musicTrack)`
 *
 * `replaceTrack` is the same mechanism Telnyx's own `setAudioInDevice` uses internally,
 * reached through the public `call.peer.instance`. The music itself is the SHARED
 * generator from `holdMusic.ts` — the part that took real effort is reused verbatim,
 * only the ~60-line host differs, and this one is simpler than the Twilio original
 * because `deaf()` replaces an entire processor.
 *
 * > Telnyx also ships native `call.hold()`/`unhold()`, but that is SERVER-side hold:
 * > the call state changes and the caller gets Telnyx's treatment instead of ours.
 * > Deliberately unused, so hold sounds identical on both carriers.
 */

import {HoldMusicProcessor} from './holdMusic';

/** The slice of `@telnyx/webrtc`'s Call this host needs. */
export interface TelnyxHoldTarget {
	deaf(): void;
	undeaf(): void;
	readonly localStream: MediaStream | null;
	readonly peer?: {instance?: RTCPeerConnection | null} | null;
}

export class TelnyxHoldController {
	private music: HoldMusicProcessor | null = null;
	private sender: RTCRtpSender | null = null;
	/** The agent's real microphone track, restored on resume. */
	private originalTrack: MediaStreamTrack | null = null;
	private deafened = false;

	constructor(
		private readonly call: TelnyxHoldTarget,
		private readonly musicFactory: () => HoldMusicProcessor = () =>
			new HoldMusicProcessor()
	) {}

	async start(): Promise<void> {
		if (this.music) return;

		const sender = findAudioSender(this.call);
		if (!sender) {
			throw new Error('Could not reach the call audio to start hold music.');
		}

		// Constructed before any await so the AudioContext is created inside the Hold
		// click gesture, matching HoldMusicProcessor's own constructor contract.
		const music = this.musicFactory();
		this.music = music;

		try {
			const stream = await music.createProcessedStream(new MediaStream());
			const musicTrack = stream.getAudioTracks()[0];
			if (!musicTrack) throw new Error('Hold music produced no audio track.');

			this.originalTrack = sender.track ?? null;
			this.sender = sender;
			await sender.replaceTrack(musicTrack);

			// Silence the caller for the agent LAST. If anything above failed, the agent
			// keeps hearing the call rather than being left on a silent, un-held line.
			this.call.deaf();
			this.deafened = true;
		} catch (error) {
			await this.stop().catch(() => undefined);
			throw error;
		}
	}

	async stop(): Promise<void> {
		if (this.deafened) {
			// Restore caller playback first, mirroring HoldAudioController's ordering: if
			// the mic restore then fails, the agent can still hear and hang up.
			this.call.undeaf();
			this.deafened = false;
		}

		const sender = this.sender;
		this.sender = null;
		if (sender) {
			// A null original track is legitimate — the agent may have been muted into a
			// stopped track — and replaceTrack(null) is the correct restore for it.
			await sender.replaceTrack(this.originalTrack);
		}
		this.originalTrack = null;

		const music = this.music;
		this.music = null;
		music?.dispose();
	}
}

/**
 * The sending half of the call's audio.
 *
 * `getSenders()` is read off the live peer connection rather than cached, because a
 * mid-call device switch (`setAudioInDevice`) replaces the track on this same sender —
 * a cached reference would be correct but a cached TRACK would not.
 */
const findAudioSender = (call: TelnyxHoldTarget): RTCRtpSender | null => {
	const peer = call.peer?.instance;
	if (!peer || typeof peer.getSenders !== 'function') return null;
	return (
		peer.getSenders().find((sender) => sender.track?.kind === 'audio') ??
		// A sender whose track was already replaced with a non-live track still carries
		// the audio transceiver; fall back to the first sender that can take one.
		peer.getSenders().find((sender) => sender.track === null) ??
		null
	);
};
