import {describe, expect, it} from 'vitest';
import {
	normalizeTelnyxHeaders,
	normalizeTwilioParameters
} from './legParameters';
import {readOutboundCallParameters} from '@/twilio/outboundCallState';

const PARENT = 'CA00000000000000000000000000000001';
const ATTEMPT = '00000000-0000-4000-8000-000000000001';
const DIALED = '+15555550100';
const CAMPAIGN = '11111111-2222-4333-8444-555555555555';

/** What Twilio delivers: <Client><Parameter> children, already snake_case. */
const twilioOutbound = new Map([
	['parent_call_sid', PARENT],
	['call_direction', 'outbound'],
	['outbound_attempt_id', ATTEMPT],
	['dialed_number', DIALED]
]);

/** What Telnyx delivers: X- headers off the SIP URI, on call.options.customHeaders. */
const telnyxOutbound = [
	{name: 'X-Parent-Call-Sid', value: PARENT},
	{name: 'X-Call-Direction', value: 'outbound'},
	{name: 'X-Outbound-Attempt-Id', value: ATTEMPT},
	{name: 'X-Dialed-Number', value: DIALED}
];

describe('per-leg parameter normalization', () => {
	// THE seam assertion. If these two ever diverge, the outbound state machine starts
	// refusing to claim legs on one carrier and nothing else in the app will say why.
	it('produces an identical record from both carrier shapes', () => {
		expect(normalizeTelnyxHeaders(telnyxOutbound)).toEqual(
			normalizeTwilioParameters(twilioOutbound)
		);
	});

	it('drives readOutboundCallParameters identically for each carrier', () => {
		const fromTwilio = readOutboundCallParameters(
			normalizeTwilioParameters(twilioOutbound)
		);
		const fromTelnyx = readOutboundCallParameters(
			normalizeTelnyxHeaders(telnyxOutbound)
		);

		expect(fromTelnyx).toEqual(fromTwilio);
		expect(fromTelnyx.isExplicitOutbound).toBe(true);
		expect(fromTelnyx.parentCallSid).toBe(PARENT);
		expect(fromTelnyx.attemptId).toBe(ATTEMPT);
		expect(fromTelnyx.dialedNumber).toBe(DIALED);
	});

	it('carries inbound campaign attribution across both shapes', () => {
		const twilio = normalizeTwilioParameters(
			new Map([
				['parent_call_sid', PARENT],
				['campaign_id', CAMPAIGN]
			])
		);
		const telnyx = normalizeTelnyxHeaders([
			{name: 'X-Parent-Call-Sid', value: PARENT},
			{name: 'X-Campaign-Id', value: CAMPAIGN},
			// Telnyx sends this on inbound; Twilio omits it entirely. Both must read as
			// NOT explicitly outbound, or an inbound call gets treated as an outbound
			// invite the tab does not own and is ignored.
			{name: 'X-Call-Direction', value: 'inbound'}
		]);

		expect(twilio.campaign_id).toBe(CAMPAIGN);
		expect(telnyx.campaign_id).toBe(CAMPAIGN);
		expect(readOutboundCallParameters(twilio).isExplicitOutbound).toBe(false);
		expect(readOutboundCallParameters(telnyx).isExplicitOutbound).toBe(false);
	});

	it('matches SIP header names case-insensitively', () => {
		// SIP header names are case-insensitive per RFC 3261. A carrier that upcased
		// them would otherwise cost us the campaign without anything erroring.
		expect(
			normalizeTelnyxHeaders([
				{name: 'x-parent-call-sid', value: PARENT},
				{name: 'X-CAMPAIGN-ID', value: CAMPAIGN}
			])
		).toEqual({parent_call_sid: PARENT, campaign_id: CAMPAIGN});
	});

	it('ignores unknown headers and survives missing or malformed input', () => {
		expect(
			normalizeTelnyxHeaders([
				{name: 'X-Telnyx-Something', value: 'noise'},
				{name: 'X-Campaign-Id', value: CAMPAIGN}
			])
		).toEqual({campaign_id: CAMPAIGN});

		expect(normalizeTelnyxHeaders(undefined)).toEqual({});
		expect(normalizeTelnyxHeaders([])).toEqual({});
		expect(normalizeTwilioParameters(null)).toEqual({});
	});

	it('omits absent keys rather than emitting empty strings', () => {
		// readOutboundCallParameters distinguishes "" from null on attemptId and
		// dialedNumber, so an absent header must not arrive as a present empty value.
		const params = normalizeTwilioParameters(
			new Map([['parent_call_sid', PARENT]])
		);
		expect('dialed_number' in params).toBe(false);
		expect(readOutboundCallParameters(params).dialedNumber).toBeNull();
	});
});
