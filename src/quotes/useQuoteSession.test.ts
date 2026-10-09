import {describe, expect, it, vi} from 'vitest';

const openQuoteSession = vi.fn();
vi.mock('./api', () => ({
	QS_SUCCESS: 'SP100',
	openQuoteSession: (...a: unknown[]) => openQuoteSession(...a),
	saveQuoteSession: vi.fn()
}));

import {openQuoteSessionOnce} from './useQuoteSession';

describe('openQuoteSessionOnce', () => {
	it("StrictMode's double mount effect opens the quote ONCE", async () => {
		// Regression: two racing opens → the first created the quote, the second
		// answered created:false → "This number already has a quote" for a new caller.
		openQuoteSession.mockResolvedValue({statusCode: 'SP100', phone: '+16135688822', created: true});
		const target = {leadId: null, phone: '(613) 568-8822'};
		const [a, b] = await Promise.all([openQuoteSessionOnce(target), openQuoteSessionOnce({...target})]);
		expect(openQuoteSession).toHaveBeenCalledTimes(1);
		expect(a.created).toBe(true);
		expect(b).toBe(a);
	});
});
