export type CallTerminalEvent = 'cancel' | 'disconnect' | 'reject';
export type CallDirection = 'inbound' | 'outbound' | null;

/** Return agent-facing copy only when the remote inbound caller ended the leg. */
export function callerHangupMessage({
	event,
	direction,
	locallyEnded
}: {
	event: CallTerminalEvent;
	direction: CallDirection;
	locallyEnded: boolean;
}): string | null {
	if (locallyEnded || direction !== 'inbound') return null;
	if (event === 'cancel') return 'The caller ended the call before it connected.';
	if (event === 'disconnect') return 'The caller ended the call.';
	return null;
}
