/** Pure ownership rules used by the Twilio hook. Keeping these separate makes the
 * concurrency invariants executable without constructing a real browser Device. */
export const claimIncomingOwner = <T>(
	current: T | null,
	incoming: T
): {accepted: boolean; owner: T} =>
	current && current !== incoming
		? {accepted: false, owner: current}
		: {accepted: true, owner: incoming};

export const clearCallOwner = <T>(current: T | null, terminating: T): T | null =>
	current === terminating ? null : current;

export const clearActiveCallOwner = <T extends {callSid: string}>(
	current: T | null,
	terminatingCallSid: string
): T | null =>
	current && current.callSid === terminatingCallSid ? null : current;
