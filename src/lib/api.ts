/**
 * Axios layer for the EmberQA backend.
 *
 * The backend's auth gate expects the access+refresh JWTs in ONE header:
 *   Authorization: <access>,<refresh>
 * and, when it rotates the access token, returns the fresh one in the RESPONSE
 * BODY as `newAccessToken` (not a header). So we:
 *   - attach the combined Authorization header on every request, and
 *   - capture `newAccessToken` from every response body and store it.
 *
 * All authenticated endpoints are POSTs under VITE_API_BASE/api/v1/qualityscore
 * with an empty-ish JSON body (the backend reads authPayload server-side).
 */

import axios, {AxiosInstance, type AxiosRequestConfig} from 'axios';
import {
	getAccessToken,
	getRefreshToken,
	setAccessToken,
	clearSession
} from '@/auth/session';

// Prod build (`vite build`) targets the deployed backend; dev (`vite`) targets
// the LOCAL backend on :3000 (matches EmberQA's fetchWithAuth convention — 3001
// is the EmberQA frontend, not the API). Still overridable by VITE_API_BASE if a
// build ever needs a different host.
const API_BASE =
	import.meta.env.VITE_API_BASE ??
	(import.meta.env.PROD ? 'https://api.emberqa.com' : 'http://localhost:3000');

export const api: AxiosInstance = axios.create({
	baseURL: `${API_BASE}/api/v1`
});

api.interceptors.request.use((config) => {
	const access = getAccessToken();
	const refresh = getRefreshToken();
	if (access && refresh) {
		config.headers = config.headers ?? {};
		config.headers.Authorization = `${access},${refresh}`;
	}
	return config;
});

api.interceptors.response.use(
	(response) => {
		// Rotate the access token in place when the backend issued a fresh one.
		const newAccessToken = response.data?.newAccessToken;
		if (typeof newAccessToken === 'string' && newAccessToken.length > 0) {
			setAccessToken(newAccessToken);
		}
		return response;
	},
	(error) => {
		// A 401 means both tokens are dead — the session is unrecoverable here
		// (no password login on the dialer). Clear it; the app routes back to the
		// "relaunch from main app" screen.
		if (error?.response?.status === 401) {
			clearSession();
		}
		return Promise.reject(error);
	}
);

/**
 * POST a qualityscore endpoint (path relative to /api/v1/qualityscore).
 *
 * The authed backend wraps every payload via responseHandler as
 * `{ statusCode, statusMessage, data: {...fields} }` (nested — like all EmberQA
 * endpoints; only the unauth handoff/webhook routes are flat). Our response types
 * + callers expect the fields AND statusCode/statusMessage together at the top
 * level, so we FLATTEN: spread `data` up and re-attach statusCode/statusMessage.
 * One place → every caller (presence, campaigns, leads, twilio token, …) sees the
 * right shape.
 */
export const qsPost = async <T = any>(
	path: string,
	body: Record<string, unknown> = {},
	config?: AxiosRequestConfig
): Promise<T> => {
	const res = await api.post(`/qualityscore${path}`, body, config);
	const envelope = res.data ?? {};
	return {
		...(envelope.data ?? {}),
		statusCode: envelope.statusCode,
		statusMessage: envelope.statusMessage
	} as T;
};

/** The caller's dialer profile (lazily created server-side). */
export interface DialerProfileResponse {
	statusCode: string;
	statusMessage: string;
	dialer_enabled?: boolean;
	access_paused?: boolean;
	provisioned?: boolean;
	capabilities?: {
		outbound_lifecycle_version?: number;
	};
	agent?: {
		id: string;
		org_id: string;
		user_id: string;
		twilio_identity: string;
		twilio_phone_number: string | null;
	};
}

export const fetchDialerProfile = (): Promise<DialerProfileResponse> =>
	qsPost('/policyPrinter/dialer/profile');

/* -------------------------------------------------------------------------- */
/* Presence / heartbeat / campaigns (Subplan 02)                              */
/* -------------------------------------------------------------------------- */

