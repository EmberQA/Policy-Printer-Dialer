import {describe, expect, it} from 'vitest';
import {initialAnswer, previousAnswer} from './TraversalDialog';
import type {ItkTraversalResponse, ItkUnderwritingItem} from './types';

// Shapes copied from a live ITK Eliquis questionnaire (2026-10-09).
const eliquis: ItkUnderwritingItem = {
	name: 'Eliquis',
	type: 'Drug',
	hospitalization: false,
	hospitalizationReason: null,
	answers: [
		{answer: 'Heart Surgery', type: 'indication'},
		{answer: '2018-01-01', type: 'first_fill'},
		{answer: 'current', type: 'time_dependent'},
		{answer: 'Yes', type: 'yes_no', question: 'Was the surgery to implant a defibrillator?'}
	]
};
const step = (question: ItkTraversalResponse['question'], answer: string[] | null = null) =>
	({has_next: true, has_prev: true, answer, underwriting_items: [], name: 'Eliquis', is_drug: true, question, session_id: 's'}) as ItkTraversalResponse;

describe('previousAnswer', () => {
	it('matches by type; last_action reads the stored time_dependent', () => {
		expect(previousAnswer(eliquis, 'indication')).toBe('Heart Surgery');
		expect(previousAnswer(eliquis, 'last_action')).toBe('current');
		expect(previousAnswer(eliquis, 'first_fill')).toBe('2018-01-01');
	});
	it('yes/no answers match on the question text', () => {
		expect(previousAnswer(eliquis, 'yes_no', 'Was the surgery to implant a defibrillator?')).toBe('Yes');
		expect(previousAnswer(eliquis, 'yes_no', 'Some other question?')).toBeNull();
	});
	it('nothing to prefill when not editing', () => {
		expect(previousAnswer(null, 'indication')).toBeNull();
	});
});

describe('initialAnswer', () => {
	it('the session answer (Back) wins over the saved item', () => {
		expect(initialAnswer(step({input_type: 'RADIO', type: 'indication', text: 'Indication', options: ['Heart Surgery', 'AFib']}, ['AFib']), eliquis)).toEqual(['AFib']);
	});
	it('prefills a choice only if it is still offered', () => {
		const q = (options: string[]) => step({input_type: 'RADIO', type: 'indication', text: 'Indication', options});
		expect(initialAnswer(q(['Heart Surgery', 'AFib']), eliquis)).toEqual(['Heart Surgery']);
		expect(initialAnswer(q(['AFib']), eliquis)).toEqual([]);
	});
	it('double date: [last use or current, first fill]', () => {
		expect(
			initialAnswer(step({input_type: 'DOUBLE_DATE', type: 'last_action', text: 'Date of last use/fill', currently_checkbox: true, text2: 'Date of first fill?', type2: 'first_fill'}), eliquis)
		).toEqual(['current', '2018-01-01']);
	});
});
