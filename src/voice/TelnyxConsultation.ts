import {TelnyxHoldController, type TelnyxHoldTarget} from './telnyxHold';
import {ThreeWayAudio} from './threeWayAudio';
import {isTerminalState} from './callStateEvents';
import type {CallParticipantState, StartParticipant} from './VoiceTransport';

export interface ConsultationCall extends TelnyxHoldTarget {
	id: string;
	state: string;
	cause?: string;
	sipCode?: string | number;
	readonly remoteStream: MediaStream | null;
	readonly telnyxIDs?: {telnyxLegId?: string; telnyxSessionId?: string};
	hangup(): Promise<void> | void;
	muteAudio(): void;
	unmuteAudio(): void;
}
type Session = {
	primary: ConsultationCall;
	secondary?: ConsultationCall;
	state: CallParticipantState;
	audio: HTMLAudioElement;
	hold: TelnyxHoldController;
	context: AudioContext;
	mixer: ThreeWayAudio;
	cancelled: boolean;
	muted: boolean;
	microphone: MediaStreamTrack | null;
	timer?: number;
	operation: Promise<void>;
	cleanup?: Promise<void>;
};

/** Owns only the added leg. Primary call identity/presence/lead ownership never change. */
export class TelnyxConsultation {
	private session: Session | null = null;
	private destroyed = false;
	// Late terminal SDK events must never enter ordinary incoming-call routing.
	private auxiliaryIds = new Set<string>();

	constructor(private readonly host: {
		primary(): ConsultationCall | null;
		canStart(): boolean;
		dial(to: string, from: string, audio: HTMLAudioElement, id: string): ConsultationCall;
		outputDevice(): string;
		changed(state: CallParticipantState): void;
	}) {}

	get busy(): boolean { return this.session !== null; }
	get isMuted(): boolean { return this.session?.muted ?? false; }

	private emit(s: Session, phase: CallParticipantState['phase'], message?: string): void {
		const ids = s.secondary?.telnyxIDs;
		s.state = {...s.state, phase, message,
			...(ids?.telnyxLegId ? {legId: ids.telnyxLegId} : {}),
			...(ids?.telnyxSessionId ? {sessionId: ids.telnyxSessionId} : {})};
		this.host.changed(s.state);
	}

	start(request: StartParticipant): Promise<void> {
		const primary = this.host.primary();
		if (this.destroyed || this.busy || !primary || primary.state !== 'active' || !this.host.canStart()) {
			return Promise.reject(new Error('Resume and unmute your current call before adding a person.'));
		}
		// Construct/resume inside the click gesture, not after authorization completes.
		const context = new AudioContext();
		const resumed = context.resume();
		const audio = document.createElement('audio');
		audio.autoplay = true; audio.hidden = true;
		document.body.append(audio);
		const s: Session = {
			primary, state: {attemptId: request.attemptId, to: request.to, phase: 'preparing'},
			audio, context, hold: new TelnyxHoldController(primary), mixer: new ThreeWayAudio(context),
			cancelled: false, muted: false, microphone: null, operation: Promise.resolve()
		};
		this.session = s;
		this.emit(s, 'preparing');
		s.operation = (async () => {
			await resumed;
			if (s.cancelled) return;
			if (typeof audio.setSinkId === 'function') await audio.setSinkId(this.host.outputDevice());
			await s.hold.start();
			if (s.cancelled) return;
			const authorized = await request.authorize();
			if (s.cancelled || isTerminalState(primary.state)) return;
			this.auxiliaryIds.add(request.attemptId);
			s.secondary = this.host.dial(authorized.to, authorized.from, audio, request.attemptId);
			// SDK notifications can arrive synchronously during newCall().
			if (!s.cancelled && s.state.phase === 'preparing') this.emit(s, 'dialing');
			s.timer = window.setTimeout(() => {
				if (this.session === s && !s.state.connectedAt) void this.end('No answer. Your original call has resumed.').catch(() => undefined);
			}, 45000);
		})();
		return s.operation.catch(async error => {
			await this.end(error instanceof Error ? error.message : 'Could not add the call.', true);
			throw error;
		});
	}