/** Toggled availability the agent controls. */
export type PresenceStatus = 'ready' | 'paused';

/** Twilio Device registration state the FE reports each heartbeat (Subplan 03
 *  wires the real value; until then the dialer reports 'offline'). */
export type TwilioDeviceStatus =
	'registered' | 'offline' | 'connecting' | 'error';

/** Live presence row mirrored from the backend. */
export interface DialerPresence {
	agent_id: string;
	org_id: string;
	user_id: string;
	status: PresenceStatus;
	selected_campaign_id: string | null;
	on_call: boolean;
	/** Set while the agent is reserved for an incoming call (call-reservation
	 *  window); null when unreserved. Transient — clears on the call landing or
	 *  lazy-expires. */
	reserved_at: string | null;
	reserved_call_uuid: string | null;
	reserved_retreaver_call_uuid: string | null;
	/** The campaign whose buyer won the reserving ping — the authoritative campaign
	 *  for the incoming call. The dialer uses it to auto-open the correct lead form
	 *  even when several campaigns are armed. Null when unreserved. */
	reserved_campaign_id: string | null;
	bridging_call_sid: string | null;
	bridging_claimed_at: string | null;
	bridging_claim_fresh: boolean | null;
	last_heartbeat_at: string | null;
	session_id: string | null;
	twilio_device_status: TwilioDeviceStatus | null;
	updated_at: string;
}

export interface CreditNotification {
	id: string;
	call_id: string;
	credit_outcome: string;
	created_at: string;
	caller_phone: string | null;
	call_started_at: string | null;
	campaign_name: string | null;
}

/** Presence endpoints return the row plus the recomputed numeric availability
 *  (exactly what Retreaver would see right now). */
export interface PresenceResponse {
	statusCode: string;
	statusMessage: string;
	available?: 0 | 1;
	presence?: DialerPresence | null;
}

/** A campaign the agent is linked to, plus this agent's per-campaign `ready` toggle. */
export interface DialerCampaign {
	id: string;
	org_id: string;
	name: string;
	default_form_id: string | null;
	active: boolean;
	created_at: string;
	updated_at: string;
	/** Whether the agent has armed this campaign's buyer (per-campaign ready toggle). */
	ready: boolean;
	/** Retreaver Hard-cap usage, loaded after the core dialer bootstrap. Undefined is
	 * still loading; null means this campaign's target usage was unavailable. */
	calls_used?: number | null;
	calls_allotted?: number | null;
	calls_remaining?: number | null;
	calls_remaining_status?: CampaignRemainingCallsStatus;
}

export interface CampaignsResponse {
	statusCode: string;
	statusMessage: string;
	campaigns?: DialerCampaign[];
}

export interface CampaignRemainingCalls {
	campaign_id: string;
	campaign_name: string | null;
	calls_remaining_status: CampaignRemainingCallsStatus;
	calls_used: number | null;
	calls_allotted: number | null;
	calls_remaining: number | null;
}

export type CampaignRemainingCallsStatus =
	| 'available'
	| 'buyer_id_not_configured'
	| 'hard_cap_not_configured'
	| 'retreaver_not_configured'
	| 'invalid_hard_cap'
	| 'retreaver_unavailable';

export interface CampaignRemainingCallsResponse {
	statusCode: string;
	statusMessage: string;
	campaigns?: CampaignRemainingCalls[];
}

/** Post one heartbeat. `sessionId` ties the beat to this browser tab; until the
 *  Twilio device exists (Subplan 03) the device status is reported as 'offline'. */
export const postHeartbeat = (
	sessionId: string,
	deviceStatus: TwilioDeviceStatus
): Promise<PresenceResponse> =>
	qsPost('/policyPrinter/dialer/heartbeat', {
		session_id: sessionId,
		device_status: deviceStatus
	});

export interface PendingCreditNotificationResponse {
	statusCode: string;
	statusMessage: string;
	credit_notification?: CreditNotification | null;
}

