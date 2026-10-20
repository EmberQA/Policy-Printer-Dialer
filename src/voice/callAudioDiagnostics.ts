import {readInboundAudio, type StatsReportLike} from './rtcStats';

export interface CallAudioSample {
	elapsed_ms: number;
	inbound: ReturnType<typeof readInboundAudio>;
	audio_level: number | null;
	connection_state?: string;
	ice_state?: string;
	playback: {
		sink_id: string | null;
		selected_output_id: string;
		paused: boolean;
		muted: boolean;
		volume: number;
		ready_state: number;
		current_time: number;
		has_stream: boolean;
		track_state?: string;
		track_muted?: boolean;
	} | null;
}

/** Bounded, passive observations only. Never opens, plays, or changes media. */
export class CallAudioDiagnostics {
	private startedAt = Date.now();
	private sampledAt: number | null = null;
	private first: CallAudioSample | undefined;
	private samples: CallAudioSample[] = [];
	private errors = 0;

	record(report: StatsReportLike | null, peer: RTCPeerConnection | undefined,
		element: HTMLAudioElement | null, selectedOutput: string): void {
		try {
			const now = Date.now();
			if (this.sampledAt !== null && now - this.sampledAt < 5000) return;
			let audioLevel: number | null = null;
			report?.forEach(value => {
				const stat = value as {type?: string; kind?: string; mediaType?: string; audioLevel?: number};
				if (stat.type === 'inbound-rtp' && (stat.kind ?? stat.mediaType) === 'audio' &&
					typeof stat.audioLevel === 'number' && Number.isFinite(stat.audioLevel)) audioLevel = stat.audioLevel;
			});
			const track = (element?.srcObject as MediaStream | null)?.getAudioTracks?.()[0];
			const sample: CallAudioSample = {
				elapsed_ms: now - this.startedAt, inbound: readInboundAudio(report), audio_level: audioLevel,
				connection_state: peer?.connectionState, ice_state: peer?.iceConnectionState,
				playback: element ? {
					sink_id: element.sinkId?.slice(0, 256) ?? null, selected_output_id: selectedOutput.slice(0, 256),
					paused: element.paused, muted: element.muted, volume: element.volume,
					ready_state: element.readyState, current_time: element.currentTime, has_stream: !!element.srcObject,
					track_state: track?.readyState, track_muted: track?.muted
				} : null
			};
			this.sampledAt = now;
			this.first ??= sample;
			this.samples.push(sample);
			if (this.samples.length > 12) this.samples.shift();
		} catch { this.failed(); }
	}

	failed(): void { this.errors++; }

	snapshot() {
		return {version: 1, stats_errors: this.errors, first: this.first, samples: [...this.samples],
			last_sample_age_ms: this.sampledAt === null ? null : Date.now() - this.sampledAt};
	}
}
