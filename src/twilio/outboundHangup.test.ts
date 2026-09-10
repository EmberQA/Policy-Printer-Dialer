import {describe, expect, it} from 'vitest';
import {outboundHangupRemainingSeconds} from './outboundHangup';

describe('outbound hangup minimum', () => {
	const call = {direction: 'outbound' as const, startedAt: 100_000};

	it('waits seven full seconds from browser connection, including the six-second boundary', () => {
		expect(outboundHangupRemainingSeconds(call, 100_000)).toBe(7);
		expect(outboundHangupRemainingSeconds(call, 106_000)).toBe(1);
		expect(outboundHangupRemainingSeconds(call, 106_999)).toBe(1);
		expect(outboundHangupRemainingSeconds(call, 107_000)).toBe(0);
		expect(outboundHangupRemainingSeconds(call, 110_000)).toBe(0);
	});

	it('never delays inbound hangup', () => {
		expect(outboundHangupRemainingSeconds({...call, direction: 'inbound'}, 100_000)).toBe(0);
	});

	it('starts a fresh wait for the next call even if the previous call was unlocked', () => {
		expect(outboundHangupRemainingSeconds(call, 110_000)).toBe(0);
		expect(outboundHangupRemainingSeconds({...call, startedAt: 110_000}, 110_000)).toBe(7);
	});
});
