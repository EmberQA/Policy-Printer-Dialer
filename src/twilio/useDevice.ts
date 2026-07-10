/**
 * useDevice — the Twilio browser softphone (Subplan 03).
 *
 * Mints a Voice access token, registers a Twilio `Device`, and AUTO-ANSWERS the
 * inbound call Retreaver bridged to this agent (Retreaver already selected a ready
 * agent, so there's no "accept?" step — the browser just picks up). It also:
 *   - reports the device registration status (consumed by useHeartbeat so the
 *     backend's computeReady only routes when the Device is actually 'registered'),
 *   - refreshes the token on `tokenWillExpire`,
 *   - signals on_call=true on accept (the page releases it after lead wrap-up),
 *   - exposes the live Call + mute/hangup so the active-call UI can drive it.
 *
 * No outbound dialing, no conference. Mic permission is requested up front (the
 * SDK needs it to answer). Because the dialer auto-answers, there's no per-call
 * click to satisfy the browser's autoplay policy — the UI calls armAudio() from
 * the "Go ready" gesture to grant the mic and resume the SDK's AudioContext so
 * the auto-answered call's audio actually plays. One Device per tab; cleaned up
 * on unmount.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {Call, Device} from '@twilio/voice-sdk';
import {
	getTwilioToken,
	setOnCall,
	setPresence,
	type TwilioDeviceStatus
} from '@/lib/api';
import {
	claimIncomingOwner,
	clearActiveCallOwner,
	clearCallOwner
} from './callOwnership';

export interface ActiveCall {
	/** E.164 / SIP caller number from Twilio params (best-effort). For an OUTBOUND
	 *  call this is the number the agent dialed (the SDK's incoming `From` is the
	 *  agent DID, so we override it with the dialed number from armOutbound). */
	from: string;
	/** Twilio CallSid — ties the lead (Subplan 04) back to dialer_calls. */
	callSid: string;
	muted: boolean;
	/** Epoch ms when the call connected — the UI derives the timer from this. */
	startedAt: number;
	/** 'inbound' (Retreaver-routed or a direct-dial callback) or 'outbound' (agent
	 *  originated via the dialpad). Both arrive at the Device as an incoming leg —
	 *  outbound is distinguished by armOutbound() flagging the next incoming call. */
	direction: 'inbound' | 'outbound';
}

export interface UseDeviceState {
	deviceStatus: TwilioDeviceStatus;
	/** Non-null while a call is connected. */
	activeCall: ActiveCall | null;
	/** Last device/call error message, for surfacing in the UI. */
	error: string | null;
	mute: (muted: boolean) => void;
	hangup: () => void;
	/**
	 * Prime audio from a user gesture. Requests mic permission and resumes the
	 * Twilio SDK's AudioContext so the auto-answered call can play/capture audio
	 * without a per-call click. MUST be called synchronously from a click handler
	 * (e.g. the "Go ready" toggle). Resolves true once audio is armed.
	 */
	armAudio: () => Promise<boolean>;
	/**
	 * Flag the next incoming leg as an OUTBOUND call the agent just placed. The
	 * backend REST-originates the call and bridges the answered customer to this
	 * agent's <Client>, so it arrives via the same `incoming` event as a normal
	 * inbound call — this is how we tell them apart. `toNumber` (the dialed number)
	 * overrides the SDK's `From` (which is the agent DID) so the UI + lead form show
	 * who we called. Cleared once consumed or after a short window if the call never
	 * connects. Call this right after startOutboundCall() resolves SP100.
	 */
	armOutbound: (toNumber: string) => void;
	setInputDevice: (deviceId: string) => Promise<void>;
	setOutputDevice: (deviceId: string) => Promise<void>;
}

export interface UseDeviceOptions {
	/** Gate device setup until a session + provisioning exist. */
	enabled?: boolean;
}

