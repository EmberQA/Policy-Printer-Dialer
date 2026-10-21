import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {Children, isValidElement, type ReactElement, type ReactNode} from 'react';
import type {DeliveredLead, DirectDeliveredLead, OutboundLead} from '@/lib/api';
import {QuoteButton} from '@/quotes/QuoteButton';
import {openQuoteComparison} from '@/quotes/quoteLink';
import {PurchasedLeadRow} from './PurchasedLeadRow';

vi.mock('@/quotes/quoteLink', () => ({openQuoteComparison: vi.fn()}));

const lead: DirectDeliveredLead = {
	kind: 'direct', id: '11111111-1111-4111-8111-111111111111',
	first_name: 'Jane Doe', last_name: '', phone: '+12025550123', state: null,
	coverage_type: null, assigned_at: '2026-10-21T17:00:00Z', acknowledged_at: null,
	disposition_label: null, vendor_name: 'Direct vendor',
	age: null, status: 'new', agent_note: 'Saved note', call_count: 2,
	first_called_at: '2026-10-21T17:05:00Z', last_called_at: '2026-10-21T17:10:00Z',
	updated_at: '2026-10-21T17:10:00Z',
	form_data: {language: 'Spanish', notes: 'Vendor note', household: {adults: 2}}
};
const props = {
	lead, jurisdictions: [], onCall: vi.fn(), dialing: false, canDial: true,
	expanded: false, onToggle: vi.fn(), onStatusChange: vi.fn()
};
const render = (record: DeliveredLead = lead, expanded = false) => renderToStaticMarkup(
	<MemoryRouter><table><tbody><PurchasedLeadRow {...props} lead={record} expanded={expanded} /></tbody></table></MemoryRouter>
);
function elements(node: ReactNode): ReactElement<any>[] {
	return Children.toArray(node).flatMap((child) => isValidElement<{children?: ReactNode}>(child)
		? [child, ...elements(child.props.children)] : []);
}

describe('shared delivered lead row', () => {
	it('shows the direct delivery status and the same inline View action', () => {
		const html = render();
		expect(html).toContain('Jane Doe');
		expect(html).toContain('Direct post');
		expect(html).toContain('(202) 555-0123');
		expect(html).toContain('>View</button>');
		expect(html).not.toContain('/crm?lead_id=');
		expect(html).toContain('Quote');
		expect(html).not.toContain('Final expense');
		expect(html).toContain('>New<');
		expect(html).not.toContain('Paid');
		expect(html.match(/>—<\/td>/g)).toHaveLength(3);
	});
	it('uses the shared saved status badge', () => {
		expect(render({...lead, status: 'contacted'})).toContain('Contacted');
	});
	it('passes the existing direct record to Call and Quote, and toggles inline View', () => {
		const tree = elements(PurchasedLeadRow(props));
		tree.find((element) => element.props['aria-label'] === 'Call Jane Doe')!.props.onClick();
		expect(props.onCall).toHaveBeenLastCalledWith(lead);
		tree.find((element) => element.type === QuoteButton)!.props.onClick();
		expect(openQuoteComparison).toHaveBeenLastCalledWith(lead.id);
		tree.find((element) => element.props.children === 'View')!.props.onClick();
		expect(props.onToggle).toHaveBeenCalledOnce();
	});
	it('honors the shared dialer readiness gate', () => {
		const tree = elements(PurchasedLeadRow({...props, canDial: false}));
		expect(tree.find((element) => element.props['aria-label'] === 'Call Jane Doe')!.props.disabled).toBe(true);
	});
	it('gives direct and purchased leads the same outcome, note, and attempt controls', () => {
		const purchased = {
			...lead, kind: undefined, age: 68, coverage_type: 'final_expense',
			date_of_birth: '1958-01-01', coverage_amount: 10000, price_cents: 1500,
			email: null, address: null, city: null, state: 'us-tx', zip: '75001',
			trusted_form_url: null
		} as unknown as OutboundLead;
		const directHtml = render(lead, true);
		const purchasedHtml = render(purchased, true);
		for (const html of [directHtml, purchasedHtml]) {
			for (const label of ['Outcome', 'Contacted', 'No answer', 'Not interested', 'Sold', 'Note', 'Saved note', 'Save', 'Call attempts', 'First called', 'Last called']) {
				expect(html).toContain(label);
			}
		}
		expect(directHtml).toContain('Spanish');
		expect(directHtml).toContain('Vendor note');
		expect(directHtml).toContain('&quot;adults&quot;: 2');
		expect(directHtml).not.toContain('>Paid<');
		expect(directHtml).not.toContain('Date of birth');
		expect(purchasedHtml).toContain('>Paid<');
		expect(purchasedHtml).toContain('$15.00');
	});
});
