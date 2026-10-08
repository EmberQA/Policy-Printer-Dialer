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
	lead_source?: LeadSource;
	prefill?: LeadPrefill;
	session?: QuoteSession | null;
	carriers?: string[] | null;
}

export interface SaveSessionResponse extends Envelope {
	session?: QuoteSession;
	current?: QuoteSession | null;
}

export const openQuoteSession = (leadId: string): Promise<OpenSessionResponse> =>
	qsPost('/policyPrinter/quotes/session/open', {lead_id: leadId});

export const saveQuoteSession = (
	leadId: string,
	state: QuoteSessionState,
	version: number
): Promise<SaveSessionResponse> =>
	qsPost('/policyPrinter/quotes/session/save', {lead_id: leadId, state, version});

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
