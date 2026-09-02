export type PolicyPrinterRankKey =
	| 'recruit_1'
	| 'recruit_2'
	| 'recruit_3'
	| 'closer_1'
	| 'closer_2'
	| 'closer_3'
	| 'top_closer_1'
	| 'top_closer_2'
	| 'top_closer_3'
	| 'master_closer_1'
	| 'master_closer_2'
	| 'master_closer_3'
	| 'policy_printer';

export interface RankDefinition {
	key: PolicyPrinterRankKey;
	title: string;
	sales_required: number;
	xp_required: number;
	image_key: PolicyPrinterRankKey;
}

export interface RankingProgress {
	xp: number;
	ai_sales: number;
	current_rank: RankDefinition;
	next_rank: RankDefinition | null;
	xp_remaining: number;
	sales_remaining: number;
	xp_progress_percent: number;
	sales_progress_percent: number;
	version: number;
	updated_at: string | null;
}

export interface RankingProgressResponse {
	statusCode: string;
	statusMessage: string;
	ranking_enabled?: boolean;
	progress?: RankingProgress;
}

export interface RankIdentity {
	key: PolicyPrinterRankKey;
	title: string;
	image_key: PolicyPrinterRankKey;
}

export interface RankPromotion {
	previous_rank: RankIdentity;
	current_rank: RankIdentity;
}
