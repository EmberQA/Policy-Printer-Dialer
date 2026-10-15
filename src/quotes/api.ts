/**
 * Quote comparison API (ENG-286) — POST /api/v1/qualityscore/policyPrinter/quotes/*.
 * `qsPost` flattens the nested envelope, so payload fields sit beside
 * statusCode/statusMessage.
 */

import {qsPost} from '@/lib/api';
import {setQuoteAllowance, type QuoteAllowance} from './allowance';
import type {
	ItkCompareOptions,
	ItkExcluded,
	ItkQuoteResult,
	ItkTraversalResponse,
	ItkUnderwritingItem,
	LeadPrefill,
	LeadSource,
	QuoteSession,
	QuoteSessionState,
	TraversalAction
} from './types';

interface Envelope {
	statusCode: string;
	statusMessage: string;
}

export const QS_SUCCESS = 'SP100';

/**
 * qsPost throws on any non-2xx, which would turn a readable BAD_REQUEST (e.g. "You've
 * used your 10 free quotes this month…") into axios's "status code 400". The backend
 * sends the same envelope on errors, so flatten it the same way and let the caller
 * show statusMessage. Also records the allowance any response carries.
 */
const quotePost = async <T extends Envelope & {quote_allowance?: QuoteAllowance}>(
	path: string,
	body: Record<string, unknown>
): Promise<T> => {
	let res: T;
	try {
		res = await qsPost<T>(path, body);
	} catch (err: any) {
		const envelope = err?.response?.data;
		if (!envelope?.statusCode) throw err;
		res = {...(envelope.data ?? {}), statusCode: envelope.statusCode, statusMessage: envelope.statusMessage} as T;
	}
	setQuoteAllowance(res.quote_allowance);
	return res;
};

export interface OpenSessionResponse extends Envelope {
	/** The E.164 number the quote is keyed by — every save uses it. */
	phone?: string;
	/** True when this open created the quote; false = resumed an existing one. */
	created?: boolean;
	lead_source?: LeadSource | null;
	prefill?: LeadPrefill;
	session?: QuoteSession | null;
	carriers?: string[] | null;
	quote_allowance?: QuoteAllowance;
}

export interface SaveSessionResponse extends Envelope {
	session?: QuoteSession;
	current?: QuoteSession | null;
}

/** Open (creating on first open) the quote for a caller — by phone, or by a saved lead's id. */
export const openQuoteSession = (target: {
	leadId?: string | null;
	phone?: string | null;
}): Promise<OpenSessionResponse> =>
	qsPost<OpenSessionResponse>('/policyPrinter/quotes/session/open', {
		...(target.leadId ? {lead_id: target.leadId} : {}),
		...(target.phone ? {phone: target.phone} : {})
	}).then((res) => {
		setQuoteAllowance(res.quote_allowance);
		return res;
	});

export const saveQuoteSession = (
	phone: string,
	state: QuoteSessionState,
	version: number
): Promise<SaveSessionResponse> =>
	qsPost('/policyPrinter/quotes/session/save', {phone, state, version});

export const runQuote = (
	state: QuoteSessionState
): Promise<Envelope & {quotes?: ItkQuoteResult[]; excluded?: ItkExcluded[]; quote_allowance?: QuoteAllowance}> =>
	quotePost('/policyPrinter/quotes/quote', {state});

export const getCompareOptions = (
	state: string
): Promise<Envelope & {options?: ItkCompareOptions}> =>
	qsPost('/policyPrinter/quotes/compare/options', {state});

export const runCompare = (
	state: QuoteSessionState
): Promise<Envelope & {data?: ItkQuoteResult[]; quote_allowance?: QuoteAllowance}> =>
	quotePost('/policyPrinter/quotes/compare', {state});

export const searchUnderwriting = (
	kind: 'drug' | 'condition',
	name: string
): Promise<Envelope & {results?: string[]}> =>
	qsPost(`/policyPrinter/quotes/search/${kind}`, {name});

export const traversalStep = (
	action: TraversalAction,
	body: {name?: string; is_drug?: boolean; session_id?: string; answer?: string[]}
): Promise<Envelope & {traversal?: ItkTraversalResponse; item?: ItkUnderwritingItem | null}> =>
	qsPost(`/policyPrinter/quotes/traversal/${action}`, body);

export const getMyCarriers = (): Promise<
	Envelope & {companies?: string[]; selected?: string[] | null}
> => qsPost('/policyPrinter/quotes/carriers/get');

export const saveMyCarriers = (
	carriers: string[]
): Promise<Envelope & {selected?: string[] | null}> =>
	qsPost('/policyPrinter/quotes/carriers/save', {carriers});
