/**
 * useDevice — the browser softphone (Subplan 03; carrier-neutral since ENG-159
 * Subplan 05).
 *
 * Mints a voice access token, registers a `VoiceTransport` for whichever carrier the
 * BACKEND named in the token response, and AUTO-ANSWERS the inbound call Retreaver
 * bridged to this agent (Retreaver already selected a ready agent, so there's no
 * "accept?" step — the browser just picks up). It also:
 *   - reports the transport registration status (consumed by useHeartbeat so the
 *     backend's computeReady only routes when the client is actually 'registered'),
 *   - signals on_call=true on accept (the page releases it after lead wrap-up),
 *   - exposes the live call + mute/hold/hangup so the active-call UI can drive it.
 *
 * Outbound calls are REST-originated by the backend and arrive here as an exact
 * parent-SID-correlated incoming leg; this hook owns their pending state, local
 * ringback, and cancellation. Mic permission is requested up front because the
 * SDK needs it to answer. One transport per tab; cleaned up on unmount.
 *
 * ⚠️ Everything below the transport boundary is carrier-agnostic ON PURPOSE. The
 * outbound attempt state machine, call ownership, ringback, the answer tone, presence
 * posting and the caller-hangup notices are the bulk of this file and touch no SDK —
 * re-deriving them per provider would be large regression risk for zero benefit. Token
 * refresh and all audio plumbing live in the transport; see voice/VoiceTransport.ts.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {
	cancelOutboundCall,
	getCurrentOutboundCall,
	getVoiceProbeToken,
	getVoiceToken,
	postVoiceFallback,
	recordNetworkTest,
	setOnCall,
	setPresence,
	startOutboundCall,
	type TwilioDeviceStatus
} from '@/lib/api';
import {TelnyxTransport} from '@/voice/TelnyxTransport';
import {TwilioTransport} from '@/voice/TwilioTransport';
import {runNetworkProbe} from '@/voice/networkProbe';
import {readWizardMarker, runNetworkWizard} from '@/voice/networkWizard';
import {shouldRebuildTransport} from '@/voice/providerSync';
import type {
	IncomingLeg,
	VoiceProvider,
	VoiceTransport
} from '@/voice/VoiceTransport';
import {
	claimIncomingOwner,
	clearActiveCallOwner,
	clearCallOwner
} from './callOwnership';
import {
	callerHangupMessage,
	type CallTerminalEvent
} from './callTermination';
import {
	matchesPendingOutbound,
	matchesStartingOutbound,
	readOutboundCallParameters,
	shouldApplyOutboundReconciliation,
	shouldIgnoreExplicitOutbound,
	type PendingOutboundCall,
	type StartingOutboundCall
} from './outboundCallState';
import {InboundAnswerTone} from './inboundAnswerTone';
import {OutboundRingback} from './outboundRingback';

export type {PendingOutboundCall} from './outboundCallState';

export interface ActiveCall {
	/** E.164 / SIP caller number from Twilio params (best-effort). For an OUTBOUND
	 *  call this is the number the agent dialed (the SDK's incoming `From` is the
	 *  agent DID, so we override it with the backend-supplied dialed number). */
	from: string;
	/** Parent Twilio CallSid — ties the lead (Subplan 04) back to dialer_calls. */
	callSid: string;
	/** Browser Client-leg CallSid, retained to ignore terminal events from stale legs. */
	clientCallSid?: string;
	/** Internal EmberQA campaign UUID carried on the inbound Client invite. Null for
	 * direct-DID and outbound calls that have no routed campaign attribution. */
	campaignId: string | null;
	muted: boolean;
	/** Browser-side hold keeps the call connected while replacing the microphone
	 * with music and silencing caller playback for the agent. */
	held: boolean;
	holdPending: boolean;
	/** Epoch ms when the call connected — the UI derives the timer from this. */
	startedAt: number;
	/** 'inbound' (Retreaver-routed or a direct-dial callback) or 'outbound' (agent
	 *  originated via the dialpad). Both arrive at the Device as an incoming leg. */
	direction: 'inbound' | 'outbound';
}

export interface UseDeviceState {
	deviceStatus: TwilioDeviceStatus;
	/** Non-null while a call is connected. */
	activeCall: ActiveCall | null;
	/** Live WebRTC round-trip time to Twilio, available during an active call. */
	twilioRttMs: number | null;
	/** HTTP response time to api.emberqa.com while no call is active. */
	apiPingMs: number | null;
	/** Last device/call error message, for surfacing in the UI. */
	error: string | null;
	/**
	 * The network wizard is running (ENG-159 Subplan 07). The ONLY thing it may put on
	 * screen is a neutral "Finding the best connection…" line — never a carrier name,
	 * never a network tier, and never a notice that a switch happened. The agent has no
	 * action to take on any of that, so surfacing it can only produce a support ticket
	 * about a system that is working correctly.
	 */
	networkChecking: boolean;
	/** Short-lived notice when a remote inbound caller ends the call. */
	callerHangupNotice: {id: number; message: string} | null;
	dismissCallerHangupNotice: () => void;
	/** REST start is in flight; it becomes pending once the exact parent SID exists. */
	outboundStarting: StartingOutboundCall | null;
	/** Exact parent-leg state while the customer is being called. */
	pendingOutbound: PendingOutboundCall | null;
	mute: (muted: boolean) => void;
	setHold: (held: boolean) => Promise<void>;
	hangup: () => void;
	/**
	 * Prime audio from a user gesture. Requests mic permission and resumes the
	 * Twilio SDK's AudioContext so the auto-answered call can play/capture audio
	 * without a per-call click. MUST be called synchronously from a click handler
	 * (e.g. the "Go ready" toggle). Resolves true once audio is armed.
	 */
	armAudio: () => Promise<boolean>;
	/** Start a shared outbound attempt and local ringback from the click gesture. */
	startOutbound: (toNumber: string) => Promise<void>;
	/** Stop the exact pending parent leg. Safe against answer/callback races. */
	cancelPendingOutbound: () => Promise<void>;
	/** Microphone currently selected for Twilio calls and local audio checks. */
	inputDeviceId: string;
	/** Speaker currently selected for Twilio calls and local audio checks. */
	outputDeviceId: string;
	setInputDevice: (deviceId: string) => Promise<void>;
	setOutputDevice: (deviceId: string) => Promise<void>;
	/**
	 * Tell the softphone which carrier the SERVER has this agent on (fed from the
	 * heartbeat). A mismatch with the live transport rebuilds it — that is how a switch
	 * made in the admin panel reaches a session that is already running, instead of
	 * waiting for the agent to happen to reload. No-ops while a call is up.
	 *
	 * Stable identity, safe to call on every beat.
	 */
	reportServerProvider: (provider: VoiceProvider | null) => void;
}