/** Poll for the oldest unacknowledged credit popup. Runs on its own slower (~30s)
 *  timer — moved OFF the 5s heartbeat so the pending-credit JSONB scan runs far less
 *  often (DB load reduction). Hits the pre-RBAC dialer-liveness route. */
export const postCreditNotificationPending =
	(): Promise<PendingCreditNotificationResponse> =>
		qsPost('/policyPrinter/dialer/creditNotification/pending');

export const acknowledgeCreditNotification = (
	notificationId: string
): Promise<{statusCode: string; statusMessage: string}> =>
	qsPost('/policyPrinter/dialer/creditNotification/acknowledge', {
		notification_id: notificationId
	});

/** Read current presence + availability (UI bootstrap). */
export const getPresence = (): Promise<PresenceResponse> =>
	qsPost('/policyPrinter/dialer/presence/get');

/**
 * Set presence intent. Two orthogonal controls, omit a field to leave it unchanged:
 *   - `status`: the global ready/paused master switch over all the agent's buyers.
 *   - `campaign_id` + `ready`: arm/disarm ONE campaign's buyer (per-campaign toggle).
 */
export const setPresence = (input: {
	status?: PresenceStatus;
	campaign_id?: string | null;
	ready?: boolean;
}): Promise<PresenceResponse> =>
	qsPost('/policyPrinter/dialer/presence/set', input);

/** Arm or disarm one campaign's buyer for this agent (per-campaign ready toggle). */
export const setCampaignReady = (
	campaignId: string,
	ready: boolean
): Promise<PresenceResponse> =>
	qsPost('/policyPrinter/dialer/presence/set', {
		campaign_id: campaignId,
		ready
	});

/** The agent's linked campaigns, each with its per-agent `ready` toggle. */
export const listCampaigns = (): Promise<CampaignsResponse> =>
	qsPost('/policyPrinter/dialer/campaigns/list');

/** Current Retreaver Hard-cap usage for each campaign linked to this agent. */
export const listCampaignRemainingCalls =
	(): Promise<CampaignRemainingCallsResponse> =>
		qsPost('/policyPrinter/dialer/campaigns/remainingCalls');

/* -------------------------------------------------------------------------- */
/* Twilio softphone (Subplan 03)                                              */
/* -------------------------------------------------------------------------- */

export interface TwilioTokenResponse {
	statusCode: string;
	statusMessage: string;
	token?: string;
	identity?: string;
}

/** Mint a short-lived Twilio Voice access token for this browser Device. */
export const getTwilioToken = (): Promise<TwilioTokenResponse> =>
	qsPost('/policyPrinter/dialer/twilio/token');

export interface StartOutboundCallResponse {
	statusCode: string;
	statusMessage: string;
	attempt_id?: string;
	/** Twilio CallSid of the placed call (present on success). */
	call_sid?: string;
	call_status?: string | null;
}

/**
 * Place an outbound call to `to`. The backend REST-originates the call presenting
 * the agent's own DID as caller ID, then bridges the answered customer to this
 * agent's browser (it arrives as an incoming leg) and blocks inbound routing for the
 * duration. `to` may be any format the agent typed — the backend normalizes +
 * validates it (US/CA only). The persistent device/session layer owns pending-call
 * correlation and ringback around this request.
 */
export const startOutboundCall = (
	to: string,
	attemptId: string
): Promise<StartOutboundCallResponse> =>
	qsPost(
		'/policyPrinter/dialer/call/start',
		{to, attempt_id: attemptId},
		{timeout: OUTBOUND_START_REQUEST_TIMEOUT_MS}
	);

export type OutboundCallLifecycleState =
	'idle' | 'starting' | 'ringing' | 'active' | 'terminal';

export interface OutboundCallStatusResponse {
	statusCode: string;
	statusMessage: string;
	state?: OutboundCallLifecycleState;
	owned?: boolean;
	attempt_id?: string | null;
	call_sid?: string | null;
	call_status?: string | null;
	to_number?: string | null;
	started_at?: string | null;
	answered_at?: string | null;
	ended_at?: string | null;
}

