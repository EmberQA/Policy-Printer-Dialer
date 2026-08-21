import {describe, expect, it} from 'vitest';
import {shouldRebuildTransport} from './providerSync';

describe('shouldRebuildTransport', () => {
	const input = (overrides: Partial<Parameters<typeof shouldRebuildTransport>[0]> = {}) => ({
		built: 'twilio' as const,
		reported: 'twilio' as const,
		hasActiveCall: false,
		...overrides
	});

	it('does nothing while the server agrees with the transport', () => {
		expect(shouldRebuildTransport(input())).toBe(false);
	});

	// The case this exists for: an administrator moved the agent from another machine.
	it('rebuilds when the server has moved the agent to the other network', () => {
		expect(shouldRebuildTransport(input({reported: 'telnyx'}))).toBe(true);
	});

	it('rebuilds in the other direction too', () => {
		expect(
			shouldRebuildTransport(input({built: 'telnyx', reported: 'twilio'}))
		).toBe(true);
	});

	// A rebuild destroys the transport. Doing it mid-call would drop the exact call the
	// switch was forbidden from interrupting — the backend refuses to move an agent who
	// is on one, and this is the client-side half of the same promise.
	it('never rebuilds during a call', () => {
		expect(
			shouldRebuildTransport(input({reported: 'telnyx', hasActiveCall: true}))
		).toBe(false);
	});

	// Deferral needs no queue: the heartbeat re-offers this decision every ~5s, so the
	// mismatch is simply noticed again once the call ends — against fresh inputs, rather
	// than against a carrier that may have changed again while the call ran.
	it('rebuilds on the next report once the call has ended', () => {
		const mismatch = input({reported: 'telnyx'});
		expect(shouldRebuildTransport({...mismatch, hasActiveCall: true})).toBe(false);
		expect(shouldRebuildTransport({...mismatch, hasActiveCall: false})).toBe(true);
	});

	// Before boot there is no transport to be wrong, and the boot path resolves the
	// carrier itself. Acting here would race the build it is waiting on.
	it('does nothing before a transport exists', () => {
		expect(shouldRebuildTransport(input({built: null, reported: 'telnyx'}))).toBe(
			false
		);
	});

	// An older backend that does not send the field, or a beat that could not read the
	// agent row. Silence is not evidence the carrier changed.
	it('does nothing when the server has not reported a carrier', () => {
		expect(shouldRebuildTransport(input({reported: null}))).toBe(false);
	});
});
