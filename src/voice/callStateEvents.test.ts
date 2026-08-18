import {describe, expect, it} from 'vitest';
import {
	isNewIncomingState,
	isTerminalState,
	legStateTransition
} from './callStateEvents';
import {callerHangupMessage} from '@/twilio/callTermination';

/** Replay a Telnyx state sequence the way TelnyxTransport does. */
const replay = (states: string[]) => {
	const events: string[] = [];
	let everActive = false;
	for (const state of states) {
		const transition = legStateTransition(state, everActive);
		if (transition.kind !== 'event') continue;
		if (transition.event === 'accept') everActive = true;
		events.push(transition.event);
	}
	return events;
};

describe('Telnyx call-state → leg events', () => {
	it('answers then disconnects on a call that connected', () => {
		expect(replay(['new', 'ringing', 'answering', 'active', 'hangup'])).toEqual([
			'accept',
			'disconnect'
		]);
	});

	// The load-bearing distinction: this is the ONLY thing separating "the caller
	// ended the call." from "the caller ended the call before it connected."
	it('cancels on a call that never connected', () => {
		expect(replay(['new', 'ringing', 'hangup'])).toEqual(['cancel']);
	});

	it('preserves the exact agent-facing copy for both endings', () => {
		const ended = replay(['ringing', 'active', 'hangup']).at(-1);
		const abandoned = replay(['ringing', 'hangup']).at(-1);

		expect(
			callerHangupMessage({
				event: ended as 'disconnect',
				direction: 'inbound',
				locallyEnded: false
			})
		).toBe('The caller ended the call.');
		expect(
			callerHangupMessage({
				event: abandoned as 'cancel',
				direction: 'inbound',
				locallyEnded: false
			})
		).toBe('The caller ended the call before it connected.');
	});

	it('accepts once even when the call re-enters the active state', () => {
		// A held → active round trip must not restart the call timer or re-post on_call.
		expect(replay(['ringing', 'active', 'held', 'active', 'hangup'])).toEqual([
			'accept',
			'disconnect'
		]);
	});

	it('reports a terminal for each of hangup, destroy and purge', () => {
		// Telnyx walks hangup → destroy → purge as separate callUpdates. The mapper
		// classifies all three; TelnyxLeg.emit is what collapses them to one teardown.
		expect(replay(['ringing', 'active', 'hangup', 'destroy', 'purge'])).toEqual([
			'accept',
			'disconnect',
			'disconnect',
			'disconnect'
		]);
		expect(['hangup', 'destroy', 'purge'].every(isTerminalState)).toBe(true);
	});

	it('emits nothing for the pre-answer states', () => {
		expect(replay(['new', 'requesting', 'trying', 'recovering', 'early'])).toEqual(
			[]
		);
	});

	it('treats only ringing as a newly announced leg', () => {
		expect(isNewIncomingState('ringing')).toBe(true);
		for (const state of ['new', 'trying', 'active', 'hangup']) {
			expect(isNewIncomingState(state)).toBe(false);
		}
	});
});
