import closer1 from '@/assets/ranking/badges/closer_1.png';
import closer2 from '@/assets/ranking/badges/closer_2.png';
import closer3 from '@/assets/ranking/badges/closer_3.png';
import masterCloser1 from '@/assets/ranking/badges/master_closer_1.png';
import masterCloser2 from '@/assets/ranking/badges/master_closer_2.png';
import masterCloser3 from '@/assets/ranking/badges/master_closer_3.png';
import policyPrinter from '@/assets/ranking/badges/policy_printer.png';
import recruit1 from '@/assets/ranking/badges/recruit_1.png';
import recruit2 from '@/assets/ranking/badges/recruit_2.png';
import recruit3 from '@/assets/ranking/badges/recruit_3.png';
import topCloser1 from '@/assets/ranking/badges/top_closer_1.png';
import topCloser2 from '@/assets/ranking/badges/top_closer_2.png';
import topCloser3 from '@/assets/ranking/badges/top_closer_3.png';
import type {PolicyPrinterRankKey} from './types';

const BADGE_IMAGES: Record<PolicyPrinterRankKey, string> = {
	recruit_1: recruit1,
	recruit_2: recruit2,
	recruit_3: recruit3,
	closer_1: closer1,
	closer_2: closer2,
	closer_3: closer3,
	top_closer_1: topCloser1,
	top_closer_2: topCloser2,
	top_closer_3: topCloser3,
	master_closer_1: masterCloser1,
	master_closer_2: masterCloser2,
	master_closer_3: masterCloser3,
	policy_printer: policyPrinter
};

export function RankBadge({
	rankKey,
	title,
	size = 40
}: {
	rankKey: PolicyPrinterRankKey;
	title: string;
	size?: number;
}) {
	return (
		<img
			src={BADGE_IMAGES[rankKey]}
			alt={`${title} rank badge`}
			className="shrink-0 object-contain"
			style={{width: size, height: size}}
		/>
	);
}
