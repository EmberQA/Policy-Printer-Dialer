import {describe, expect, it} from 'vitest';
import {
	claimIncomingOwner,
	clearActiveCallOwner,
	clearCallOwner
} from './callOwnership';

describe('Twilio call ownership', () => {
	it('accepts the first incoming leg and makes it the owner', () => {
		const incoming = {sid: 'CA1'};
		expect(claimIncomingOwner(null, incoming)).toEqual({accepted: true, owner: incoming});
	});

	it('does not accept or replace the owner with a second leg', () => {
		const owner = {sid: 'CA1'};
		const second = {sid: 'CA2'};
		expect(claimIncomingOwner(owner, second)).toEqual({accepted: false, owner});
	});

	it('does not let terminal events from an old leg clear a newer owner or UI state', () => {
		const old = {sid: 'CA1'};
		const current = {sid: 'CA2'};
		expect(clearCallOwner(current, old)).toBe(current);
		const active = {callSid: 'CA2', from: '+15551234567'};
		expect(clearActiveCallOwner(active, 'CA1')).toBe(active);
	});

	it('clears ref and UI state only for the terminating owner', () => {
		const owner = {sid: 'CA1'};
		expect(clearCallOwner(owner, owner)).toBeNull();
		expect(clearActiveCallOwner({callSid: 'CA1'}, 'CA1')).toBeNull();
	});

	it('clears the client leg while keeping the parent SID for lead association', () => {
		expect(
			clearActiveCallOwner(
				{callSid: 'CA-parent', clientCallSid: 'CA-client'},
				'CA-client'
			)
		).toBeNull();
	});
});
