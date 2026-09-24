# Three-way browser audio

The standard dial pad now offers **Hold & call** during an active Telnyx call. It
uses the authenticated agent's caller ID automatically. No query flag or separate
panel is needed. Other providers retain their existing single-call behavior.

Deploy/restart the backend before testing the frontend. The profile capability
`call_participant_version: 1` enables the frontend feature. No database migration
is required: participants are stored in the original `dialer_calls.metadata` under
`additional_calls`. No database commands or provider-setting changes are part of
this implementation.

## Flow

1. Receive or place an ordinary call. With the call unmuted and off hold, dial an
   additional US/Canada number using the existing dial pad.
2. The browser holds the original caller, then the server authorizes one participant
   on the agent's current, answered call and supplies the caller ID/destination.
3. The SDK dials a separate call. Its audio never reaches the held caller.
4. On answer, the banner says **Private conversation**. **Merge calls** enables two
   separate audio mixes so each remote participant hears the agent and the other
   party, excluding their own voice.
5. **End added call** restores the original call; **End all calls** ends the original
   and cleans up the added leg. Cancel/no-answer/failure also restores the original.

Mute controls the agent's microphone during private/merged audio. Regular Hold and
change-device actions are blocked during consultation; end the added leg first.
A failed cleanup stays busy and offers Retry. The normal lead form, parent call,
and presence ownership remain associated with the original call.

## Backend and accounting

Authenticated participant start/event routes enforce org/agent ownership, active
parent presence, and a single nonterminal participant. Reservation is atomic on
the parent row, retries are keyed by UUID, and lifecycle writes have monotonic
sequence numbers with sticky terminal states. The original presence is never
released by an added-leg event.

The SDK still originates the added call directly. The API authorizes our application
workflow; it is not a carrier-side restriction on someone independently using SIP
credentials. Provider permission to dial and caller-ID validation remain Telnyx's.

Stored provider session/leg IDs support reconciling Telnyx CDRs. Browser states and
timestamps are labeled application lifecycle data and do not create monetary charges.
This feature does not fetch carrier billing records or change existing agent billing.
It does not use Call Control, barge, whisper, or a conference resource. Actual
Telnyx SIP/WebRTC/PSTN usage still applies. The browser must remain connected to
carry audio between the remote participants. Browser crash/unload can lose final
lifecycle reports; a stale active participant reservation cannot authorize a second
participant on that same parent. End that parent and start a new call if needed.

The earlier backend automatic supervision runner remains commented out. Diagnostic
webhooks and experiment helpers remain available for later investigation.

## Verification

Use headphones and three endpoints. Confirm customer music/private audio before
Merge, all six speech directions after Merge, mute/unmute, cancel while ringing,
no-answer, each remote participant hanging up, and original call survival after
ending the added leg. Automated tests use mocked media/storage and cannot establish
live carrier audio quality or destination permissions.
