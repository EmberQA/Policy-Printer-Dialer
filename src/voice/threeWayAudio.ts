/** Two independent mixes: no participant receives their own remote audio. */
export class ThreeWayAudio {
	private nodes: AudioNode[] = [];
	private outputs: MediaStreamTrack[] = [];
	private senders: Array<{sender: RTCRtpSender; original: MediaStreamTrack | null}> = [];

	constructor(private readonly context: AudioContext) {}

	async connect(
		customerSender: RTCRtpSender,
		calleeSender: RTCRtpSender,
		customerAudio: MediaStream,
		calleeAudio: MediaStream
	): Promise<void> {
		const mic = customerSender.track;
		if (!mic || mic.readyState === 'ended') throw new Error('Agent microphone is unavailable.');
		if (!customerAudio.getAudioTracks().length || !calleeAudio.getAudioTracks().length) {
			throw new Error('Both calls need connected audio before merging.');
		}
		this.senders = [customerSender, calleeSender].map(sender => ({sender, original: sender.track}));
		const makeMix = (remote: MediaStream) => {
			const output = this.context.createMediaStreamDestination();
			const microphone = this.context.createMediaStreamSource(new MediaStream([mic]));
			const otherParty = this.context.createMediaStreamSource(remote);
			microphone.connect(output);
			otherParty.connect(output);
			this.nodes.push(microphone, otherParty, output);
			const track = output.stream.getAudioTracks()[0];
			this.outputs.push(track);
			return track;
		};
		try {
			await customerSender.replaceTrack(makeMix(calleeAudio));
			await calleeSender.replaceTrack(makeMix(customerAudio));
		} catch (error) {
			await this.disconnect();
			throw error;
		}
	}

	async disconnect(restoreCustomer = true, restoreCallee = true): Promise<void> {
		const saved = this.senders;
		const results = await Promise.allSettled(saved.map(({sender, original}, index) =>
			(index === 0 ? restoreCustomer : restoreCallee) ? sender.replaceTrack(original) : Promise.resolve()));
		// Retain failed restorations for cleanup retry, preserving participant order.
		if (results.every(result => result.status === 'fulfilled')) this.senders = [];
		this.nodes.splice(0).forEach(node => node.disconnect());
		this.outputs.splice(0).forEach(track => track.stop());
		// Microphones and remote tracks belong to the SDK; never stop those here.
		if (results.some(result => result.status === 'rejected')) {
			throw new Error('Could not restore call audio. End the test call if audio is missing.');
		}
	}
}
