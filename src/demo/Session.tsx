import {useContext, useMemo, useState, type ReactNode} from 'react';
import {store} from './store';
import {assertSyntheticPhone} from './scope';
import type {ActiveCall} from '../twilio/useDevice';
import {
	DialerSessionContext,
	type DialerSession
} from '../session/DialerSessionProvider';
const noop = () => {};
const asyncNoop = async () => {};
export function DemoSession({children}: {children: ReactNode}) {
	const [activeCall, setCall] = useState<ActiveCall | null>(null);
	const [campaigns, setCampaigns] = useState(store.campaigns);
	const [presence, setPresence] = useState({status: 'paused', on_call: false});
	const [callUiBusy, setCallUiBusy] = useState(false);
	const device = useMemo(
		() => ({
			activeCall,
			apiPingMs: null,
			twilioRttMs: null,
			deviceStatus: 'registered',
			voiceProvider: 'telnyx',
			microphoneBlocked: false,
			speakerBlocked: false,
			participant: null,
			participantNotice: null,
			canAddParticipant: false,
			pendingOutbound: null,
			outboundStarting: null,
			error: null,
			inputDeviceId: 'default',
			outputDeviceId: 'default',
			networkChecking: false,
			liveEchoAvailable: false,
			startOutbound: async (to: string) => {
				assertSyntheticPhone(to);
				setCall({
					from: to,
					callSid: 'recording-active-call',
					campaignId: campaigns[0].id,
					muted: false,
					held: false,
					holdPending: false,
					retreaverUuid: null,
					startedAt: Date.now(),
					direction: 'inbound'
				});
			},
			mute: (muted: boolean) => setCall((c) => (c ? {...c, muted} : c)),
			setHold: async (held: boolean) => setCall((c) => (c ? {...c, held} : c)),
			hangup: () => setCall(null),
			cancelPendingOutbound: asyncNoop,
			armAudio: asyncNoop,
			setInputDevice: asyncNoop,
			setOutputDevice: asyncNoop,
			startLiveEchoTest: asyncNoop,
			cancelLiveEchoTest: noop,
			mergeParticipant: asyncNoop,
			endParticipant: asyncNoop
		}),
		[activeCall, campaigns]
	);
	const value = {
		speakerPauseState: null,
		retrySpeakerPause: noop,
		creditNotification: null,
		device,
		campaigns,
		setCampaigns,
		presence,
		setPresence,
		changePresence: async (status: string) => {
			setPresence({status, on_call: !!activeCall});
			return {
				statusCode: 'SP100',
				presence: {status, on_call: !!activeCall},
				available: 0
			};
		},
		profile: {
			provisioned: true,
			agent: {...store.identity, phone_number: '+12025550100'}
		},
		provisioned: true,
		accessPaused: false,
		bootstrapped: true,
		bootError: null,
		onCall: !!activeCall || callUiBusy,
		setCallUiBusy,
		canDialBase: !activeCall,
		audioCheckComplete: true,
		completeAudioCheck: noop,
		bookingRequired: false,
		completeBooking: asyncNoop,
		heartbeat: {
			connected: true,
			presence,
			available: 0,
			stale: false,
			lastSuccessAt: Date.now()
		},
		whisperNotice: null,
		quoterAccess: false,
		supervisionAvailable: false
	};
	return (
		<DialerSessionContext.Provider value={value as unknown as DialerSession}>
			{children}
		</DialerSessionContext.Provider>
	);
}
export const useDialerSession = (): DialerSession => {
	const session = useContext(DialerSessionContext);
	if (!session) throw new Error('Recording provider required');
	return session;
};
