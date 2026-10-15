import {describe, expect, it} from 'vitest';
import type {FormField} from '@/lib/api';
import {aliasedAnswer, coerceToField} from './coerceField';

const opts = (...values: string[]) => values.map((value) => ({value, label: value}));
const select = (key: string, values: string[], type: 'select' | 'radio' = 'select'): FormField => ({
	key,
	label: key,
	type,
	sort_order: 1,
	options: opts(...values)
});
const HEIGHT = select('height', [`4'11"`, `5'0"`, `5'7"`, `6'0"`]);
const TOBACCO = select('tobacco', ['None', 'Cigarettes', 'Cigars', 'Chewing Tobacco', 'Vape', 'Nicotine Patch/Gum']);
const SEX = select('sex', ['Male', 'Female'], 'radio');
const WEIGHT: FormField = {key: 'weight', label: 'Weight (lbs)', type: 'number', sort_order: 1};

describe('coerceToField', () => {
	it.each([`5'7"`, '5 ft 7', '5 foot 7 inches', '67', '67 inches', '5.7'])('height %s → 5\'7"', (raw) =>
		expect(coerceToField(HEIGHT, raw)).toBe(`5'7"`)
	);
	it('height: 5 feet → the 5\'0" option; nonsense or off-list → dropped', () => {
		expect(coerceToField(HEIGHT, '5 ft')).toBe(`5'0"`);
		expect(coerceToField(HEIGHT, 'tall')).toBeUndefined();
		expect(coerceToField(HEIGHT, `5'3"`)).toBeUndefined();
	});
	it.each([
		['Vape', 'Vape'],
		['vape', 'Vape'],
		['yes', 'Cigarettes'],
		['smoker', 'Cigarettes'],
		['no', 'None'],
		['non-smoker', 'None']
	])('tobacco %s → %s', (raw, want) => expect(coerceToField(TOBACCO, raw)).toBe(want));
	it.each([
		['Male', 'Male'],
		['m', 'Male'],
		['female', 'Female'],
		['F', 'Female']
	])('sex %s → %s', (raw, want) => expect(coerceToField(SEX, raw)).toBe(want));
	it('weight: free text → pounds; implausible → dropped', () => {
		expect(coerceToField(WEIGHT, '180 lbs')).toBe(180);
		expect(coerceToField(WEIGHT, 165)).toBe(165);
		expect(coerceToField(WEIGHT, '12')).toBeUndefined();
	});
	it('date: any DOB format → YYYY-MM-DD; unreadable → dropped', () => {
		const DOB: FormField = {key: 'dob', label: 'Date of birth', type: 'date', sort_order: 1};
		expect(coerceToField(DOB, '1958-01-02')).toBe('1958-01-02');
		expect(coerceToField(DOB, '01/02/1958')).toBe('1958-01-02');
		expect(coerceToField(DOB, 'Jan 2 1958')).toBe('1958-01-02');
		expect(coerceToField(DOB, '1/2/58')).toBe('1958-01-02');
		expect(coerceToField(DOB, 'sometime in the 50s')).toBeUndefined();
	});
	it('leaves other types and empty values alone', () => {
		const text: FormField = {key: 'notes', label: 'Notes', type: 'text', sort_order: 1};
		expect(coerceToField(text, 'anything')).toBe('anything');
		expect(coerceToField(HEIGHT, '')).toBe('');
	});
});

describe('aliasedAnswer', () => {
	it('reads sex from a former gender key; own key wins', () => {
		expect(aliasedAnswer(SEX, {gender: 'F'})).toBe('F');
		expect(aliasedAnswer(SEX, {sex: 'Male', gender: 'F'})).toBe('Male');
		expect(aliasedAnswer(HEIGHT, {gender: 'F'})).toBeUndefined();
	});
});
