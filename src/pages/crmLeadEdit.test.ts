import {describe, expect, it} from 'vitest';
import type {FormField} from '@/lib/api';
import {
	buildLeadEditFormData,
	deriveLeadName,
	formHasNameFields
} from './crmLeadEdit';

const field = (
	key: string,
	label: string,
	sortOrder: number
): FormField => ({
	key,
	label,
	type: 'text',
	sort_order: sortOrder
});

describe('CRM lead editing', () => {
	it('preserves answers by key and falls back to normalized labels', () => {
		expect(
			buildLeadEditFormData(
				[
					field('first_name', 'First name', 1),
					field('mobile_phone', 'Phone Number', 2),
					field('new_only', 'New question', 3)
				],
				[
					field('first_name', 'First name', 1),
					field('phone', 'Phone number', 2),
					field('removed', 'Removed question', 3)
				],
				{
					first_name: 'Jordan',
					phone: '555-0100',
					removed: 'old answer'
				}
			)
		).toEqual({
			first_name: 'Jordan',
			mobile_phone: '555-0100'
		});
	});

	it('carries old free-text medical answers onto the controlled fields', () => {
		const current: FormField[] = [
			{key: 'height', label: 'Height', type: 'select', sort_order: 1, options: [{value: `5'7"`, label: `5'7"`}]},
			{key: 'weight', label: 'Weight (lbs)', type: 'number', sort_order: 2},
			{key: 'sex', label: 'Sex', type: 'radio', sort_order: 3, options: [{value: 'Male', label: 'Male'}, {value: 'Female', label: 'Female'}]},
			{key: 'tobacco', label: 'Tobacco / nicotine', type: 'select', sort_order: 4, options: [{value: 'None', label: 'None'}, {value: 'Cigarettes', label: 'Cigarettes'}]}
		];
		const saved = [field('height', 'Height', 1), field('weight', 'Weight', 2), field('gender', 'Gender', 3), field('tobacco', 'Tobacco', 4)];
		expect(
			buildLeadEditFormData(current, saved, {height: '5 ft 7', weight: '180 lbs', gender: 'm', tobacco: 'yes'})
		).toEqual({height: `5'7"`, weight: 180, sex: 'Male', tobacco: 'Cigarettes'});
		// Unparseable answers are dropped rather than failing the save.
		expect(buildLeadEditFormData(current, saved, {height: 'tall', weight: 'heavy'})).toEqual({});
	});

	it('derives the CRM contact name from standard form fields', () => {
		const schema = [
			field('first_name', 'First name', 1),
			field('last_name', 'Last name', 2)
		];
		expect(formHasNameFields(schema)).toBe(true);
		expect(
			deriveLeadName(
				schema,
				{first_name: 'Jordan', last_name: 'Lee'},
				'Old Name'
			)
		).toBe('Jordan Lee');
	});

	it('uses the explicit contact name when the form has no name field', () => {
		const schema = [field('email', 'Email', 1)];
		expect(formHasNameFields(schema)).toBe(false);
		expect(deriveLeadName(schema, {}, '  Jordan Lee  ')).toBe('Jordan Lee');
	});

	it('preserves the existing contact name when name fields are newly added', () => {
		const schema = [
			field('first_name', 'First name', 1),
			field('last_name', 'Last name', 2)
		];
		expect(deriveLeadName(schema, {}, 'Jordan Lee')).toBe('Jordan Lee');
	});
});
