export interface PendingOutboundCall {
	attemptId: string;
	callSid: string;
	toNumber: string;
	startedAt: number;
	canceling: boolean;
	reconciling: boolean;
}

export interface StartingOutboundCall {
	attemptId: string;
	toNumber: string;
	startedAt: number;
	canceling: boolean;
	reconciling: boolean;
}

export interface OutboundCallParameters {
	parentCallSid: string;
	attemptId: string | null;
	dialedNumber: string | null;
	isExplicitOutbound: boolean;
}

/**
 * Read the backend-supplied per-leg parameters used for exact parent-leg correlation.
 * Outbound direction is never inferred from elapsed time.
 *
 * Takes a plain record rather than Twilio's `Map` since ENG-159 Subplan 05: the same
 * five values arrive as `<Client><Parameter>` on Twilio and as `X-` SIP headers on
 * Telnyx, and `voice/legParameters.ts` flattens both to this shape. That normalization
 * is the ONLY thing the carrier swap changed about the outbound state machine — every
 * matcher below is untouched.
 */
export function readOutboundCallParameters(
	params: Record<string, string>
): OutboundCallParameters {
	return {
		parentCallSid: params.parent_call_sid?.trim() ?? '',
		attemptId: params.outbound_attempt_id?.trim() || null,
		dialedNumber: params.dialed_number?.trim() || null,
		isExplicitOutbound:
			params.call_direction?.trim().toLowerCase() === 'outbound'
	};
}

/** Before /call/start returns the parent SID, a browser may accept only a child
 * carrying its own client-generated attempt id. This prevents a second tab that is
 * also starting a call from temporarily claiming another tab's invite. */
export function matchesStartingOutbound(
	starting: StartingOutboundCall | null,
	params: OutboundCallParameters
): boolean {
	return Boolean(
		params.isExplicitOutbound &&
		starting &&
		params.attemptId &&
		starting.attemptId === params.attemptId
	);
}

export function shouldIgnoreExplicitOutbound(
	pending: PendingOutboundCall | null,
	starting: StartingOutboundCall | null,
	params: OutboundCallParameters
): boolean {
	return Boolean(
		params.isExplicitOutbound &&
		!matchesPendingOutbound(pending, params) &&
		!matchesStartingOutbound(starting, params)
	);
}

/** Only the initiating tab's exact pending parent SID may consume an outbound
 * Client leg. This rejects stale, canceled, and other-tab legs without changing
 * ordinary inbound handling. */
export function matchesPendingOutbound(
	pending: PendingOutboundCall | null,
	params: OutboundCallParameters
): boolean {
	return (
		params.isExplicitOutbound &&
		!!params.parentCallSid &&
		!!pending &&
		pending.callSid === params.parentCallSid
	);
}

/** Apply an asynchronous status result only when it is still the newest request
 * for the exact attempt currently owned by this tab. This prevents a delayed result
 * for call A from recreating A or overwriting a newer call B. */
export function shouldApplyOutboundReconciliation(
	requestAttemptId: string,
	responseAttemptId: string | null | undefined,
	requestSequence: number,
	latestSequence: number,
	pending: PendingOutboundCall | null,
	starting: StartingOutboundCall | null
): boolean {
	const stillCurrent =
		pending?.attemptId === requestAttemptId ||
		starting?.attemptId === requestAttemptId;
	return Boolean(
		requestSequence === latestSequence &&
		stillCurrent &&
		(!responseAttemptId || responseAttemptId === requestAttemptId)
	);
}
