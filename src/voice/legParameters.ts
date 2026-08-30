/**
 * Per-call metadata normalization — the seam that keeps the outbound state machine
 * carrier-agnostic (ENG-159 — Subplan 05).
 *
 * The backend sends the SAME five values on both carriers, but the transports deliver
 * them in different shapes because the markup differs:
 *
 *   Twilio  <Client><Parameter name="parent_call_sid" .../>  → Map<string, string>
 *   Telnyx  <Sip>sip:user@host?X-Parent-Call-Sid=...          → [{name, value}, ...]
 *
 * TeXML has no <Client>, so Telnyx metadata rides as `X-` headers on the SIP URI and
 * arrives at `call.options.customHeaders`. Flattening both to one record here is what
 * lets `readOutboundCallParameters` and every matcher below it stay untouched by the
 * carrier swap — see outboundCallState.ts.
 */

/** Twilio hands back a real Map; we only need `get`, matching the old signature. */
export type TwilioCustomParameters = Pick<Map<string, string>, 'get'>;

/** Telnyx hands back `call.options.customHeaders`. */
export type TelnyxCustomHeaders = Array<{name?: string; value?: string}>;

/**
 * SIP header name → the parameter key the app already speaks.
 *
 * Keep in lockstep with `buildInboundTexml` / `buildOutboundConnectTexml` in the
 * backend's `dialer/telnyx.ts`. A header we don't map is silently dropped, which
 * surfaces as an outbound leg that the owning tab refuses to claim rather than as an
 * error — so a rename on either side must land on both.
 */
const HEADER_TO_PARAM: Record<string, string> = {
	'x-parent-call-sid': 'parent_call_sid',
	'x-campaign-id': 'campaign_id',
	'x-call-direction': 'call_direction',
	'x-outbound-attempt-id': 'outbound_attempt_id',
	'x-dialed-number': 'dialed_number',
	// Retreaver stamps its call UUID on the INVITE when a buyer targets a SIP URI
	// directly (ENG-213). Attribution only — never authorization: a missing UUID
	// still answers. ⚠️ 'x-ph-retreaverkey' is deliberately NOT mapped: it is
	// Retreaver's API key and must never be surfaced, logged, or persisted.
	'x-ph-retreaveruuid': 'retreaver_uuid'
};

/** The keys any transport may produce. Twilio's <Parameter> names are already these. */
export const LEG_PARAMETER_KEYS = Object.values(HEADER_TO_PARAM);

/**
 * Flatten Telnyx's `Array<{name, value}>` into the record shape.
 *
 * Header names are matched case-insensitively: SIP header names are case-insensitive
 * by RFC 3261, and a carrier that normalized `X-Campaign-Id` to `X-CAMPAIGN-ID` would
 * otherwise cost us the campaign attribution without anything erroring.
 */
export const normalizeTelnyxHeaders = (
	headers: TelnyxCustomHeaders | null | undefined
): Record<string, string> => {
	const params: Record<string, string> = {};
	if (!Array.isArray(headers)) return params;
	for (const header of headers) {
		const key = HEADER_TO_PARAM[String(header?.name ?? '').toLowerCase()];
		if (!key) continue;
		params[key] = String(header?.value ?? '');
	}
	return params;
};

/** Flatten Twilio's Map into the same record. The names already match one-for-one. */
export const normalizeTwilioParameters = (
	customParameters: TwilioCustomParameters | null | undefined
): Record<string, string> => {
	const params: Record<string, string> = {};
	if (!customParameters) return params;
	for (const key of LEG_PARAMETER_KEYS) {
		const value = customParameters.get(key);
		if (value !== undefined && value !== null) params[key] = String(value);
	}
	return params;
};
