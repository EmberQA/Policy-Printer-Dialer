import {describe, expect, it} from 'vitest';
import type {DialerDisposition} from '@/lib/api';
import {getSavedDispositionFallback} from './crmDisposition';

const current: DialerDisposition[] = [
	{
		id: '1',
		org_id: 'org',
		campaign_id: null,
		disposition_key: 'sold',
		label: 'Sold',
		sort_order: 1,
		active: true
	}
];

describe('CRM saved disposition fallback', () => {
	it('keeps a removed/inactive historical key and label visible', () => {
		expect(
			getSavedDispositionFallback('callback_old', 'Callback (legacy)', current)
		).toEqual({key: 'callback_old', label: 'Callback (legacy)'});
	});

	it('does not duplicate a saved key that is still in the current bundle', () => {
		expect(
			getSavedDispositionFallback('sold', 'Old Sold Label', current)
		).toBeNull();
	});

	it('falls back to the stable key when the saved label is absent', () => {
		expect(getSavedDispositionFallback('legacy', null, [])).toEqual({
			key: 'legacy',
			label: 'legacy'
		});
	});
});
