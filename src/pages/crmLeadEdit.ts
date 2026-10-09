import type {FormField} from '@/lib/api';
import {aliasedAnswer, coerceToField} from '@/leads/coerceField';

const normalizeFieldLabel = (label: string): string =>
	label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '');

/**
 * Seed the current campaign form with answers from the lead's saved snapshot.
 * Exact field keys (and former keys, e.g. gender → sex) win; matching human
 * labels preserve answers across other renamed keys. Each answer is coerced
 * onto the field's current type (old free-text height → the height option),
 * and dropped if it can't be — it would otherwise fail the save.
 */
export const buildLeadEditFormData = (
	currentSchema: FormField[],
	savedSchema: FormField[] | null,
	savedData: Record<string, unknown>
): Record<string, unknown> => {
	const savedFieldByLabel = new Map(
		(savedSchema ?? []).map((field) => [
			normalizeFieldLabel(field.label),
			field
		])
	);
	const next: Record<string, unknown> = {};

	for (const field of currentSchema) {
		let raw = aliasedAnswer(field, savedData);
		if (raw === undefined) {
			const savedField = savedFieldByLabel.get(normalizeFieldLabel(field.label));
			if (savedField) raw = savedData[savedField.key];
		}
		const value = raw === undefined ? undefined : coerceToField(field, raw);
		if (value !== undefined) next[field.key] = value;
	}

	return next;
};

export const formHasNameFields = (schema: FormField[]): boolean => {
	const keys = new Set(
		schema.filter((field) => field.active !== false).map((field) => field.key)
	);
	return keys.has('name') || keys.has('first_name') || keys.has('last_name');
};

/** Keep the CRM card's top-level name aligned with standard name form fields. */
export const deriveLeadName = (
	schema: FormField[],
	formData: Record<string, unknown>,
	fallbackName: string
): string | null => {
	const keys = new Set(
		schema.filter((field) => field.active !== false).map((field) => field.key)
	);
	if (keys.has('first_name') || keys.has('last_name')) {
		const hasEditedName =
			Object.prototype.hasOwnProperty.call(formData, 'first_name') ||
			Object.prototype.hasOwnProperty.call(formData, 'last_name');
		if (!hasEditedName) return fallbackName.trim() || null;
		const first =
			typeof formData.first_name === 'string' ? formData.first_name : '';
		const last = typeof formData.last_name === 'string' ? formData.last_name : '';
		return `${first} ${last}`.trim() || null;
	}
	if (keys.has('name')) {
		if (!Object.prototype.hasOwnProperty.call(formData, 'name')) {
			return fallbackName.trim() || null;
		}
		return typeof formData.name === 'string'
			? formData.name.trim() || null
			: null;
	}
	return fallbackName.trim() || null;
};