export interface UseDeviceOptions {
	/** Gate device setup until a session + provisioning exist. */
	enabled?: boolean;
	/** Backend capability gate. Inbound stays usable during a backend-first deploy,
	 * but outbound must not start against the legacy partial contract. */
	outboundLifecycleEnabled?: boolean;
}

export function useDevice({
	enabled = true,
	outboundLifecycleEnabled = false
}: UseDeviceOptions = {}): UseDeviceState {
	const [deviceStatus, setDeviceStatus] =
		useState<TwilioDeviceStatus>('offline');
	const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
	const [twilioRttMs, setTwilioRttMs] = useState<number | null>(null);
	const [apiPingMs, setApiPingMs] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [callerHangupNotice, setCallerHangupNotice] = useState<{
		id: number;
		message: string;
	} | null>(null);
	const [outboundStarting, setOutboundStarting] =
		useState<StartingOutboundCall | null>(null);
	const [pendingOutbound, setPendingOutbound] =
		useState<PendingOutboundCall | null>(null);
	const [inputDeviceId, setInputDeviceId] = useState('default');
	const [outputDeviceId, setOutputDeviceId] = useState('default');
	/** The one thing the network wizard is allowed to put on screen (Subplan 07). It
	 *  drives a neutral "Finding the best connection…" line and nothing else — no carrier
	 *  name, no tier, no notice that a switch happened. */
	const [networkChecking, setNetworkChecking] = useState(false);
	/**
	 * Bumped when the wizard moves this agent AFTER the softphone is already up (the
	 * network-change demotion path). It is in the setup effect's dependency array, so a
	 * bump tears the transport down and rebuilds it against a freshly-minted token for the
	 * new carrier — reusing the cleanup that already exists rather than hand-rolling a
	 * second teardown that would drift from it.
	 */
	const [voiceEpoch, setVoiceEpoch] = useState(0);

	/**
	 * Which carrier the LIVE transport was actually built against. Compared with what the
	 * server reports on each heartbeat to notice a switch made outside this browser (an
	 * administrator moving the agent in the EmberQA panel).
	 *
	 * Hook-scoped rather than effect-scoped like `activeVoice`, because the comparison is
	 * driven from outside the setup effect — the effect is precisely what it needs to
	 * restart.
	 */
	const builtVoiceProviderRef = useRef<VoiceProvider | null>(null);

	const transportRef = useRef<VoiceTransport | null>(null);
	const callRef = useRef<IncomingLeg | null>(null);
	const locallyEndedCallRef = useRef<IncomingLeg | null>(null);
	const callerHangupNoticeIdRef = useRef(0);
	const callerHangupNoticeTimerRef = useRef<number | null>(null);
	const outboundStartingRef = useRef<StartingOutboundCall | null>(null);
	const pendingOutboundRef = useRef<PendingOutboundCall | null>(null);
	const inputDeviceIdRef = useRef('default');
	const outputDeviceIdRef = useRef('default');
	const ringbackRef = useRef<OutboundRingback | null>(null);
	const answerToneRef = useRef<InboundAnswerTone | null>(null);
	const outboundReconcileSequenceRef = useRef(0);
	/** True while the transport is holding the call. Mirrors the old controller ref. */
	const heldRef = useRef(false);
	const holdTransitionRef = useRef(false);
	const preHoldMutedRef = useRef<boolean | null>(null);

	/**
	 * The server says this agent is on a different carrier than the transport we built —
	 * rebuild against the right one.
	 *
	 * This is how an ADMIN switch reaches a running dialer. Without it, an agent whose
	 * network was moved in the admin panel keeps a softphone registered on the carrier
	 * they just left: their DID has moved, Retreaver has been re-pointed at it, and the
	 * bridge has nobody to hand the call to. The backend pauses them at the moment of the
	 * switch to close that window immediately; this is what makes going Ready again safe.
	 *
	 * NEVER MID-CALL — a rebuild tears the transport down, which would drop the very call
	 * the switch was forbidden from interrupting. Nothing is queued: the heartbeat repeats
	 * this every ~5s, so the mismatch is simply noticed again once the call ends. A
	 * repeating signal needs no pending state, and pending state is how you end up
	 * rebuilding against a carrier that has since changed again.
	 *
	 * The ref is updated optimistically so the beats landing during the rebuild do not
	 * each bump the epoch again.
	 */
	const reportServerProvider = useCallback(
		(provider: VoiceProvider | null): void => {
			const shouldRebuild = shouldRebuildTransport({
				built: builtVoiceProviderRef.current,
				reported: provider,
				hasActiveCall: callRef.current !== null
			});
			if (!shouldRebuild || !provider) return;
			builtVoiceProviderRef.current = provider;
			setVoiceEpoch((epoch) => epoch + 1);
		},
		[]
	);

	const dismissCallerHangupNotice = useCallback(() => {
		if (callerHangupNoticeTimerRef.current !== null) {
			window.clearTimeout(callerHangupNoticeTimerRef.current);
			callerHangupNoticeTimerRef.current = null;
		}
		setCallerHangupNotice(null);
	}, []);

	const showCallerHangupNotice = useCallback((message: string) => {
		if (callerHangupNoticeTimerRef.current !== null) {
			window.clearTimeout(callerHangupNoticeTimerRef.current);
		}
		callerHangupNoticeIdRef.current += 1;
		const id = callerHangupNoticeIdRef.current;
		setCallerHangupNotice({id, message});
		callerHangupNoticeTimerRef.current = window.setTimeout(() => {
			callerHangupNoticeTimerRef.current = null;
			setCallerHangupNotice((current) => (current?.id === id ? null : current));
		}, CALLER_HANGUP_NOTICE_MS);
	}, []);

	const updatePendingOutbound = useCallback(
		(next: PendingOutboundCall | null) => {
			pendingOutboundRef.current = next;
			setPendingOutbound(next);
		},
		[]
	);

	const updateOutboundStarting = useCallback(
		(next: StartingOutboundCall | null) => {
			outboundStartingRef.current = next;
			setOutboundStarting(next);
		},
		[]
	);

	const clearHoldAudio = useCallback(async (): Promise<void> => {
		const wasHeld = heldRef.current;
		heldRef.current = false;
		holdTransitionRef.current = false;
		preHoldMutedRef.current = null;
		if (!wasHeld) return;
		try {
			await transportRef.current?.stopHold();
		} catch {
			// The call is already ending; transport.destroy() is the final cleanup boundary.
		}
	}, []);

	const mute = useCallback((muted: boolean) => {
		const call = callRef.current;
		if (!call || heldRef.current || holdTransitionRef.current) return;
		call.mute(muted);
		setActiveCall((prev) => (prev ? {...prev, muted} : prev));
	}, []);

	const setHold = useCallback(async (held: boolean): Promise<void> => {
		const call = callRef.current;
		const transport = transportRef.current;
		if (!call || !transport) {
			throw new Error('There is no active call to place on hold.');
		}
		if (holdTransitionRef.current) return;

		const updateOwnedCall = (patch: Partial<ActiveCall>) => {
			setActiveCall((current) =>
				callRef.current === call && current ? {...current, ...patch} : current
			);
		};

		if (held) {
			if (heldRef.current) return;
			holdTransitionRef.current = true;
			setError(null);
			updateOwnedCall({holdPending: true});

			const wasMuted = call.isMuted();
			preHoldMutedRef.current = wasMuted;
			// Mute applies after processing, so it must be off for the generated music
			// stream to reach the carrier. The prior state is restored on Resume.
			call.mute(false);
			updateOwnedCall({muted: false});

			try {
				heldRef.current = true;
				await transport.startHold();
				if (callRef.current !== call || !heldRef.current) {
					await transport.stopHold().catch(() => undefined);
					heldRef.current = false;
					return;
				}
				updateOwnedCall({held: true, holdPending: false});
			} catch (holdError) {
				heldRef.current = false;
				await transport.stopHold().catch(() => undefined);
				if (callRef.current === call) {
					call.mute(wasMuted);
					updateOwnedCall({
						held: false,
						holdPending: false,
						muted: wasMuted
					});
					setError(
						holdError instanceof Error
							? holdError.message
							: 'Could not start hold music'
					);
				}
				throw holdError;
			} finally {
				holdTransitionRef.current = false;
			}
			return;
		}

		if (!heldRef.current) return;
		holdTransitionRef.current = true;
		setError(null);
		updateOwnedCall({holdPending: true});
		try {
			await transport.stopHold();
			if (callRef.current !== call || !heldRef.current) {
				return;
			}
			heldRef.current = false;
			const restoreMuted = preHoldMutedRef.current ?? false;
			preHoldMutedRef.current = null;
			call.mute(restoreMuted);
			updateOwnedCall({
				held: false,
				holdPending: false,
				muted: restoreMuted
			});
		} catch (resumeError) {
			if (callRef.current === call) {
				updateOwnedCall({held: true, holdPending: false});
				setError(
					resumeError instanceof Error
						? resumeError.message
						: 'Could not resume call audio'
				);
			}
			throw resumeError;
		} finally {
			holdTransitionRef.current = false;
		}
	}, []);

	const hangup = useCallback(() => {
		const call = callRef.current;
		if (!call) return;
		locallyEndedCallRef.current = call;
		call.disconnect();
	}, []);

	const setInputDevice = useCallback(
		async (deviceId: string): Promise<void> => {
			const transport = transportRef.current;
			if (!transport) {
				throw new Error('Softphone audio is not ready yet.');
			}
			await transport.setInputDevice(deviceId);
			inputDeviceIdRef.current = deviceId;
			setInputDeviceId(deviceId);
		},
		[]
	);

	const setOutputDevice = useCallback(
		async (deviceId: string): Promise<void> => {
			const transport = transportRef.current;
			if (!transport) {
				throw new Error('Softphone audio is not ready yet.');
			}
			await transport.setOutputDevice(deviceId);
			outputDeviceIdRef.current = deviceId;
			setOutputDeviceId(deviceId);
			// The local ringback and answer tone are our own graphs, not the carrier's,
			// so they follow the selection independently on both providers.
			ringbackRef.current?.setOutputDevice(deviceId);
			answerToneRef.current?.setOutputDevice(deviceId);
		},
		[]
	);

	const armAnswerTone = useCallback(() => {
		const tone = answerToneRef.current ?? new InboundAnswerTone();
		answerToneRef.current = tone;
		tone.arm(outputDeviceIdRef.current);
	}, []);

	// Prime audio from a user gesture. The dialer auto-answers, so there's no
	// per-call click to satisfy the browser's autoplay policy — we pre-arm here
	// on the "Go ready" toggle. Three things must happen inside the gesture:
	//   1) keep the local post-answer tone silently active,
	//   2) getUserMedia({audio}) — grants mic + primes the input device,
	//   3) transport.armAudio() — unblock carrier playback. What that MEANS differs by
	//      provider (Twilio resumes a shared AudioContext, Telnyx plays its remote
	//      media element), which is exactly why it sits behind the transport.
	const armAudio = useCallback(async (): Promise<boolean> => {
		// This must happen before the first await so audio.play() is called directly
		// inside the Ready-button gesture. It is a separate local graph and never
		// replaces or delays Twilio's microphone or speaker streams.
		armAnswerTone();

		try {
			// (2) Mic permission + input priming. Release the tracks immediately;
			// the Twilio SDK opens its own stream on accept(). We only needed the
			// permission grant + the user-gesture context.
			const selectedInputDeviceId = inputDeviceIdRef.current;
			const stream = await navigator.mediaDevices.getUserMedia({
				audio:
					selectedInputDeviceId === 'default'
						? true
						: {deviceId: {exact: selectedInputDeviceId}}
			});
			stream.getTracks().forEach((t) => t.stop());
		} catch (e) {
			setError(micErrorMessage(e));
			return false;
		}

		// (3) Unblock carrier playback, still within the gesture, so the auto-answered
		// call has sound without a second click.
		try {
			await transportRef.current?.armAudio();
		} catch {
			/* non-fatal: mic is granted; playback may still resume on accept */
		}

		return true;
	}, [armAnswerTone]);

	const stopRingback = useCallback(() => {
		ringbackRef.current?.stop();
		ringbackRef.current = null;
	}, []);

	const ensureRingback = useCallback(() => {
		if (ringbackRef.current) return;
		const ringback = new OutboundRingback();
		ringbackRef.current = ringback;
		ringback.start(outputDeviceIdRef.current);
	}, []);

	const clearOutboundAttempt = useCallback(() => {
		// Invalidate any status request that started before this clear. Its response
		// must not recreate a canceled/answered attempt or overwrite the next call.
		outboundReconcileSequenceRef.current += 1;
		stopRingback();
		updatePendingOutbound(null);
		updateOutboundStarting(null);
		clearStoredOutboundAttempt();
	}, [stopRingback, updateOutboundStarting, updatePendingOutbound]);

	const reconcileAuthoritativeOutbound = useCallback(
		async (attemptId?: string | null): Promise<PendingOutboundCall | null> => {
			const requestAttemptId =
				attemptId ||
				pendingOutboundRef.current?.attemptId ||
				outboundStartingRef.current?.attemptId;
			if (!requestAttemptId) return null;

			const requestSequence = ++outboundReconcileSequenceRef.current;
			const res = await getCurrentOutboundCall(requestAttemptId);
			const currentStarting = outboundStartingRef.current;
			const currentPending = pendingOutboundRef.current;
			if (
				!shouldApplyOutboundReconciliation(
					requestAttemptId,
					res.attempt_id,
					requestSequence,
					outboundReconcileSequenceRef.current,
					currentPending,
					currentStarting
				)
			) {
				return null;
			}
			if (res.statusCode !== 'SP100' || !res.state) {
				throw new Error(res.statusMessage || 'Could not confirm call status');
			}

			if (res.state === 'starting' && res.owned) {
				const recoveredAttemptId = res.attempt_id || requestAttemptId;
				if (!recoveredAttemptId) {
					throw new Error(
						'Backend returned a starting call without an attempt id'
					);
				}
				updateOutboundStarting({
					attemptId: recoveredAttemptId,
					toNumber: currentStarting?.toNumber || 'Unknown number',
					startedAt: currentStarting?.startedAt ?? Date.now(),
					canceling: currentStarting?.canceling ?? false,
					reconciling: false
				});
				return null;
			}

			if (
				(res.state === 'ringing' || res.state === 'active') &&
				res.owned &&
				res.call_sid
			) {
				const recoveredAttemptId = res.attempt_id || requestAttemptId;
				if (!recoveredAttemptId) {
					throw new Error(
						'Backend returned an outbound call without an attempt id'
					);
				}
				const pending: PendingOutboundCall = {
					attemptId: recoveredAttemptId,
					callSid: res.call_sid,
					toNumber:
						res.to_number ||
						currentPending?.toNumber ||
						currentStarting?.toNumber ||
						'Unknown number',
					startedAt:
						(res.started_at ? Date.parse(res.started_at) : Number.NaN) ||
						currentPending?.startedAt ||
						currentStarting?.startedAt ||
						Date.now(),
					canceling: currentPending?.canceling ?? false,
					reconciling: false
				};
				updateOutboundStarting(null);
				updatePendingOutbound(pending);
				if (res.state === 'active' || pending.canceling) stopRingback();
				else ensureRingback();
				return pending;
			}

			clearOutboundAttempt();
			return null;
		},
		[
			clearOutboundAttempt,
			ensureRingback,
			stopRingback,
			updateOutboundStarting,
			updatePendingOutbound
		]
	);

	const startOutbound = useCallback(
		async (toNumber: string): Promise<void> => {
			if (!outboundLifecycleEnabled) {
				throw new Error(
					'Outbound calling is waiting for the required backend update.'
				);
			}
			if (
				outboundStartingRef.current ||
				pendingOutboundRef.current ||
				callRef.current
			) {
				throw new Error('Another call is already in progress.');
			}

			void armAudio();
			ensureRingback();
			const attemptId = newOutboundAttemptId();
			const starting: StartingOutboundCall = {
				attemptId,
				toNumber,
				startedAt: Date.now(),
				canceling: false,
				reconciling: false
			};
			updateOutboundStarting(starting);
			storeOutboundAttempt(starting);
			setError(null);

			try {
				const res = await startOutboundCall(toNumber, attemptId);
				const currentAttempt =
					outboundStartingRef.current as StartingOutboundCall | null;
				if (!currentAttempt || currentAttempt.attemptId !== attemptId) return;
				if (res.statusCode !== 'SP100') {
					clearOutboundAttempt();
					throw new DefinitiveOutboundStartError(
						res.statusMessage || 'Could not place the call'
					);
				}
				if (!res.call_sid) {
					throw new AmbiguousOutboundStartError(
						res.statusMessage ||
							'The call started without returning its call id'
					);
				}
				updatePendingOutbound({
					attemptId: res.attempt_id || attemptId,
					callSid: res.call_sid,
					toNumber,
					startedAt: Date.now(),
					canceling: currentAttempt.canceling,
					reconciling: false
				});
				updateOutboundStarting(null);
			} catch (err) {
				const currentAttempt =
					outboundStartingRef.current as StartingOutboundCall | null;
				const currentPending =
					pendingOutboundRef.current as PendingOutboundCall | null;
				if (
					currentAttempt?.attemptId !== attemptId &&
					currentPending?.attemptId !== attemptId
				) {
					return;
				}
				const backendResponded = Boolean(
					(err as {response?: unknown} | null)?.response
				);
				if (
					(backendResponded || err instanceof DefinitiveOutboundStartError) &&
					!(err instanceof AmbiguousOutboundStartError)
				) {
					clearOutboundAttempt();
					const message =
						err instanceof Error ? err.message : 'Could not place the call';
					setError(message);
					throw err;
				}

				stopRingback();
				updateOutboundStarting({
					...starting,
					reconciling: true
				});
				setError('The start response was interrupted. Confirming call status…');
				try {
					await reconcileAuthoritativeOutbound(attemptId);
				} catch {
					setError(
						'Call status is temporarily unknown. Use Cancel while the dialer keeps checking.'
					);
					return;
				}
				if (!outboundStartingRef.current && !pendingOutboundRef.current) {
					const message =
						err instanceof Error ? err.message : 'Could not place the call';
					setError(message);
					throw err;
				}
				setError(null);
			}
		},
		[
			armAudio,
			clearOutboundAttempt,
			ensureRingback,
			outboundLifecycleEnabled,
			reconcileAuthoritativeOutbound,
			stopRingback,
			updateOutboundStarting,
			updatePendingOutbound
		]
	);

	const cancelPendingOutbound = useCallback(async (): Promise<void> => {
		const pending = pendingOutboundRef.current;
		const starting = outboundStartingRef.current;
		if ((!pending && !starting) || pending?.canceling || starting?.canceling)
			return;

		if (pending) {
			updatePendingOutbound({
				...pending,
				canceling: true,
				reconciling: true
			});
		} else if (starting) {
			updateOutboundStarting({
				...starting,
				canceling: true,
				reconciling: true
			});
		}
		stopRingback();
		setError(null);
		const attemptId = pending?.attemptId ?? starting?.attemptId ?? null;
		try {
			const res = await cancelOutboundCall({
				callSid: pending?.callSid,
				attemptId
			});
			if (res.statusCode !== 'SP100') {
				throw new Error(res.statusMessage || 'Could not cancel the call');
			}
			clearOutboundAttempt();
		} catch (err) {
			// A failed/lost cancel response is ambiguous. Never manufacture fresh audio
			// from the catch path; provider-backed status decides whether it is ringing.
			if (pendingOutboundRef.current) {
				updatePendingOutbound({
					...pendingOutboundRef.current,
					canceling: false,
					reconciling: true
				});
			}
			if (outboundStartingRef.current) {
				updateOutboundStarting({
					...outboundStartingRef.current,
					canceling: false,
					reconciling: true
				});
			}
			if (!pendingOutboundRef.current && !outboundStartingRef.current) {
				setError('The customer connected before cancellation completed.');
				return;
			}
			try {
				await reconcileAuthoritativeOutbound(attemptId);
			} catch {
				const message =
					err instanceof Error ? err.message : 'Could not cancel the call';
				setError(`${message}. Call status is still being confirmed.`);
				throw err;
			}
			if (pendingOutboundRef.current || outboundStartingRef.current) {
				const message =
					err instanceof Error ? err.message : 'Could not cancel the call';
				setError(`${message}. The call is still active.`);
				throw err;
			}
		}
	}, [
		clearOutboundAttempt,
		reconcileAuthoritativeOutbound,
		stopRingback,
		updateOutboundStarting,
		updatePendingOutbound
	]);
	// Keep refs and React state aligned when provisioning/device enablement changes.
	// The durable sessionStorage attempt is intentionally retained so re-enable can
	// recover it from the backend instead of presenting a false idle state.
	useEffect(() => {
		if (enabled) return;
		stopRingback();
		outboundStartingRef.current = null;
		pendingOutboundRef.current = null;
		setOutboundStarting(null);
		setPendingOutbound(null);
		setActiveCall(null);
		setTwilioRttMs(null);
		setApiPingMs(null);
		setDeviceStatus('offline');
	}, [enabled, stopRingback]);

	// Recover after reload and keep every starting/ringing attempt bounded by an
	// authoritative provider-backed watchdog. sessionStorage is per-tab, so another
	// tab registered under the same Twilio identity does not become an owner. The
	// watchdog schedules its next pass only after the current pass finishes, so status
	// requests cannot overlap and return out of order.
	useEffect(() => {
		if (!enabled || !outboundLifecycleEnabled) return;
		let cancelled = false;
		let timer: number | null = null;
		const stored = readStoredOutboundAttempt();
		if (
			stored &&
			!outboundStartingRef.current &&
			!pendingOutboundRef.current &&
			!callRef.current
		) {
			updateOutboundStarting({...stored, reconciling: true});
		}

		const reconcile = async () => {
			if (cancelled) return;
			if (callRef.current) {
				scheduleNext();
				return;
			}
			const starting = outboundStartingRef.current;
			const pending = pendingOutboundRef.current;
			const attemptId = pending?.attemptId ?? starting?.attemptId;
			if (!attemptId) {
				scheduleNext();
				return;
			}
			try {
				await reconcileAuthoritativeOutbound(attemptId);
			} catch {
				if (cancelled) return;
				const currentPending = pendingOutboundRef.current;
				const currentStarting = outboundStartingRef.current;
				if (currentPending) {
					updatePendingOutbound({...currentPending, reconciling: true});
				}
				if (currentStarting) {
					updateOutboundStarting({...currentStarting, reconciling: true});
				}
				const startedAt =
					currentPending?.startedAt ?? currentStarting?.startedAt;
				if (startedAt && Date.now() - startedAt >= OUTBOUND_RINGBACK_MAX_MS) {
					stopRingback();
					setError(
						'Call status cannot be confirmed. Ringback is muted; Cancel remains available.'
					);
				}
			} finally {
				scheduleNext();
			}
		};

		function scheduleNext() {
			if (cancelled) return;
			timer = window.setTimeout(() => void reconcile(), OUTBOUND_WATCHDOG_MS);
		}

		void reconcile();
		return () => {
			cancelled = true;
			// A response may still arrive after logout, capability disablement, or
			// unmount. Make it stale before it can write outbound state back.
			outboundReconcileSequenceRef.current += 1;
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [
		enabled,
		outboundLifecycleEnabled,
		reconcileAuthoritativeOutbound,
		stopRingback,
		updateOutboundStarting,
		updatePendingOutbound
	]);

	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		let transport: VoiceTransport | null = null;
		let apiPingTimer: number | null = null;
		let apiPingController: AbortController | null = null;
		/** What the live transport was built from — the wizard's input on a re-test. */
		let activeVoice: {
			provider: VoiceProvider;
			providerLocked: boolean;
			token: string;
		} | null = null;
		let networkChangeBusy = false;

		/**
		 * A network change is the one event that means "this agent may be broken RIGHT
		 * NOW", so it re-tests. Reentrancy is guarded because `online` and `connection
		 * change` routinely fire together on the same physical event, and two overlapping
		 * probes would race to flip the same agent.
		 */
		const onNetworkChange = (): void => {
			if (cancelled || !activeVoice || networkChangeBusy) return;
			networkChangeBusy = true;
			void (async () => {
				try {
					// MINT A FRESH TOKEN TO PROBE WITH — never reuse the boot token.
					//
					// ⚠️ A dialer tab routinely outlives its token. Telnyx tokens last 24h,
					// the transport quietly renews its OWN copy, and the boot value captured
					// here is never updated — so in any tab older than a day this probe would
					// register with an expired JWT, fail the `registration` stage, fail it
					// again on the retry (same token), and demote a perfectly healthy agent
					// onto the fallback network. Waking a laptop fires `online`, so the
					// population is "anyone who did not reload since yesterday". It also
					// poisons the rollout numbers, recording a provisioning-shaped failure
					// for a network that is fine. One round trip on a rare path avoids all
					// of it — and picks up an admin pin applied since boot for free.
					const fresh = await fetchToken();
					if (cancelled) return;
					const moved = await runWizard(fresh, 'network-change');
					// Bumping the epoch re-runs this whole effect: teardown, fresh token,
					// new transport. The session marker written by the flip makes the boot
					// wizard skip on that re-run, so this cannot loop.
					if (!cancelled && moved) setVoiceEpoch((epoch) => epoch + 1);
				} catch {
					// A token we could not mint says nothing about the agent's network.
					// Leave them exactly where they are.
				} finally {
					networkChangeBusy = false;
				}
			})();
		};

		/**
		 * Mint a token AND learn which carrier it is for. The provider comes from the
		 * backend (`dialer_agents.voice_provider`) — the browser never chooses — which
		 * is what makes flipping an agent a server-side config change.
		 */
		const fetchToken = async (): Promise<{
			token: string;
			provider: VoiceProvider;
			providerLocked: boolean;
		}> => {
			const res = await getVoiceToken();
			if (res.statusCode !== 'SP100' || !res.token) {
				throw new Error(res.statusMessage || 'Failed to get voice token');
			}
			// Default to twilio when the field is absent: an agent who has never been
			// flipped is on Twilio, so this fails safe rather than failing closed.
			return {
				token: res.token,
				provider: res.provider ?? 'twilio',
				// Absent ⇒ unpinned. An older backend that does not send this must not
				// silently freeze every agent's network.
				providerLocked: res.provider_locked === true
			};
		};

		/**
		 * The wizard's IO, in one place so both entry points (boot and network change) run
		 * the identical machine. Every call here is best-effort by contract: none of it may
		 * take out the dialer boot it sits in front of.
		 */
		const wizardIo = {
			getProbeToken: async (): Promise<string | null> => {
				const res = await getVoiceProbeToken();
				// A refusal is the ORDINARY answer — it means "not a promotion candidate"
				// (already on Primary, administrator-pinned, or never provisioned on
				// Primary) and is never surfaced to the agent.
				return res.statusCode === 'SP100' && res.token ? res.token : null;
			},
			runProbe: (token: string) => runNetworkProbe(token),
			postFallback: async (
				provider: VoiceProvider,
				diagnostics: Record<string, unknown>
			): Promise<boolean> => {
				const res = await postVoiceFallback(provider, diagnostics);
				return res.ok === true;
			},
			recordTest: async (payload: {
				passed: boolean;
				direction: 'stay' | 'promote' | 'demote';
				failedStage?: string | null;
				detail?: Record<string, unknown>;
			}): Promise<void> => {
				await recordNetworkTest({
					passed: payload.passed,
					direction: payload.direction,
					failed_stage: payload.failedStage ?? null,
					detail: payload.detail
				}).catch(() => undefined);
			}
		};

		/**
		 * Decide which network this agent should be on, and move them if needed.
		 *
		 * Returns the carrier they were moved to, or null. At boot this runs BEFORE the
		 * transport is built, so the softphone is never live on a carrier we are about to
		 * move them off — and there is exactly one transport build in the common case.
		 */
		const runWizard = async (
			current: {provider: VoiceProvider; providerLocked: boolean; token: string},
			trigger: 'boot' | 'network-change'
		): Promise<VoiceProvider | null> => {
			const marker = readWizardMarker();
			setNetworkChecking(true);
			try {
				const outcome = await runNetworkWizard(
					{
						provider: current.provider,
						providerLocked: current.providerLocked,
						trigger,
						hasActiveCall: callRef.current !== null,
						demotedThisSession: marker.demoted === true,
						promotedThisSession: marker.promoted === true
					},
					current.token,
					wizardIo
				);
				return outcome.flippedTo;
			} finally {
				if (!cancelled) setNetworkChecking(false);
			}
		};

		/** Time a cache-bypassed request to EmberQA without backend auth or DB work. */
		const probeApi = async () => {
			if (cancelled || callRef.current) return;
			const controller = new AbortController();
			apiPingController?.abort();
			apiPingController = controller;
			const timeout = window.setTimeout(
				() => controller.abort(),
				API_PING_TIMEOUT_MS
			);
			const startedAt = performance.now();

			try {
				await fetch(`https://api.emberqa.com/?dialer-ping=${Date.now()}`, {
					method: 'HEAD',
					cache: 'no-store',
					signal: controller.signal
				});
				if (!cancelled) {
					setApiPingMs(Math.max(0, Math.round(performance.now() - startedAt)));
				}
			} catch {
				if (!cancelled && apiPingController === controller) {
					setApiPingMs(null);
				}
			} finally {
				window.clearTimeout(timeout);
				if (apiPingController === controller) {
					apiPingController = null;
				}
			}
		};

		/** Wire the per-call listeners + auto-answer. */
		const onIncoming = (call: IncomingLeg) => {
			const outboundParams = readOutboundCallParameters(call.params);
			const isPendingOutbound = matchesPendingOutbound(
				pendingOutboundRef.current,
				outboundParams
			);
			const mayMatchStartingOutbound = matchesStartingOutbound(
				outboundStartingRef.current,
				outboundParams
			);

			// An explicitly outbound child leg belongs only to the tab holding the exact
			// parent SID/attempt. Ignore other-tab copies locally: reject() would send a
			// provider hangup and terminate the real owner's call.
			if (
				shouldIgnoreExplicitOutbound(
					pendingOutboundRef.current,
					outboundStartingRef.current,
					outboundParams
				)
			) {
				try {
					call.ignore();
				} catch {
					/* the parent may already be terminal */
				}
				return;
			}

			const ownership = claimIncomingOwner(callRef.current, call);
			if (!ownership.accepted) {
				// Defense in depth: the server should already have rejected this parent
				// leg, but never let a second SDK event replace ownership of the live call.
				try {
					if (outboundParams.isExplicitOutbound) call.ignore();
					else call.reject();
				} catch {
					/* a canceled leg may already be terminal */
				}
				return;
			}
			callRef.current = ownership.owner;
			const ownsOutboundInvite = isPendingOutbound || mayMatchStartingOutbound;
			let acceptedDirection: ActiveCall['direction'] | null = null;
			let terminalHandled = false;

			call.on('accept', () => {
				if (cancelled) return;
				// Exact backend-supplied parent SID + direction identifies the outbound
				// customer bridge without timing heuristics.
				const pending = pendingOutboundRef.current;
				const starting = outboundStartingRef.current;
				const isOutbound =
					ownsOutboundInvite || matchesPendingOutbound(pending, outboundParams);
				acceptedDirection = isOutbound ? 'outbound' : 'inbound';
				if (isOutbound) {
					clearOutboundAttempt();
				} else if (pending || starting) {
					// Backend ownership prevents a genuine inbound/outbound overlap. If a
					// stale local attempt survived long enough to accept an inbound call,
					// the accepted live call wins and all local ringback/busy state is reset.
					clearOutboundAttempt();
				}
				// `legId` is the browser leg. The bridge markup passes the parent SID so a
				// lead save associates with the durable dialer_calls record created for
				// this call instead of materializing a second row — on both carriers,
				// where it arrives as <Parameter> and as X-Parent-Call-Sid respectively.
				const parentCallSid = call.params.parent_call_sid;
				setActiveCall({
					from: isOutbound
						? outboundParams.dialedNumber ||
							pending?.toNumber ||
							starting?.toNumber ||
							'Unknown'
						: call.from || 'Unknown',
					callSid:
						outboundParams.parentCallSid ||
						parentCallSid ||
						call.legId ||
						'',
					clientCallSid: call.legId || '',
					campaignId: isOutbound
						? null
						: call.params.campaign_id?.trim() || null,
					muted: false,
					held: false,
					holdPending: false,
					startedAt: Date.now(),
					direction: isOutbound ? 'outbound' : 'inbound'
				});
				// Best-effort: tell the backend we're busy and no longer ready.
				// on_call blocks routing immediately; paused keeps the agent unavailable
				// after wrap-up until they explicitly go ready again.
				void setOnCall(true).catch(() => undefined);
				void setPresence({status: 'paused'}).catch(() => undefined);
				if (!isOutbound) {
					// The carrier is already accepted and streaming both ways. This only
					// overlays a local tone on the agent's selected output device.
					answerToneRef.current?.play();
				}
			});

			// Live round-trip time to the carrier — the closest possible browser-side
			// ping to the actual media path. Twilio pushes a sample every second; the
			// Telnyx transport polls its peer connection at the same cadence.
			call.onRtt((ms) => {
				if (cancelled || callRef.current !== call) return;
				setTwilioRttMs(ms);
			});

			const clearCall = () => {
				if (cancelled) return;
				answerToneRef.current?.stopTone();
				void clearHoldAudio();
				// Late terminal events from an older leg must not erase the newer call.
				callRef.current = clearCallOwner(callRef.current, call);
				if (locallyEndedCallRef.current === call) {
					locallyEndedCallRef.current = null;
				}
				if (!callRef.current) setTwilioRttMs(null);
				setActiveCall((current) => clearActiveCallOwner(current, call.legId || ''));
				if (outboundParams.isExplicitOutbound && ownsOutboundInvite) {
					const attemptId =
						outboundParams.attemptId ||
						pendingOutboundRef.current?.attemptId ||
						outboundStartingRef.current?.attemptId;
					void reconcileAuthoritativeOutbound(attemptId).catch(() => undefined);
				}
			};

			const finishCall = (event: CallTerminalEvent) => {
				if (terminalHandled) return;
				terminalHandled = true;
				const locallyEnded = locallyEndedCallRef.current === call;
				const direction =
					acceptedDirection ??
					(ownsOutboundInvite || outboundParams.isExplicitOutbound
						? 'outbound'
						: 'inbound');
				const message = callerHangupMessage({
					event,
					direction,
					locallyEnded
				});
				if (message) showCallerHangupNotice(message);
				clearCall();
			};
			call.on('disconnect', () => finishCall('disconnect'));
			call.on('cancel', () => finishCall('cancel'));
			call.on('reject', () => finishCall('reject'));
			call.on('error', (e?: unknown) => {
				if (cancelled) return;
				terminalHandled = true;
				setError((e as {message?: string} | undefined)?.message || 'Call error');
				clearCall();
			});

			// Accept every owned leg immediately. Inbound notification is a separate,
			// one-second local tone started by the accept event, so neither direction
			// of carrier audio waits for the notification to finish.
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

				const first = await fetchToken();
				if (cancelled) return;

				// THE WIZARD RUNS BEFORE THE TRANSPORT (Subplan 07). Testing after the
				// softphone is live would leave an agent registered on — and taking calls
				// through — a network we are in the middle of condemning, and a reloading
				// agent whose presence is still 'ready' from their last session would hit
				// exactly that window. A flip means the token we already hold is for the
				// wrong carrier, so re-mint; otherwise reuse the one we have.
				const flipped = await runWizard(first, 'boot');
				if (cancelled) return;
				const active = flipped ? await fetchToken() : first;
				if (cancelled) return;
				const {token, provider} = active;

				// The backend chose the carrier; build the matching transport. Everything
				// below this line is provider-agnostic.
				transport =
					provider === 'telnyx'
						? new TelnyxTransport({
								refreshToken: async () => (await fetchToken()).token,
								onError: (message) => !cancelled && setError(message)
							})
						: new TwilioTransport({
								refreshToken: async () => (await fetchToken()).token,
								onError: (message) => !cancelled && setError(message)
							});
				transportRef.current = transport;

				// ⚠️ Posted to the backend as `twilio_device_status` on every heartbeat.
				// The name is legacy; the GATE is carrier-neutral. If a transport stops
				// reporting 'registered', claimInboundCallByAgent stops claiming and every
				// inbound call for this agent is rejected agent_busy_or_unreachable.
				transport.onStatus((status, statusError) => {
					if (cancelled) return;
					setDeviceStatus(status);
					if (statusError) setError(statusError);
				});
				transport.onIncoming(onIncoming);

				await transport.register(token);
				if (cancelled) return;

				// Twilio reports the device selection the SDK actually settled on; Telnyx
				// has no equivalent event, and there its selection is only ever ours.
				if (transport instanceof TwilioTransport) {
					transport.onDeviceChange((input, output) => {
						if (cancelled) return;
						inputDeviceIdRef.current = input;
						setInputDeviceId(input);
						outputDeviceIdRef.current = output;
						setOutputDeviceId(output);
					});
				}
				void probeApi();
				apiPingTimer = window.setInterval(
					() => void probeApi(),
					API_PING_INTERVAL_MS
				);

				// Re-test when the machine's network actually changes. DEMOTION ONLY — the
				// wizard's own entry gate enforces that, and the reason is that a flapping
				// wifi would otherwise swing an agent back and forth, each swing costing a
				// Retreaver re-point and a window where our database and Retreaver disagree
				// about which number to dial.
				activeVoice = active;
				builtVoiceProviderRef.current = provider;
				window.addEventListener('online', onNetworkChange);
				networkInfo()?.addEventListener('change', onNetworkChange);
			} catch (e) {
				if (cancelled) return;
				setDeviceStatus('error');
				setError(e instanceof Error ? e.message : 'Failed to start softphone');
			}
		};

		void setup();

		return () => {
			cancelled = true;
			window.removeEventListener('online', onNetworkChange);
			networkInfo()?.removeEventListener('change', onNetworkChange);
			activeVoice = null;
			builtVoiceProviderRef.current = null;
			if (apiPingTimer !== null) {
				window.clearInterval(apiPingTimer);
			}
			apiPingController?.abort();
			try {
				callRef.current?.disconnect();
			} catch {
				/* ignore */
			}
			void clearHoldAudio();
			try {
				transport?.destroy();
			} catch {
				/* ignore */
			}
			transportRef.current = null;
			callRef.current = null;
			ringbackRef.current?.stop();
			ringbackRef.current = null;
			answerToneRef.current?.dispose();
			answerToneRef.current = null;
			dismissCallerHangupNotice();
		};
	}, [
		clearOutboundAttempt,
		clearHoldAudio,
		dismissCallerHangupNotice,
		enabled,
		reconcileAuthoritativeOutbound,
		showCallerHangupNotice,
		updatePendingOutbound,
		// A mid-session flip (Subplan 07) rebuilds the transport through this effect's own
		// teardown rather than through a second, drift-prone one of its own.
		voiceEpoch
	]);

	return {
		deviceStatus,
		activeCall,
		twilioRttMs,
		apiPingMs,
		error,
		networkChecking,
		callerHangupNotice,
		dismissCallerHangupNotice,
		outboundStarting,
		pendingOutbound,
		inputDeviceId,
		outputDeviceId,
		mute,
		setHold,
		hangup,
		armAudio,
		startOutbound,
		cancelPendingOutbound,
		setInputDevice,
		setOutputDevice,
		reportServerProvider
	};
}

