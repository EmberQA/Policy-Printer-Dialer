/**
 * Final-expense quote comparison (ENG-286) — mirrored from the backend
 * `bespoke_features/policy_printer/quotes/types.ts`. Keep in sync.
 */

export type LeadSource = 'dialer' | 'outbound';
export type ItkSex = 'Male' | 'Female';

export const ITK_PAYMENT_TYPES = [
	'Bank Draft/EFT',
	'Direct Express',
	'Credit Card',
	'Debit Card'
] as const;
export type ItkPaymentType = (typeof ITK_PAYMENT_TYPES)[number];

export const ITK_COVERAGE_TYPES = [
	'Level',
	'Graded/Modified',
	'Guaranteed',
	'Limited Pay',
	'SPWL'
] as const;

export const TOBACCO_OPTIONS = ['None', 'Cigarettes', 'Cigars', 'Chewing Tobacco', 'Vape', 'Nicotine Patch/Gum'] as const;

export interface ItkUnderwritingAnswer {
	answer: string;
	type: string;
	question?: string;
}

export interface ItkUnderwritingItem {
	name: string;
	type: 'Drug' | 'Health Condition';
	hospitalization: boolean;
	hospitalizationReason: string | null;
	answers: ItkUnderwritingAnswer[];
}

export interface ItkLimitedPay {
	constraint: string;
	monthly: string;
	yearly: string;
	addnd_monthly: string | null;
	addnd_yearly: string | null;
	face_amount: string;
	by_premium: boolean;
	warning: string | null;
}

export interface ItkQuoteResult {
	company: string;
	monthly: string;
	yearly: string;
	face_amount: string;
	by_premium: boolean;
	tier: number;
	tier_name: string;
	why: string[];
	warning: string | null;
	addnd: string | null;
	addnd_yearly: string | null;
	full_comp: boolean;
	comp_percent_lower: string;
	compensation_text: string;
	eapp_link: string;
	logo: string;
	plan_name: string;
	plan_info: string[];
	limited_pay: ItkLimitedPay[];
	is_spwl_quote: boolean;
	is_by_premium?: boolean;
}

export interface ItkExcluded {
	name: string;
	why: string[];
}

export type ItkCompareValueType = 'FACE_AMOUNT' | 'PREMIUM';
export type ItkCompareOptions = Record<string, string[]>;

export type ItkInputType = 'RADIO' | 'DATE' | 'DOUBLE_DATE' | 'DROPDOWN' | 'YES_NO';

export interface ItkTraversalQuestion {
	input_type: ItkInputType;
	type: string;
	text: string;
	options?: string[];
	currently_text?: string;
	currently_checkbox?: boolean;
	text2?: string;
	type2?: string;
}

export interface ItkTraversalResponse {
	has_next: boolean;
	has_prev: boolean;
	answer: string[] | null;
	name: string;
	is_drug: boolean;
	question: ItkTraversalQuestion | null;
	underwriting_items: ItkUnderwritingAnswer[];
	session_id: string;
}

export type TraversalAction = 'start' | 'answer' | 'prev' | 'edit' | 'get';

export interface QuoteClientInputs {
	sex: ItkSex | null;
	state: string | null;
	dobMonth: number | null;
	dobDay: number | null;
	dobYear: number | null;
	age: number | null;
	heightFeet: number | null;
	heightInches: number | null;
	weight: number | null;
	tobacco: string;
	paymentType: ItkPaymentType;
}

export interface QuoteCoverageInputs {
	mode: 'face' | 'premium';
	amount: number | null;
	coverageType: string;
}

export interface QuoteCompareInputs {
	company: string | null;
	coverageType: string | null;
	values: {type: ItkCompareValueType; value: number | null}[];
}

export interface PendingTraversal {
	name: string;
	isDrug: boolean;
	sessionId: string;
}

export interface PinnedQuote {
	company: string;
	plan_name: string;
	tier_name: string;
	monthly: string;
	yearly: string;
	face_amount: string;
	addnd: string | null;
	logo: string;
	eapp_link: string;
	label: string;
}

export interface QuoteSessionState {
	version: 1;
	activeTab: string;
	client: QuoteClientInputs;
	coverage: QuoteCoverageInputs;
	underwritingItems: ItkUnderwritingItem[];
	pendingTraversal: PendingTraversal | null;
	compare: QuoteCompareInputs;
	lastQuote: {at: string; quotes: ItkQuoteResult[]; excluded: ItkExcluded[]} | null;
	lastCompare: {at: string; data: ItkQuoteResult[]} | null;
	presentation: PinnedQuote[];
}

export interface QuoteSession {
	id: string;
	org_id: string;
	lead_id: string;
	lead_source: LeadSource;
	state: QuoteSessionState;
	version: number;
	created_by: string;
	updated_by: string;
	created_at: string;
	updated_at: string;
}

export interface LeadPrefill {
	firstName: string | null;
	lastName: string | null;
	phone: string | null;
	client: Partial<QuoteClientInputs>;
	coverage: Partial<QuoteCoverageInputs>;
}

export const COMPARE_SLOTS = 3;
export const MAX_PINNED_QUOTES = 3;

export const emptySessionState = (): QuoteSessionState => ({
	version: 1,
	activeTab: 'quoter',
	client: {
		sex: null,
		state: null,
		dobMonth: null,
		dobDay: null,
		dobYear: null,
		age: null,
		heightFeet: null,
		heightInches: null,
		weight: null,
		tobacco: 'None',
		paymentType: 'Bank Draft/EFT'
	},
	coverage: {mode: 'face', amount: null, coverageType: 'Level'},
	underwritingItems: [],
	pendingTraversal: null,
	compare: {
		company: null,
		coverageType: null,
		values: [
			{type: 'FACE_AMOUNT', value: 10000},
			{type: 'FACE_AMOUNT', value: 12500},
			{type: 'FACE_AMOUNT', value: 15000}
		]
	},
	lastQuote: null,
	lastCompare: null,
	presentation: []
});