	/** Handles only auxiliary events; original events continue through the transport. */
	onCall(call: ConsultationCall): boolean {
		const s = this.session;
		if (!s) return this.auxiliaryIds.has(call.id);
		if (call.id === s.primary.id && isTerminalState(call.state)) {
			void this.end('Original call ended. The added call has ended too.').catch(() => undefined);
		}
		if (call.id !== s.state.attemptId) return this.auxiliaryIds.has(call.id);
		s.secondary = call;
		if (isTerminalState(call.state)) {
			const reason = [call.cause, call.sipCode].filter(Boolean).join(' / ');
			const message = s.state.connectedAt ? 'Added person disconnected. Your original call has resumed.' :
				`Could not connect the added call${reason ? ` (${reason})` : ''}. Your original call has resumed.`;
			void this.end(message, !s.state.connectedAt).catch(() => undefined);
		} else if (!s.cancelled && call.state === 'active' && !s.state.connectedAt) {
			window.clearTimeout(s.timer);
			s.state.connectedAt = Date.now();
			this.setMuted(s.muted);
			this.emit(s, 'private');
		} else if (!s.cancelled && !s.state.connectedAt && ['ringing', 'early'].includes(call.state)) {
			this.emit(s, 'ringing');
		}
		return true;
	}

	merge(): Promise<void> {
		const s = this.session;
		if (!s || s.cancelled || s.state.phase !== 'private' || s.secondary?.state !== 'active') return Promise.resolve();
		this.emit(s, 'merging');
		s.operation = (async () => {
			const a = s.primary.peer?.instance?.getSenders().find(sender => sender.track?.kind === 'audio');
			const b = s.secondary?.peer?.instance?.getSenders().find(sender => sender.track?.kind === 'audio');
			if (!a || !b || !s.primary.remoteStream || !s.secondary?.remoteStream) throw new Error('Both calls need live audio before merging.');
			await s.hold.stop();
			if (s.cancelled) return;
			s.microphone = a.track;
			if (s.microphone) s.microphone.enabled = !s.muted;
			await s.mixer.connect(a, b, s.primary.remoteStream, s.secondary.remoteStream);
			if (!s.cancelled) this.emit(s, 'merged');
		})();
		return s.operation.catch(async error => {
			await this.end('Could not merge. The added call has ended.', true);
			throw error;
		});
	}

	setMuted(muted: boolean): void {
		const s = this.session;
		if (!s) return;
		s.muted = muted;
		if (s.microphone) s.microphone.enabled = !muted;
		else if (s.secondary) {
			if (muted) s.secondary.muteAudio(); else s.secondary.unmuteAudio();
		}
	}

	end(message = 'Added call ended. Your original call has resumed.', failed = false): Promise<void> {
		const s = this.session;
		if (!s) return Promise.resolve();
		if (s.cleanup) return s.cleanup;
		s.cancelled = true;
		this.emit(s, 'ending');
		s.cleanup = (async () => {
			await s.operation.catch(() => undefined);
			window.clearTimeout(s.timer);
			const errors: unknown[] = [];
			try { await s.mixer.disconnect(!isTerminalState(s.primary.state), !!s.secondary && !isTerminalState(s.secondary.state)); } catch (error) { errors.push(error); }
			try { if (s.secondary && !isTerminalState(s.secondary.state)) await s.secondary.hangup(); }
			catch (error) {
				errors.push(error);
				// If signaling failed, isolate the remaining leg before resuming the caller.
				s.secondary?.muteAudio();
				s.audio.muted = true;
			}
			try { await s.hold.stop(); } catch (error) { if (!isTerminalState(s.primary.state)) errors.push(error); }
			if (!isTerminalState(s.primary.state)) {
				if (s.muted) s.primary.muteAudio(); else s.primary.unmuteAudio();
			}
			s.audio.srcObject = null; s.audio.remove();
			if (s.context.state !== 'closed') await s.context.close();
			if (errors.length) {
				// Keep the interaction busy until the agent retries cleanup. Never claim
				// the added leg ended or resume inbound eligibility after a failed hangup.
				s.cleanup = undefined;
				this.emit(s, 'ending', 'Could not finish ending the added call. Please retry.');
				throw new Error('Could not finish ending the added call. Please retry.');
			}
			if (this.session === s) this.session = null;
			this.emit(s, failed ? 'failed' : 'completed', message);
		})();
		return s.cleanup;
	}

	destroy(): void {
		this.destroyed = true;
		void this.end('Call connection closed.').catch(() => undefined);
	}
}
