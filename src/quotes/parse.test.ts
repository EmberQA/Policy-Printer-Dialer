import {describe, expect, it} from 'vitest';
import {parseDob, parseHeight, parseTobacco, parseWeight} from './parse';

describe('parseHeight', () => {
	const fiveSeven = {feet: 5, inches: 7};
	it.each([
		`5'7"`,
		`5'7`,
		`5' 7"`,
		`5’7”`,
		`5′7″`,
		`5 7`,
		`5-7`,
		`5.7`,
		`5/7`,
		`5,7`,
		`5ft7in`,
		`5ft 7in`,
		`5 ft 7 in`,
		`5 ft. 7 in.`,
		`5 foot 7 inches`,
		`5 Foot 7 Inches`,
		`5 feet 7`,
		`5 feet and 7 inches`,
		`5'7 1/2"`,
		`67`,
		`67in`,
		`67 in`,
		`67 inches`,
		`67"`,
		`67 1/2 in`,
		`170 cm`,
		`170cm`,
		`1.7 m`
	])('%s → 5\'7"', (raw) => expect(parseHeight(raw)).toEqual(fiveSeven));

	it.each([
		[`5'`, {feet: 5, inches: 0}],
		[`5 ft`, {feet: 5, inches: 0}],
		[`5`, {feet: 5, inches: 0}],
		[`6'0"`, {feet: 6, inches: 0}],
		[`5.10`, {feet: 5, inches: 10}],
		[`5'11"`, {feet: 5, inches: 11}],
		[`72`, {feet: 6, inches: 0}],
		[`4'11`, {feet: 4, inches: 11}],
		[68, {feet: 5, inches: 8}]
	])('%s', (raw, want) => expect(parseHeight(raw)).toEqual(want));

	it.each([``, `tall`, `5'13"`, `9'2`, `12`, `200`, `2`, null, undefined, `5 7 8`])(
		'%s → null',
		(raw) => expect(parseHeight(raw)).toBeNull()
	);
});

describe('parseWeight', () => {
	it.each([
		['180', 180],
		['180lb', 180],
		['180 lbs', 180],
		['180 lbs.', 180],
		['180 pounds', 180],
		['180#', 180],
		['~180', 180],
		['about 180', 180],
		['approx 180 lbs', 180],
		['180-185', 180],
		['180 to 185 lbs', 180],
		['180.6', 181],
		['1,050', null],
		['82 kg', 181],
		['82kgs', 181],
		[180, 180]
	])('%s → %s', (raw, want) => expect(parseWeight(raw)).toBe(want));

	it.each(['', 'heavy', '12', '900', null])('%s → null', (raw) =>
		expect(parseWeight(raw)).toBeNull()
	);
});

describe('parseDob', () => {
	const jan2 = {month: 1, day: 2, year: 1958};
	it.each([
		'01/02/1958',
		'1/2/1958',
		'1-2-1958',
		'1.2.1958',
		'1 2 1958',
		'1/2/58',
		'01021958',
		'1958-01-02',
		'1958/01/02',
		'1958-01-02T00:00:00.000Z',
		'January 2, 1958',
		'january 2 1958',
		'Jan 2 1958',
		'Jan. 2nd, 1958',
		'2 January 1958',
		'2nd Jan 1958'
	])('%s → 1958-01-02', (raw) => expect(parseDob(raw)).toEqual(jan2));

	it.each(['', 'sometime', '13/02/1958', '02/30/1958', '04/31/1958', 'Smarch 2 1958', '1/2/1850'])(
		'%s → null',
		(raw) => expect(parseDob(raw)).toBeNull()
	);

	it('Feb 29 is allowed', () => expect(parseDob('2/29/1960')).toEqual({month: 2, day: 29, year: 1960}));
});

describe('parseTobacco', () => {
	it.each([
		['None', 'None'],
		['vape', 'Vape'],
		['Nicotine Patch/Gum', 'Nicotine Patch/Gum'],
		['Yes', 'Cigarettes'],
		['y', 'Cigarettes'],
		['smoker', 'Cigarettes'],
		['vaping', 'Cigarettes'],
		['no', 'None'],
		['N', 'None'],
		['non-smoker', 'None'],
		['never', 'None']
	])('%s → %s', (raw, want) => expect(parseTobacco(raw)).toBe(want));
	it.each(['', 'sometimes', 'quit 2019'])('%s → null', (raw) => expect(parseTobacco(raw)).toBeNull());
});
