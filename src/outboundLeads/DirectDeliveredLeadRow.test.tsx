import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {Children, isValidElement, type ReactElement, type ReactNode} from 'react';
import type {DirectDeliveredLead} from '@/lib/api';
import {QuoteButton} from '@/quotes/QuoteButton';
import {openQuoteComparison} from '@/quotes/quoteLink';
import {DirectDeliveredLeadRow} from './DirectDeliveredLeadRow';

vi.mock('@/quotes/quoteLink', () => ({openQuoteComparison: vi.fn()}));

const lead: DirectDeliveredLead = {
	kind: 'direct', id: '11111111-1111-4111-8111-111111111111',
	first_name: 'Jane Doe', last_name: '', phone: '+12025550123', state: null,
	coverage_type: null, assigned_at: '2026-10-21T17:00:00Z', acknowledged_at: null,
	disposition_label: null, vendor_name: 'Direct vendor'
};
const props = {lead, jurisdictions: [], onCall: vi.fn(), dialing: false, canDial: true};
const render = (record = lead) => renderToStaticMarkup(
	<MemoryRouter><table><tbody><DirectDeliveredLeadRow {...props} lead={record} /></tbody></table></MemoryRouter>
);
function elements(node: ReactNode): ReactElement<any>[] {
	return Children.toArray(node).flatMap((child) => isValidElement<{children?: ReactNode}>(child)
		? [child, ...elements(child.props.children)] : []);
}

describe('direct deliveries in Your leads', () => {
	it('shows a campaign-free CRM lead without inventing purchase details or status', () => {
		const html = render();
		expect(html).toContain('Jane Doe');
		expect(html).toContain('Direct post');
		expect(html).toContain('(202) 555-0123');
		expect(html).toContain(`href="/crm?lead_id=${lead.id}"`);
		expect(html).toContain('Quote');
		expect(html).not.toContain('Final expense');
		expect(html).not.toContain('>New<');
		expect(html).not.toContain('Paid');
		expect(html.match(/>—<\/td>/g)).toHaveLength(4);
	});
	it('uses the saved CRM disposition when present', () => {
		expect(render({...lead, disposition_label: 'Follow Up'})).toContain('Follow Up');
	});
	it('passes the existing CRM record to Call and Quote', () => {
		const tree = elements(DirectDeliveredLeadRow(props));
		tree.find((element) => element.props['aria-label'] === 'Call Jane Doe')!.props.onClick();
		expect(props.onCall).toHaveBeenLastCalledWith(lead);
		tree.find((element) => element.type === QuoteButton)!.props.onClick();
		expect(openQuoteComparison).toHaveBeenLastCalledWith(lead.id);
	});
	it('honors the shared dialer readiness gate', () => {
		const tree = elements(DirectDeliveredLeadRow({...props, canDial: false}));
		expect(tree.find((element) => element.props['aria-label'] === 'Call Jane Doe')!.props.disabled).toBe(true);
	});
});
