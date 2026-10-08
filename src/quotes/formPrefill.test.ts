import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	dobPartsFromForm,
	heightFromForm,
	quotePrefillFromForm,
	stashFormPrefill,
	stateCodeFromForm,
	takeFormPrefill,
	weightFromForm
} from './formPrefill';

describe('standard lead form → quote prefill', () => {
	it('state: dropdown label, code, name, canonical', () => {
		expect(stateCodeFromForm('Florida (FL)')).toBe('FL');
		expect(stateCodeFromForm('fl')).toBe('FL');
		expect(stateCodeFromForm('West Virginia')).toBe('WV');
		expect(stateCodeFromForm('us-oh')).toBe('OH');
		expect(stateCodeFromForm('Narnia')).toBeNull();
		expect(stateCodeFromForm('')).toBeNull();
	});

	it('dob: US and ISO strings', () => {
		expect(dobPartsFromForm('04/05/1950')).toEqual({month: 4, day: 5, year: 1950});
		expect(dobPartsFromForm('4-5-1950')).toEqual({month: 4, day: 5, year: 1950});
		expect(dobPartsFromForm('1950-04-05')).toEqual({month: 4, day: 5, year: 1950});
		expect(dobPartsFromForm('13/05/1950')).toBeNull();
		expect(dobPartsFromForm('sometime')).toBeNull();
	});

	it('height + weight', () => {
		expect(heightFromForm("5'8")).toEqual({feet: 5, inches: 8});
		expect(heightFromForm('5ft 10in')).toEqual({feet: 5, inches: 10});
		expect(heightFromForm('68')).toEqual({feet: 5, inches: 8});
		expect(heightFromForm('tall')).toBeNull();
		expect(weightFromForm('180 lbs')).toBe(180);
		expect(weightFromForm('12')).toBeNull();
	});

	it('maps the standard keys; skips blanks', () => {
		expect(
			quotePrefillFromForm({
				first_name: ' Ann ',
				last_name: 'Lee',
				phone: '+15555550100',
				state: 'Ohio (OH)',
				dob: '01/02/1958',
				height: "5'4",
				weight: '150',
				sob: 'KY',
				notes: 'x'
			})
		).toEqual({
			firstName: 'Ann',
			lastName: 'Lee',
			phone: '+15555550100',
			client: {
				state: 'OH',
				dobMonth: 1,
				dobDay: 2,
				dobYear: 1958,
				heightFeet: 5,
				heightInches: 4,
				weight: 150
			}
		});
		expect(quotePrefillFromForm({})).toEqual({firstName: null, lastName: null, phone: null, client: {}});
	});
});

describe('handoff', () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('is one-time', () => {
		const key = stashFormPrefill({firstName: 'A', lastName: null, phone: null, client: {state: 'TX'}});
		expect(takeFormPrefill(key)).toMatchObject({firstName: 'A', client: {state: 'TX'}});
		expect(takeFormPrefill(key)).toBeNull();
		expect(takeFormPrefill(null)).toBeNull();
	});

	it('ignores stale handoffs', () => {
		vi.useFakeTimers();
		const key = stashFormPrefill({firstName: 'A', lastName: null, phone: null, client: {}});
		vi.advanceTimersByTime(11 * 60 * 1000);
		expect(takeFormPrefill(key)).toBeNull();
	});
});