/** Recover/reconcile an exact per-tab attempt after reload/response loss. The
 * backend also supports an omitted id for diagnostics, but the browser retains the
 * id in sessionStorage so another tab cannot claim ownership. */
export const getCurrentOutboundCall = (
	attemptId?: string | null
): Promise<OutboundCallStatusResponse> =>
	qsPost('/policyPrinter/dialer/call/status', {
		...(attemptId ? {attempt_id: attemptId} : {})
	});

export interface CancelOutboundCallResponse {
	statusCode: string;
	statusMessage: string;
	attempt_id?: string | null;
	call_sid?: string;
	call_status?: string | null;
}

/** Stop an owned pending outbound parent call before the browser leg connects. */
export const cancelOutboundCall = (input: {
	callSid?: string | null;
	attemptId?: string | null;
}): Promise<CancelOutboundCallResponse> =>
	qsPost('/policyPrinter/dialer/call/cancel', {
		...(input.callSid ? {call_sid: input.callSid} : {}),
		...(input.attemptId ? {attempt_id: input.attemptId} : {})
	});

export const OUTBOUND_LIFECYCLE_VERSION = 2;
const OUTBOUND_START_REQUEST_TIMEOUT_MS = 15_000;

/** Signal call accept (true) / disconnect (false) → flips the on_call flag so
 *  mid-call availability is 0. Returns the recomputed availability/presence. */
export const setOnCall = (onCall: boolean): Promise<PresenceResponse> =>
	qsPost('/policyPrinter/dialer/presence/onCall', {on_call: onCall});

/* -------------------------------------------------------------------------- */
/* Lead workflow — form bundle, save (Subplan 04)                             */
/* -------------------------------------------------------------------------- */

/** The field types a lead form can render (mirrors the backend contract). */
export type FormFieldType =
	| 'text'
	| 'textarea'
	| 'phone'
	| 'email'
	| 'number'
	| 'date'
	| 'select'
	| 'radio'
	| 'checkbox'
	| 'boolean';

export interface FormFieldOption {
	value: string;
	label: string;
}

/** One field in a form's ordered schema. label/help are ALWAYS plain text. */
export interface FormField {
	key: string;
	label: string;
	help?: string;
	type: FormFieldType;
	required?: boolean;
	options?: FormFieldOption[];
	sort_order: number;
	active?: boolean;
}

/** The published lead form for a campaign (latest version). */
export interface DialerForm {
	id: string;
	org_id: string;
	form_key: string;
	version: number;
	name: string;
	status: 'draft' | 'published' | 'archived';
	schema: FormField[];
	created_at: string;
	updated_at: string;
}

/** A call-outcome the agent picks after a call. */
export interface DialerDisposition {
	id: string;
	org_id: string;
	campaign_id: string | null;
	disposition_key: string;
	label: string;
	sort_order: number;
	active: boolean;
}

/** leadForm/get response: the active form (null = none published) + dispositions. */
export interface LeadFormBundleResponse {
	statusCode: string;
	statusMessage: string;
	form?: DialerForm | null;
	dispositions?: DialerDisposition[];
}

/** lead/save + lead/update response. */
export interface SaveLeadResponse {
	statusCode: string;
	statusMessage: string;
	lead_id?: string;
}

/** call/disposition response for a completed call with no saved lead. */
export interface SaveCallDispositionResponse {
	statusCode: string;
	statusMessage: string;
	call_id?: string;
}

/** Fetch the active form + dispositions for the selected campaign. */
export const getLeadFormBundle = (
	campaignId: string
): Promise<LeadFormBundleResponse> =>
	qsPost('/policyPrinter/dialer/leadForm/get', {campaign_id: campaignId});

/** Persist the selected outcome directly on a call without creating a lead. */
export const saveCallDisposition = (payload: {
	campaign_id: string;
	twilio_call_sid: string;
	caller_phone?: string | null;
	disposition_id: string;
}): Promise<SaveCallDispositionResponse> =>
	qsPost('/policyPrinter/dialer/call/disposition', payload);

