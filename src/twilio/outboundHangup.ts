/** Six seconds is still a short call; allow hangup after seven connected seconds. */
export const OUTBOUND_MIN_CONNECTED_MS = 7000;

export function outboundHangupRemainingSeconds(
	call: {direction: 'inbound' | 'outbound'; startedAt: number},
	now = Date.now()
): number {
	return call.direction === 'outbound'
		? Math.max(
				0,
				Math.ceil((call.startedAt + OUTBOUND_MIN_CONNECTED_MS - now) / 1000)
			)
		: 0;
}
