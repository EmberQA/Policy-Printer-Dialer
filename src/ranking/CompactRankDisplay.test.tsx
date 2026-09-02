import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {CompactRankDisplay} from './CompactRankDisplay';
import type {RankingProgress} from './types';

const recruitOne: RankingProgress = {
	xp: 50,
	ai_sales: 0,
	current_rank: {
		key: 'recruit_1',
		title: 'Recruit 1',
		xp_required: 0,
		sales_required: 0,
		image_key: 'recruit_1'
	},
	next_rank: {
		key: 'recruit_2',
		title: 'Recruit 2',
		xp_required: 50,
		sales_required: 1,
		image_key: 'recruit_2'
	},
	xp_remaining: 0,
	sales_remaining: 1,
	xp_progress_percent: 100,
	sales_progress_percent: 0,
	version: 1,
	updated_at: '2026-09-01T20:00:00.000Z'
};

describe('CompactRankDisplay', () => {
	it('renders both determinate gates when one gate is blocked', () => {
		const html = renderToStaticMarkup(
			<CompactRankDisplay progress={recruitOne} onViewRankSystem={() => undefined} />
		);
		expect(html).toContain('Current rank Recruit 1');
		expect(html).toContain('View rank system');
		expect(html).toContain('Printer Points progress to Recruit 2: 50 of 50');
		expect(html).toContain('AI sales progress to Recruit 2: 0 of 1');
		expect(html.match(/role="progressbar"/g)).toHaveLength(2);
	});

	it('renders the Policy Printer max-rank state without progress gates', () => {
		const html = renderToStaticMarkup(
			<CompactRankDisplay
				onViewRankSystem={() => undefined}
				progress={{
					...recruitOne,
					xp: 5000,
					ai_sales: 100,
					current_rank: {
						key: 'policy_printer',
						title: 'Policy Printer',
						xp_required: 5000,
						sales_required: 100,
						image_key: 'policy_printer'
					},
					next_rank: null,
					xp_remaining: 0,
					sales_remaining: 0,
					xp_progress_percent: 100,
					sales_progress_percent: 100
				}}
			/>
		);
		expect(html).toContain('Current rank Policy Printer');
		expect(html).toContain('Max rank');
		expect(html).not.toContain('role="progressbar"');
	});
});
