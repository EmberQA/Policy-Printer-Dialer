/**
 * Quote comparison API (ENG-286) — POST /api/v1/qualityscore/policyPrinter/quotes/*.
 * `qsPost` flattens the nested envelope, so payload fields sit beside
 * statusCode/statusMessage.
 */

import {qsPost} from '@/lib/api';
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

export interface OpenSessionResponse extends Envelope {
	/** The E.164 number the quote is keyed by — every save uses it. */
	phone?: string;
	/** True when this open created the quote; false = resumed an existing one. */
	created?: boolean;
	lead_source?: LeadSource | null;
	prefill?: LeadPrefill;
	session?: QuoteSession | null;
	carriers?: string[] | null;
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
	qsPost('/policyPrinter/quotes/session/open', {
		...(target.leadId ? {lead_id: target.leadId} : {}),
		...(target.phone ? {phone: target.phone} : {})
	});

export const saveQuoteSession = (
	phone: string,
	state: QuoteSessionState,
	version: number
): Promise<SaveSessionResponse> =>
	qsPost('/policyPrinter/quotes/session/save', {phone, state, version});

export const runQuote = (
	state: QuoteSessionState
): Promise<Envelope & {quotes?: ItkQuoteResult[]; excluded?: ItkExcluded[]}> =>
	qsPost('/policyPrinter/quotes/quote', {state});

export const getCompareOptions = (
	state: string
): Promise<Envelope & {options?: ItkCompareOptions}> =>
	qsPost('/policyPrinter/quotes/compare/options', {state});

export const runCompare = (
	state: QuoteSessionState
): Promise<Envelope & {data?: ItkQuoteResult[]}> =>
	qsPost('/policyPrinter/quotes/compare', {state});

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
