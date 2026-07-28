import {describe, expect, it} from 'vitest';
import {callerHangupMessage} from './callTermination';

describe('callerHangupMessage', () => {
	it('reports an inbound caller who abandons before accept', () => {
		expect(
			callerHangupMessage({
				event: 'cancel',
				direction: 'inbound',
				locallyEnded: false
			})
		).toBe('The caller ended the call before it connected.');
	});

	it('reports an inbound caller who disconnects after accept', () => {
		expect(
			callerHangupMessage({
				event: 'disconnect',
				direction: 'inbound',
				locallyEnded: false
			})
		).toBe('The caller ended the call.');
	});

	it('does not blame the caller when the agent pressed Hang Up', () => {
		expect(
			callerHangupMessage({
				event: 'disconnect',
				direction: 'inbound',
				locallyEnded: true
			})
		).toBeNull();
	});

	it('does not show the inbound notice for outbound or rejected legs', () => {
		expect(
			callerHangupMessage({
				event: 'cancel',
				direction: 'outbound',
				locallyEnded: false
			})
		).toBeNull();
		expect(
			callerHangupMessage({
				event: 'reject',
				direction: 'inbound',
				locallyEnded: false
			})
		).toBeNull();
	});
});
