import type {
	PolicyPrinterRankKey,
	RankDefinition,
	RankIdentity
} from './types';

export const POLICY_PRINTER_RANK_ORDER: PolicyPrinterRankKey[] = [
	'recruit_1',
	'recruit_2',
	'recruit_3',
	'closer_1',
	'closer_2',
	'closer_3',
	'top_closer_1',
	'top_closer_2',
	'top_closer_3',
	'master_closer_1',
	'master_closer_2',
	'master_closer_3',
	'policy_printer'
];

const RANK_TITLES: Record<PolicyPrinterRankKey, string> = {
	recruit_1: 'Recruit 1',
	recruit_2: 'Recruit 2',
	recruit_3: 'Recruit 3',
	closer_1: 'Closer 1',
	closer_2: 'Closer 2',
	closer_3: 'Closer 3',
	top_closer_1: 'Top Closer 1',
	top_closer_2: 'Top Closer 2',
	top_closer_3: 'Top Closer 3',
	master_closer_1: 'Master Closer 1',
	master_closer_2: 'Master Closer 2',
	master_closer_3: 'Master Closer 3',
	policy_printer: 'Policy Printer'
};

export const rankIdentity = (rank: RankDefinition): RankIdentity => ({
	key: rank.key,
	title: rank.title,
	image_key: rank.image_key
});

export const rankIdentityFromKey = (key: PolicyPrinterRankKey): RankIdentity => ({
	key,
	title: RANK_TITLES[key],
	image_key: key
});

export const isRankPromotion = (
	previous: PolicyPrinterRankKey,
	current: PolicyPrinterRankKey
): boolean =>
	POLICY_PRINTER_RANK_ORDER.indexOf(current) >
	POLICY_PRINTER_RANK_ORDER.indexOf(previous);

export const isRankPromotionBlocked = (
	onCall: boolean,
	presenceStatus: string | null | undefined
): boolean => onCall || presenceStatus === 'ready';
