import {useMemo} from 'react';
import {useDialerSession} from '@/session/DialerSessionProvider';
import type {EchoTestState} from './VoiceTransport';

/**
 * What the Audio Setup dialog needs to run the live audio test.
 *
 *   connecting  — the softphone is not up yet; we do not know the carrier, so the test
 *                 cannot start and must not fall back to the local one yet either.
 *   ready       — Telnyx, registered, nothing on the line.
 *   busy        — Telnyx, but a call (or supervision) holds the line.
 *
 * `null` means "use the local echo test": the agent is on Twilio, or the softphone
 * failed to start (an agent must never be stuck behind a required test that cannot run).
 */
export interface LiveEchoControls {
	status: 'connecting' | 'ready' | 'busy';
	start: (onChange: (state: EchoTestState) => void) => Promise<void>;
	cancel: () => void;
}

export function useLiveEchoControls(): LiveEchoControls | null {
	const {device} = useDialerSession();
	const {voiceProvider, deviceStatus, liveEchoAvailable, startLiveEchoTest, cancelLiveEchoTest} = device;
	return useMemo(() => {
		if (voiceProvider === 'twilio' || deviceStatus === 'error') return null;
		const status: LiveEchoControls['status'] =
			voiceProvider !== 'telnyx' || deviceStatus !== 'registered'
				? 'connecting'
				: liveEchoAvailable
					? 'ready'
					: 'busy';
		return {status, start: startLiveEchoTest, cancel: cancelLiveEchoTest};
	}, [voiceProvider, deviceStatus, liveEchoAvailable, startLiveEchoTest, cancelLiveEchoTest]);
}