/** Save a lead captured during/after a call. The backend validates server-side. */
export const saveLead = (payload: {
	campaign_id: string;
	twilio_call_sid?: string | null;
	caller_phone?: string | null;
	name?: string | null;
	disposition_id?: string | null;
	form_data: Record<string, unknown>;
}): Promise<SaveLeadResponse> =>
	qsPost('/policyPrinter/dialer/lead/save', payload);

/** Update an existing lead (owning-agent only). Only provided fields change. */
export const updateLead = (payload: {
	lead_id: string;
	name?: string | null;
	disposition_id?: string | null;
	form_data?: Record<string, unknown>;
}): Promise<SaveLeadResponse> =>
	qsPost('/policyPrinter/dialer/lead/update', payload);

/* -------------------------------------------------------------------------- */
/* CRM activity tracker — unified leads + calls: list / detail / recording     */
/* -------------------------------------------------------------------------- */

/** What an activity row is: a saved lead, a call with no form saved, or both. */
export type ActivityKind = 'lead' | 'call' | 'both';
export type ActivityDirection = 'inbound' | 'outbound';

/** Filters for the activity list. Omit/blank a field to not filter on it. */
export interface ActivityFilters {
	campaign_id?: string | null;
	disposition_id?: string | null;
	caller_phone?: string | null;
	name?: string | null;
	created_from?: string | null;
	created_to?: string | null;
	status?: string | null;
	has_recording?: boolean | null;
	kind?: ActivityKind | null;
	direction?: ActivityDirection | null;
}

/**
 * One row in the unified activity list. `id` is a stable row id; `lead_id` /
 * `call_id` are nullable and tell the UI which detail/recording endpoint to call.
 * `has_recording` gates the recording button; the URL is fetched on demand.
 */
export interface ActivityListItem {
	id: string;
	kind: ActivityKind;
	lead_id: string | null;
	call_id: string | null;
	twilio_call_sid: string | null;
	direction: ActivityDirection | null;
	caller_phone: string | null;
	name: string | null;
	campaign_id: string | null;
	campaign_name: string | null;
	disposition_id: string | null;
	disposition_label: string | null;
	call_status: string | null;
	started_at: string | null;
	ended_at: string | null;
	has_recording: boolean;
	activity_at: string | null;
}

/** Paginated activity-list response (matches the wallet count+page envelope). */
export interface ActivityListResponse {
	statusCode: string;
	statusMessage: string;
	items?: ActivityListItem[];
	total?: number;
	totalPages?: number;
	currentPage?: number;
	limit?: number;
}

export interface ActivitySummary {
	ready_seconds: number;
	talk_seconds: number;
	active_seconds: number;
}

export interface ActivitySummaryResponse {
	statusCode: string;
	statusMessage: string;
	summary?: ActivitySummary;
}

/** One entry in a lead's audit timeline. */
export interface LeadEvent {
	id: string;
	event_type: string;
	detail: Record<string, unknown>;
	actor_user_id: string | null;
	created_at: string;
}

/**
 * The linked call's lifecycle (null when no call is linked). The recording is NOT
 * on this shape — fetch it separately via getLeadRecording, which mints a fresh
 * short-lived URL from the durable stored key (null = no recording yet / ever).
 */
export interface LeadCall {
	id: string;
	twilio_call_sid: string | null;
	caller_phone: string | null;
	status: string | null;
	started_at: string | null;
	answered_at: string | null;
	ended_at: string | null;
}

/** Full lead detail: the lead + its frozen snapshot, timeline, and call. */
export interface LeadDetailResponse {
	statusCode: string;
	statusMessage: string;
	lead?: {
		id: string;
		caller_phone: string | null;
		name: string | null;
		campaign_id: string | null;
		disposition_id: string | null;
		disposition_label: string | null;
		form_id: string | null;
		form_version: number | null;
		form_schema_snapshot: FormField[] | null;
		form_data: Record<string, unknown>;
		created_at: string;
		updated_at: string;
	};
	campaign_name?: string | null;
	events?: LeadEvent[];
	call?: LeadCall | null;
}

