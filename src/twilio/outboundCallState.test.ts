import {describe, expect, it} from 'vitest';
import {
	matchesPendingOutbound,
	matchesStartingOutbound,
	readOutboundCallParameters,
	shouldApplyOutboundReconciliation,
	shouldIgnoreExplicitOutbound,
	type PendingOutboundCall
} from './outboundCallState';

const pending: PendingOutboundCall = {
	attemptId: '00000000-0000-4000-8000-000000000001',
	callSid: 'CA00000000000000000000000000000001',
	toNumber: '+15555550100',
	startedAt: 1_000,
	canceling: false,
	reconciling: false
};

describe('outbound Client-leg correlation', () => {
	it('requires explicit direction and the exact parent SID', () => {
		const params = readOutboundCallParameters(
			new Map([
				['call_direction', 'outbound'],
				['parent_call_sid', pending.callSid],
				['outbound_attempt_id', pending.attemptId],
				['dialed_number', pending.toNumber]
			])
		);
		expect(matchesPendingOutbound(pending, params)).toBe(true);
		expect(params.dialedNumber).toBe(pending.toNumber);
		expect(params.attemptId).toBe(pending.attemptId);
	});

	it('matches a pre-response invite only by exact attempt id', () => {
		const params = readOutboundCallParameters(
			new Map([
				['call_direction', 'outbound'],
				['parent_call_sid', pending.callSid],
				['outbound_attempt_id', pending.attemptId]
			])
		);
		expect(
			matchesStartingOutbound(
				{
					attemptId: pending.attemptId,
					toNumber: pending.toNumber,
					startedAt: pending.startedAt,
					canceling: false,
					reconciling: false
				},
				params
			)
		).toBe(true);
		expect(
			matchesStartingOutbound(
				{
					attemptId: '00000000-0000-4000-8000-000000000002',
					toNumber: pending.toNumber,
					startedAt: pending.startedAt,
					canceling: false,
					reconciling: false
				},
				params
			)
		).toBe(false);
	});

	it('ignores a non-owner outbound copy without affecting inbound calls', () => {
		const owned = readOutboundCallParameters(
			new Map([
				['call_direction', 'outbound'],
				['parent_call_sid', pending.callSid],
				['outbound_attempt_id', pending.attemptId]
			])
		);
		const otherTab = {...owned, parentCallSid: `${pending.callSid.slice(0, -1)}2`};
		expect(shouldIgnoreExplicitOutbound(pending, null, owned)).toBe(false);
		expect(shouldIgnoreExplicitOutbound(pending, null, otherTab)).toBe(true);
		expect(shouldIgnoreExplicitOutbound(null, null, owned)).toBe(true);
		expect(
			shouldIgnoreExplicitOutbound(
				pending,
				null,
				{...owned, isExplicitOutbound: false}
			)
		).toBe(false);
	});

	it('does not consume a stale or other-tab outbound leg', () => {
		const params = readOutboundCallParameters(
			new Map([
				['call_direction', 'outbound'],
				['parent_call_sid', 'CA00000000000000000000000000000002']
			])
		);
		expect(matchesPendingOutbound(pending, params)).toBe(false);
		expect(matchesPendingOutbound(null, params)).toBe(false);
	});

	it('does not match an ordinary inbound leg and keeps ownership during cancel', () => {
		const inbound = readOutboundCallParameters(
			new Map([['parent_call_sid', pending.callSid]])
		);
		expect(matchesPendingOutbound(pending, inbound)).toBe(false);
		expect(
			matchesPendingOutbound(
				{...pending, canceling: true},
				{...inbound, isExplicitOutbound: true}
			)
		).toBe(true);
	});

	it('applies only the newest status response for the current attempt', () => {
		expect(
			shouldApplyOutboundReconciliation(
				pending.attemptId,
				pending.attemptId,
				3,
				3,
				pending,
				null
			)
		).toBe(true);
		expect(
			shouldApplyOutboundReconciliation(
				pending.attemptId,
				pending.attemptId,
				2,
				3,
				pending,
				null
			)
		).toBe(false);
	});

	it('discards a response after clear or replacement by a newer attempt', () => {
		const replacement = {
			...pending,
			attemptId: '00000000-0000-4000-8000-000000000002',
			callSid: 'CA00000000000000000000000000000002'
		};
		expect(
			shouldApplyOutboundReconciliation(
				pending.attemptId,
				pending.attemptId,
				4,
				4,
				null,
				null
			)
		).toBe(false);
		expect(
			shouldApplyOutboundReconciliation(
				pending.attemptId,
				pending.attemptId,
				4,
				4,
				replacement,
				null
			)
		).toBe(false);
		expect(
			shouldApplyOutboundReconciliation(
				pending.attemptId,
				replacement.attemptId,
				4,
				4,
				pending,
				null
			)
		).toBe(false);
	});
});
