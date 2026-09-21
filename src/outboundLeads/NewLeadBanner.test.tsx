import {describe, it, expect, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import type {LeadFundingStatus} from '@/lib/api';

const poll = vi.hoisted(() => ({
	count: 0,
	latest: null,
	funding: null as LeadFundingStatus | null,
	refresh: () => undefined
}));
vi.mock('./useNewLeadPoll', () => ({useNewLeadPoll: () => poll}));
vi.mock('@/session/DialerSessionProvider', () => ({
	useDialerSession: () => ({
		provisioned: true,
		device: {outputDeviceId: 'default'}
	})
}));
const noticeState = vi.hoisted(() => ({notice: null as any, dismiss: vi.fn()}));
vi.mock('./useLeadArrivalNotice', () => ({
	useLeadArrivalNotice: () => noticeState
}));
import {NewLeadBanner} from './NewLeadBanner';

const render = (path: string) =>
	renderToStaticMarkup(
		<MemoryRouter initialEntries={[path]}>
			<NewLeadBanner />
		</MemoryRouter>
	);
describe('global low-funds warning', () => {
	it.each(['/dial', '/outbound-leads'])(
		'shows funding without a pending lead on %s',
		(path) => {
			poll.funding = {
				balance_cents: 1200,
				active_order_count: 2,
				blocked_orders: [{order_id: 'old', unit_price_cents: 1500}]
			};
			const html = render(path);
			expect(html).toContain('1 of 2 active lead orders need funds');
			expect(html).toContain('Open wallet to add funds');
			expect(html).toContain('/dashboard/main');
			expect(html).toContain('View orders');
		}
	);
	it('removes the warning after a refill restores affordability', () => {
		poll.funding = {
			balance_cents: 1500,
			active_order_count: 2,
			blocked_orders: []
		};
		expect(render('/dial')).not.toContain('need funds');
	});
});

it.each(['/dial', '/outbound-leads'])(
	'shows the arrival notice even with no pending rows on %s',
	(path) => {
		noticeState.notice = {
			lead: {
				id: 'lead-1',
				first_name: 'Jane',
				last_name: 'Doe',
				state: 'us-tx'
			},
			count: 1
		};
		const html = render(path);
		expect(html).toContain('New lead:');
		expect(html).toContain('Jane D.');
		expect(html).toContain('Dismiss new lead notification');
		noticeState.notice = null;
	}
);