const OUTBOUND_WATCHDOG_MS = 5_000;
const OUTBOUND_RINGBACK_MAX_MS = 60_000;
const OUTBOUND_ATTEMPT_STORAGE_KEY = 'pp_dialer_outbound_attempt';

const API_PING_INTERVAL_MS = 15_000;
const API_PING_TIMEOUT_MS = 5_000;
const CALLER_HANGUP_NOTICE_MS = 6_000;

/**
 * `navigator.connection` is still unshipped on Safari and absent from the DOM lib types,
 * so it is read defensively rather than declared — the `online` listener alone is a
 * perfectly good trigger on browsers that lack it.
 */
const networkInfo = (): EventTarget | null => {
	if (typeof navigator === 'undefined') return null;
	const connection = (navigator as Navigator & {connection?: EventTarget})
		.connection;
	return connection && typeof connection.addEventListener === 'function'
		? connection
		: null;
};

class AmbiguousOutboundStartError extends Error {}
class DefinitiveOutboundStartError extends Error {}

function newOutboundAttemptId(): string {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
	return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function storeOutboundAttempt(attempt: StartingOutboundCall): void {
	try {
		sessionStorage.setItem(
			OUTBOUND_ATTEMPT_STORAGE_KEY,
			JSON.stringify(attempt)
		);
	} catch {
		/* recovery remains available for the current mount */
	}
}

function readStoredOutboundAttempt(): StartingOutboundCall | null {
	try {
		const raw = sessionStorage.getItem(OUTBOUND_ATTEMPT_STORAGE_KEY);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<StartingOutboundCall>;
		if (
			typeof value.attemptId !== 'string' ||
			typeof value.toNumber !== 'string' ||
			typeof value.startedAt !== 'number'
		) {
			clearStoredOutboundAttempt();
			return null;
		}
		return {
			attemptId: value.attemptId,
			toNumber: value.toNumber,
			startedAt: value.startedAt,
			canceling: false,
			reconciling: true
		};
	} catch {
		clearStoredOutboundAttempt();
		return null;
	}
}

function clearStoredOutboundAttempt(): void {
	try {
		sessionStorage.removeItem(OUTBOUND_ATTEMPT_STORAGE_KEY);
	} catch {
		/* no-op */
	}
}

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
