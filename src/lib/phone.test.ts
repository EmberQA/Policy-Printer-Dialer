import {describe, expect, it} from 'vitest';
import {
	stateFormValueFromCode,
	stateFormValueFromPhone,
	US_STATE_OPTIONS
} from './phone';

describe('lead state form values', () => {
	it('uses a normalized Retreaver state code for text fields', () => {
		expect(stateFormValueFromCode(' ny ')).toBe('New York (NY)');
	});

	it('matches configured option codes, names, and formatted values', () => {
		expect(
			stateFormValueFromCode('TX', [{value: 'tx', label: 'Texas'}])
		).toBe('tx');
		expect(stateFormValueFromCode('TX', US_STATE_OPTIONS)).toBe('Texas (TX)');
	});

	it('returns null for an unsupported Retreaver state', () => {
		expect(stateFormValueFromCode('ZZ')).toBeNull();
	});

	it('keeps area-code inference available as the fallback', () => {
		expect(stateFormValueFromPhone('+1 531 555 0123')).toBe('Nebraska (NE)');
	});
});
