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
 *   - exposes the live Call + mute/hold/hangup so the active-call UI can drive it.
 *
 * Outbound calls are REST-originated by the backend and arrive here as an exact
 * parent-SID-correlated Client leg; this hook owns their pending state, local
 * ringback, and cancellation. Mic permission is requested up front because the
 * SDK needs it to answer. One Device per tab; cleaned up on unmount.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {Call, Device, type RTCSample} from '@twilio/voice-sdk';
import {
	cancelOutboundCall,
	getCurrentOutboundCall,
	getTwilioToken,
	setOnCall,
	setPresence,
	startOutboundCall,
	type TwilioDeviceStatus
} from '@/lib/api';
import {
	claimIncomingOwner,
	clearActiveCallOwner,
	clearCallOwner
} from './callOwnership';
import {
	matchesPendingOutbound,
	matchesStartingOutbound,
	readOutboundCallParameters,
	shouldApplyOutboundReconciliation,
	shouldIgnoreExplicitOutbound,
	type PendingOutboundCall,
	type StartingOutboundCall
} from './outboundCallState';
import {HoldAudioController} from './holdAudio';
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
	setInputDevice: (deviceId: string) => Promise<void>;
	setOutputDevice: (deviceId: string) => Promise<void>;
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
	const [outboundStarting, setOutboundStarting] =
		useState<StartingOutboundCall | null>(null);
	const [pendingOutbound, setPendingOutbound] =
		useState<PendingOutboundCall | null>(null);

	const deviceRef = useRef<Device | null>(null);
	const callRef = useRef<Call | null>(null);
	const outboundStartingRef = useRef<StartingOutboundCall | null>(null);
	const pendingOutboundRef = useRef<PendingOutboundCall | null>(null);
	const outputDeviceIdRef = useRef('default');
	const ringbackRef = useRef<OutboundRingback | null>(null);
	const outboundReconcileSequenceRef = useRef(0);
	const holdControllerRef = useRef<HoldAudioController | null>(null);
	const holdTransitionRef = useRef(false);
	const preHoldMutedRef = useRef<boolean | null>(null);

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
		const controller = holdControllerRef.current;
		holdControllerRef.current = null;
		holdTransitionRef.current = false;
		preHoldMutedRef.current = null;
		if (!controller) return;
		try {
			await controller.stop();
		} catch {
			// The call is already ending; device.destroy() is the final cleanup boundary.
		}
	}, []);

	const mute = useCallback((muted: boolean) => {
		const call = callRef.current;
		if (!call || holdControllerRef.current || holdTransitionRef.current) return;
		call.mute(muted);
		setActiveCall((prev) => (prev ? {...prev, muted} : prev));
	}, []);

	const setHold = useCallback(async (held: boolean): Promise<void> => {
		const call = callRef.current;
		const device = deviceRef.current;
		const audio = device?.audio;
		if (!call || !audio) {
			throw new Error('There is no active call to place on hold.');
		}
		if (holdTransitionRef.current) return;

		const updateOwnedCall = (patch: Partial<ActiveCall>) => {
			setActiveCall((current) =>
				callRef.current === call && current ? {...current, ...patch} : current
			);
		};

		if (held) {
			if (holdControllerRef.current) return;
			holdTransitionRef.current = true;
			setError(null);
			updateOwnedCall({holdPending: true});

			const wasMuted = call.isMuted();
			preHoldMutedRef.current = wasMuted;
			// Mute applies after processing, so it must be off for the generated music
			// stream to reach Twilio. The prior state is restored on Resume.
			call.mute(false);
			updateOwnedCall({muted: false});

			let controller: HoldAudioController | null = null;
			try {
				controller = new HoldAudioController(audio);
				holdControllerRef.current = controller;
				await controller.start();
				if (
					callRef.current !== call ||
					holdControllerRef.current !== controller
				) {
					await controller.stop().catch(() => undefined);
					return;
				}
				updateOwnedCall({held: true, holdPending: false});
			} catch (holdError) {
				if (controller && holdControllerRef.current === controller) {
					holdControllerRef.current = null;
				}
				await controller?.stop().catch(() => undefined);
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

		const controller = holdControllerRef.current;
		if (!controller) return;
		holdTransitionRef.current = true;
		setError(null);
		updateOwnedCall({holdPending: true});
		try {
			await controller.stop();
			if (
				callRef.current !== call ||
				holdControllerRef.current !== controller
			) {
				return;
			}
			holdControllerRef.current = null;
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
		callRef.current?.disconnect();
	}, []);

	const setInputDevice = useCallback(
		async (deviceId: string): Promise<void> => {
			const audio = deviceRef.current?.audio;
			if (!audio) {
				throw new Error('Softphone audio is not ready yet.');
			}
			await audio.setInputDevice(deviceId);
		},
		[]
	);

	const setOutputDevice = useCallback(
		async (deviceId: string): Promise<void> => {
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
			outputDeviceIdRef.current = deviceId;
			ringbackRef.current?.setOutputDevice(deviceId);
		},
		[]
	);

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
				{_audioContext?: AudioContext} | undefined;
			const ctx = audio?._audioContext;
			if (ctx && ctx.state === 'suspended') {
				await ctx.resume();
			}
		} catch {
			/* non-fatal: mic is granted; playback may still resume on accept */
		}

		return true;
	}, []);

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
		let device: Device | null = null;
		let apiPingTimer: number | null = null;
		let apiPingController: AbortController | null = null;

		const fetchToken = async (): Promise<string> => {
			const res = await getTwilioToken();
			if (res.statusCode !== 'SP100' || !res.token) {
				throw new Error(res.statusMessage || 'Failed to get Twilio token');
			}
			return res.token;
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
		const onIncoming = (call: Call) => {
			const outboundParams = readOutboundCallParameters(call.customParameters);
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
			let autoAnswerTimer: number | null = null;
			const cancelAutoAnswer = () => {
				if (autoAnswerTimer !== null) {
					window.clearTimeout(autoAnswerTimer);
					autoAnswerTimer = null;
				}
			};

			call.on('accept', () => {
				if (cancelled) return;
				// Exact backend-supplied parent SID + direction identifies the outbound
				// customer bridge without timing heuristics.
				const pending = pendingOutboundRef.current;
				const starting = outboundStartingRef.current;
				const isOutbound =
					ownsOutboundInvite || matchesPendingOutbound(pending, outboundParams);
				if (isOutbound) {
					clearOutboundAttempt();
				} else if (pending || starting) {
					// Backend ownership prevents a genuine inbound/outbound overlap. If a
					// stale local attempt survived long enough to accept an inbound call,
					// the accepted live call wins and all local ringback/busy state is reset.
					clearOutboundAttempt();
				}
				// `CallSid` is the browser Client leg. The TwiML bridge passes the
				// parent SID so a lead save associates with the durable dialer_calls
				// record created for this call instead of materializing a second row.
				const parentCallSid = call.customParameters.get('parent_call_sid');
				setActiveCall({
					from: isOutbound
						? outboundParams.dialedNumber ||
							pending?.toNumber ||
							starting?.toNumber ||
							'Unknown'
						: call.parameters.From || 'Unknown',
					callSid:
						outboundParams.parentCallSid ||
						parentCallSid ||
						call.parameters.CallSid ||
						'',
					clientCallSid: call.parameters.CallSid || '',
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
			});

			// Twilio publishes a WebRTC quality sample every second during a call.
			// Its RTT is the closest possible browser-side ping to the actual media path.
			call.on('sample', (sample: RTCSample) => {
				if (cancelled || callRef.current !== call) return;
				setTwilioRttMs(
					Number.isFinite(sample.rtt)
						? Math.max(0, Math.round(sample.rtt))
						: null
				);
			});

			const clearCall = () => {
				if (cancelled) return;
				cancelAutoAnswer();
				void clearHoldAudio();
				// Late terminal events from an older leg must not erase the newer call.
				callRef.current = clearCallOwner(callRef.current, call);
				if (!callRef.current) setTwilioRttMs(null);
				const callSid = call.parameters.CallSid || '';
				setActiveCall((current) => clearActiveCallOwner(current, callSid));
				if (outboundParams.isExplicitOutbound && ownsOutboundInvite) {
					const attemptId =
						outboundParams.attemptId ||
						pendingOutboundRef.current?.attemptId ||
						outboundStartingRef.current?.attemptId;
					void reconcileAuthoritativeOutbound(attemptId).catch(() => undefined);
				}
			};
			call.on('disconnect', clearCall);
			call.on('cancel', clearCall);
			call.on('reject', clearCall);
			call.on('error', (e: {message?: string}) => {
				if (cancelled) return;
				setError(e?.message || 'Call error');
				clearCall();
			});

			// Let inbound calls ring briefly before auto-answering. Twilio's native
			// ringtone ends on accept(), so accepting synchronously made the alert easy
			// to miss. An outbound customer bridge still accepts immediately because the
			// agent deliberately initiated that call.
			const accept = () => {
				autoAnswerTimer = null;
				if (cancelled || callRef.current !== call) return;
				call.accept();
			};
			if (isPendingOutbound) {
				accept();
			} else if (mayMatchStartingOutbound) {
				// The client-generated attempt id is already exact ownership proof, so a
				// lost/slow HTTP response must not make the answered customer wait.
				accept();
			} else {
				autoAnswerTimer = window.setTimeout(
					accept,
					INBOUND_AUTO_ANSWER_DELAY_MS
				);
			}
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

				device.on(
					'registered',
					() => !cancelled && setDeviceStatus('registered')
				);
				device.on(
					'unregistered',
					() => !cancelled && setDeviceStatus('offline')
				);
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
				if (cancelled) return;
				void probeApi();
				apiPingTimer = window.setInterval(
					() => void probeApi(),
					API_PING_INTERVAL_MS
				);
			} catch (e) {
				if (cancelled) return;
				setDeviceStatus('error');
				setError(e instanceof Error ? e.message : 'Failed to start softphone');
			}
		};

		void setup();

		return () => {
			cancelled = true;
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
				device?.destroy();
			} catch {
				/* ignore */
			}
			deviceRef.current = null;
			callRef.current = null;
			ringbackRef.current?.stop();
			ringbackRef.current = null;
		};
	}, [
		clearOutboundAttempt,
		clearHoldAudio,
		enabled,
		reconcileAuthoritativeOutbound,
		updatePendingOutbound
	]);

	return {
		deviceStatus,
		activeCall,
		twilioRttMs,
		apiPingMs,
		error,
		outboundStarting,
		pendingOutbound,
		mute,
		setHold,
		hangup,
		armAudio,
		startOutbound,
		cancelPendingOutbound,
		setInputDevice,
		setOutputDevice
	};
}

const OUTBOUND_WATCHDOG_MS = 5_000;
const OUTBOUND_RINGBACK_MAX_MS = 60_000;
const OUTBOUND_ATTEMPT_STORAGE_KEY = 'pp_dialer_outbound_attempt';

/** Keep Twilio's native inbound ringtone audible before automatic answer. */
const INBOUND_AUTO_ANSWER_DELAY_MS = 1_500;

const API_PING_INTERVAL_MS = 15_000;
const API_PING_TIMEOUT_MS = 5_000;

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