export interface RecordingResponse {
	statusCode: string;
	statusMessage: string;
	recording_url?: string | null;
}

/**
 * The caller's own activity — every lead AND every call (a call with no saved form
 * still appears, so its recording is reachable) — filtered + paginated, newest
 * first. Backend route is still /leads/list; the payload key is `items`.
 */
export const listActivity = (
	filters: ActivityFilters,
	limit: number,
	page: number
): Promise<ActivityListResponse> =>
	qsPost('/policyPrinter/dialer/leads/list', {filters, limit, page});

export const getActivitySummary = (
	startedAt: string,
	endedAt: string
): Promise<ActivitySummaryResponse> =>
	qsPost('/policyPrinter/dialer/activity/summary', {
		started_at: startedAt,
		ended_at: endedAt
	});

/** One latest activity record per caller, for the contact-oriented CRM view. */
export const listCrmContacts = (
	filters: ActivityFilters,
	limit: number,
	page: number,
	callbacksOnly = false
): Promise<ActivityListResponse> =>
	qsPost('/policyPrinter/dialer/crm/list', {
		filters,
		limit,
		page,
		callbacks_only: callbacksOnly
	});

/** Full detail for one of the caller's leads (owning-agent only). */
export const getLeadDetail = (leadId: string): Promise<LeadDetailResponse> =>
	qsPost('/policyPrinter/dialer/lead/detail', {lead_id: leadId});

/** The recording URL for one of the caller's leads (null = not available yet). */
export const getLeadRecording = (leadId: string): Promise<RecordingResponse> =>
	qsPost('/policyPrinter/dialer/lead/recording', {lead_id: leadId});

/**
 * The recording URL for one of the caller's calls — used by call-only activity rows
 * (no lead was saved). null = not available yet / none produced.
 */
export const getCallRecording = (callId: string): Promise<RecordingResponse> =>
	qsPost('/policyPrinter/dialer/call/recording', {call_id: callId});

/* -------------------------------------------------------------------------- */
/* Direct-dial returning-caller pull-up                                        */
/* -------------------------------------------------------------------------- */

/**
 * The full most-recent lead surfaced for a returning caller — the same shape as
 * lead/detail's `lead` + `campaign_name` + `call`, so the FE can drive LeadForm's
 * edit-in-place mode directly from it.
 */
export interface ReturningCallerLead {
	id: string;
	caller_phone: string | null;
	name: string | null;
	campaign_id: string | null;
	disposition_id: string | null;
	disposition_label: string | null;
	form_id: string | null;
	form_version: number | null;
	form_schema_snapshot: FormField[] | null;
	form_data: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

/**
 * returningCaller response. `is_direct_dial` is decided server-side from the agent's
 * reservation state: false ⇒ this was a Retreaver-routed call (a fresh lead, so no
 * history is returned). `most_recent_lead` (with its frozen snapshot + answers) drives
 * edit-in-place; `activity` is the prior leads+calls strip.
 */
export interface ReturningCallerResponse {
	statusCode: string;
	statusMessage: string;
	is_direct_dial?: boolean;
	most_recent_lead?: {
		lead: ReturningCallerLead;
		campaign_name: string | null;
		events: LeadEvent[];
		call: LeadCall | null;
	} | null;
	activity?: ActivityListItem[];
	total_matches?: number;
}

/**
 * Returning-caller pull-up for a live inbound call. The backend classifies the call
 * (direct-dial callback vs Retreaver-routed) and only returns prior history for a
 * direct dial. Owning-agent scoped. Empty history is a normal success.
 */
export const lookupReturningCaller = (
	callerPhone: string
): Promise<ReturningCallerResponse> =>
	qsPost('/policyPrinter/dialer/lead/returningCaller', {
		caller_phone: callerPhone
	});
