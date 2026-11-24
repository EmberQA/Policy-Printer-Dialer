import {listCrmContacts, type ActivityListItem} from '@/lib/api';
import {importedContactToActivity, type ImportedTldContact} from './tldImport';

// The CRM endpoint accepts at most 100 contacts per request.
const PAGE_SIZE = 100;

function csvCell(value: string | null | undefined): string {
	const text = value ?? '';
	// Keep contact text from being interpreted as a spreadsheet formula.
	const safeText = /^[\t\r\n]|^\s*[=+\-@＝＋－＠]/u.test(text)
		? `'${text}`
		: text;
	return `"${safeText.replaceAll('"', '""')}"`;
}

function contactRow(contact: ActivityListItem, imported?: ImportedTldContact) {
	return [
		contact.name,
		contact.caller_phone,
		imported?.email,
		imported?.phone ? imported.alternatePhone : null,
		contact.campaign_name,
		contact.disposition_label,
		contact.activity_at,
		imported ? 'TLD import' : 'Lead'
	]
		.map(csvCell)
		.join(',');
}

export async function buildCrmContactsCsv(
	importedContacts: ImportedTldContact[]
): Promise<string> {
	const rows = [
		'Name,Phone,Email,Alternate phone,Campaign,Disposition,Saved at,Source',
		...importedContacts.map((contact) =>
			contactRow(importedContactToActivity(contact), contact)
		)
	];
	let totalPages = 1;
	for (let page = 1; page <= totalPages; page += 1) {
		const response = await listCrmContacts({}, PAGE_SIZE, page);
		if (response.statusCode !== 'SP100') {
			throw new Error(response.statusMessage || 'Could not load contacts.');
		}
		totalPages = response.totalPages ?? 1;
		for (const contact of response.items ?? []) {
			rows.push(contactRow(contact));
		}
	}
	return `${rows.join('\r\n')}\r\n`;
}