export function useDevice({enabled = true}: UseDeviceOptions = {}): UseDeviceState {
	const [deviceStatus, setDeviceStatus] = useState<TwilioDeviceStatus>('offline');
	const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
	const [error, setError] = useState<string | null>(null);

	const deviceRef = useRef<Device | null>(null);
	const callRef = useRef<Call | null>(null);
	// Set by armOutbound() when the agent places an outbound call; the next incoming
	// leg (the bridged customer) is tagged direction:'outbound' with this dialed number
	// as its `from`. Auto-expires so a call that never connects can't mislabel a later
	// unrelated inbound call.
	const pendingOutboundRef = useRef<{toNumber: string; armedAt: number} | null>(
		null
	);

	const armOutbound = useCallback((toNumber: string) => {
		pendingOutboundRef.current = {toNumber, armedAt: Date.now()};
	}, []);

	const mute = useCallback((muted: boolean) => {
		const call = callRef.current;
		if (!call) return;
		call.mute(muted);
		setActiveCall((prev) => (prev ? {...prev, muted} : prev));
	}, []);

	const hangup = useCallback(() => {
		callRef.current?.disconnect();
	}, []);

	const setInputDevice = useCallback(async (deviceId: string): Promise<void> => {
		const audio = deviceRef.current?.audio;
		if (!audio) {
			throw new Error('Softphone audio is not ready yet.');
		}
		await audio.setInputDevice(deviceId);
	}, []);

	const setOutputDevice = useCallback(async (deviceId: string): Promise<void> => {
		const audio = deviceRef.current?.audio;
		if (!audio) {
			throw new Error('Softphone audio is not ready yet.');
		}
		if (!audio.isOutputSelectionSupported) {
			if (deviceId === 'default') return;
			throw new Error(
				'This browser cannot choose a speaker. Use Chrome or your system output settings.'
			);
		}
		await Promise.all([
			audio.speakerDevices.set(deviceId),
			audio.ringtoneDevices.set(deviceId)
		]);
	}, []);

	// Prime audio from a user gesture. The dialer auto-answers, so there's no
	// per-call click to satisfy the browser's autoplay policy — we pre-arm here
	// on the "Go ready" toggle. Two things must happen inside the gesture:
	//   1) getUserMedia({audio}) — grants mic + primes the input device,
	//   2) AudioContext.resume() — the SDK plays call audio through a shared
	//      AudioContext that starts 'suspended'; browsers only let a gesture
	//      resume it, and until it's running the auto-answered call has no sound.
	const armAudio = useCallback(async (): Promise<boolean> => {
		try {
			// (1) Mic permission + input priming. Release the tracks immediately;
			// the Twilio SDK opens its own stream on accept(). We only needed the
			// permission grant + the user-gesture context.
			const stream = await navigator.mediaDevices.getUserMedia({audio: true});
			stream.getTracks().forEach((t) => t.stop());
		} catch (e) {
			setError(micErrorMessage(e));
			return false;
		}

		// (2) Resume the SDK's AudioContext so playback isn't blocked. The Voice
		// SDK exposes its AudioContext on device.audio; resuming it here (still
		// within the gesture) unblocks the auto-answered call's audio.
		try {
			const audio = deviceRef.current?.audio as
				| {_audioContext?: AudioContext}
				| undefined;
			const ctx = audio?._audioContext;
			if (ctx && ctx.state === 'suspended') {
				await ctx.resume();
			}
		} catch {
			/* non-fatal: mic is granted; playback may still resume on accept */
		}

		return true;
	}, []);

	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		let device: Device | null = null;

		const fetchToken = async (): Promise<string> => {
			const res = await getTwilioToken();
			if (res.statusCode !== 'SP100' || !res.token) {
				throw new Error(res.statusMessage || 'Failed to get Twilio token');
			}
			return res.token;
		};

		/** Wire the per-call listeners + auto-answer. */
		const onIncoming = (call: Call) => {
			const ownership = claimIncomingOwner(callRef.current, call);
			if (!ownership.accepted) {
				// Defense in depth: the server should already have rejected this parent
				// leg, but never let a second SDK event replace ownership of the live call.
				try {
					call.reject();
				} catch {
					/* a canceled leg may already be terminal */
				}
				return;
			}
			callRef.current = ownership.owner;

			call.on('accept', () => {
				if (cancelled) return;
				// If the agent just placed an outbound call (armOutbound), this bridged
				// leg is that call — tag it 'outbound' and show the dialed number (the
				// SDK's `From` here is the agent DID, not the customer). The window guards
				// against a stale flag mislabelling a later unrelated inbound call.
				const pending = pendingOutboundRef.current;
				const isOutbound =
					!!pending && Date.now() - pending.armedAt < OUTBOUND_ARM_WINDOW_MS;
				pendingOutboundRef.current = null;
				setActiveCall({
					from: isOutbound
						? (pending as {toNumber: string}).toNumber
						: call.parameters.From || 'Unknown',
					callSid: call.parameters.CallSid || '',
					muted: false,
					startedAt: Date.now(),
					direction: isOutbound ? 'outbound' : 'inbound'
				});
				// Best-effort: tell the backend we're busy and no longer ready.
				// on_call blocks routing immediately; paused keeps the agent unavailable
				// after wrap-up until they explicitly go ready again.
				void setOnCall(true).catch(() => undefined);
				void setPresence({status: 'paused'}).catch(() => undefined);
			});

			const clearCall = () => {
				if (cancelled) return;
				// Late terminal events from an older leg must not erase the newer call.
				callRef.current = clearCallOwner(callRef.current, call);
				const callSid = call.parameters.CallSid || '';
				setActiveCall((current) => clearActiveCallOwner(current, callSid));
			};
			call.on('disconnect', clearCall);
			call.on('cancel', clearCall);
			call.on('reject', clearCall);
			call.on('error', (e: {message?: string}) => {
				if (cancelled) return;
				setError(e?.message || 'Call error');
				clearCall();
			});

			// AUTO-ANSWER — Retreaver already chose this ready agent.
			call.accept();
		};

		const setup = async () => {
			try {
				// Request mic up front — the SDK needs it to answer. This may
				// resolve without a user gesture if permission was already granted;
				// if the browser blocks it until a gesture, armAudio() (fired from
				// the "Go ready" click) requests it again and surfaces any denial.
				try {
					const stream = await navigator.mediaDevices.getUserMedia({
						audio: true
					});
					stream.getTracks().forEach((t) => t.stop());
				} catch (e) {
					if (cancelled) return;
					setError(micErrorMessage(e));
					// Keep going: register the device anyway so it can receive
					// calls, and let armAudio() re-request the mic on the gesture.
				}
				if (cancelled) return;

				const token = await fetchToken();
				if (cancelled) return;

				device = new Device(token, {
					codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
					allowIncomingWhileBusy: false
				});
				deviceRef.current = device;

				device.on('registered', () => !cancelled && setDeviceStatus('registered'));
				device.on('unregistered', () => !cancelled && setDeviceStatus('offline'));
				device.on('error', (e: {message?: string}) => {
					if (cancelled) return;
					setDeviceStatus('error');
					setError(e?.message || 'Device error');
				});
				device.on('incoming', onIncoming);

				// Refresh the (short-lived) Twilio token before it expires.
				device.on('tokenWillExpire', async () => {
					try {
						const fresh = await fetchToken();
						if (!cancelled) await device?.updateToken(fresh);
					} catch (e) {
						if (!cancelled) setError('Failed to refresh Twilio token');
					}
				});

				setDeviceStatus('connecting');
				await device.register();
			} catch (e) {
				if (cancelled) return;
				setDeviceStatus('error');
				setError(e instanceof Error ? e.message : 'Failed to start softphone');
			}
		};

		void setup();

		return () => {
			cancelled = true;
			try {
				callRef.current?.disconnect();
			} catch {
				/* ignore */
			}
			try {
				device?.destroy();
			} catch {
				/* ignore */
			}
			deviceRef.current = null;
			callRef.current = null;
		};
	}, [enabled]);

	return {
		deviceStatus,
		activeCall,
		error,
		mute,
		hangup,
		armAudio,
		armOutbound,
		setInputDevice,
		setOutputDevice
	};
}

/** How long after armOutbound() an incoming leg is treated as the placed outbound
 *  call. Generous enough to cover ring+answer, short enough that a stale flag can't
 *  mislabel a much-later inbound call. */
const OUTBOUND_ARM_WINDOW_MS = 60_000;

/** Turn a getUserMedia rejection into a user-facing message. */
function micErrorMessage(e: unknown): string {
	const name = (e as {name?: string} | null)?.name;
	switch (name) {
		case 'NotAllowedError':
		case 'SecurityError':
			return 'Microphone access was blocked. Allow the mic in your browser to take calls.';
		case 'NotFoundError':
		case 'DevicesNotFoundError':
			return 'No microphone found. Connect a mic to take calls.';
		case 'NotReadableError':
			return 'Your microphone is in use by another app. Close it and try again.';
		default:
			return (
				(e as {message?: string} | null)?.message ||
				'Could not access your microphone.'
			);
	}
}
