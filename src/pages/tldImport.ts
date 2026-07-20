import type { ActivityFilters, ActivityListItem, FormField } from "@/lib/api";

export const TLD_REQUIRED_HEADERS = [
  "lead_id",
  "entry_date",
  "full_name",
  "email",
  "phone_number",
  "alt_phone",
  "list_id",
  "list_list_name",
  "vendor_lead_code",
  "status",
  "called_count",
  "called_since_last_reset",
  "last_local_call_time",
  "user_full_name",
  "user_user_id",
] as const;

export interface TldCsvRow {
  lead_id: string;
  entry_date: string;
  full_name: string;
  email: string;
  phone_number: string;
  alt_phone: string;
  list_id: string;
  list_list_name: string;
  vendor_lead_code: string;
  status: string;
  called_count: string;
  called_since_last_reset: string;
  last_local_call_time: string;
  user_full_name: string;
  user_user_id: string;
}

export interface TldAgent {
  key: string;
  name: string;
  userId: string;
  count: number;
}

export interface TldDispositionMapping {
  key: string | null;
  label: string;
}

export interface ImportedTldContact {
  id: string;
  sourceLeadId: string;
  importedAt: string;
  entryDate: string | null;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  alternatePhone: string;
  listId: string;
  listName: string;
  vendorLeadCode: string;
  tldStatus: string;
  dispositionKey: string | null;
  dispositionLabel: string;
  calledCount: string;
  calledSinceLastReset: string;
  lastLocalCallTime: string | null;
  tldUserName: string;
  tldUserId: string;
  notes: string;
}

export interface TldImportResult {
  contacts: ImportedTldContact[];
  added: number;
  updated: number;
}

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = "pp_dialer_tld_imports_v1";
const UNASSIGNED_AGENT = "__unassigned__";

const DISPOSITION_BY_STATUS: Record<string, TldDispositionMapping> = {
  SALE: { key: "sale", label: "Sale Complete" },
  FLWUP: { key: "follow_up", label: "Follow Up" },
  INCALL: { key: "follow_up", label: "Follow Up" },
  ERI: { key: "follow_up", label: "Follow Up" },
  PU: { key: "follow_up", label: "Follow Up" },
  TIWF: { key: "thought_it_was_free", label: "Thought It Was Free" },
  CALLBK: { key: "call_back", label: "Call Back" },
  N: { key: "no_answer", label: "No Answer" },
  TIMEOT: { key: "no_answer", label: "No Answer" },
  DISC: { key: "bad_number", label: "Bad Number" },
  NI: { key: "not_interested", label: "Not Interested" },
  CA: { key: "can_t_afford", label: "Can't Afford" },
  OON: { key: "out_of_network", label: "Out of Network" },
  DNQ: { key: "does_not_qualify", label: "Does Not Qualify" },
  DIED: { key: "deceased", label: "Deceased" },
  B: { key: "busy_signal", label: "Busy Signal" },
  LM: { key: "left_message", label: "Left Message" },
};

export const TLD_FORM_SCHEMA: FormField[] = [
  field("first_name", "First Name", "text", 0),
  field("last_name", "Last Name", "text", 1),
  field("phone", "Phone", "phone", 2),
  field("address", "Address", "text", 3),
  field("address2", "Address 2", "text", 4),
  field("city", "City", "text", 5),
  field("state", "State", "text", 6),
  field("zip", "Zipcode", "text", 7),
  field("email", "Email", "email", 8),
  field("dob", "Date of Birth", "text", 9),
  field("sob", "State of Birth", "text", 10),
  field("weight", "Weight", "text", 11),
  field("height", "Height", "text", 12),
  field("dl_number", "Drivers License Number", "text", 13),
  field("notes", "Notes", "textarea", 14),
];

function field(
  key: string,
  label: string,
  type: FormField["type"],
  sortOrder: number,
): FormField {
  return { key, label, type, active: true, required: false, sort_order: sortOrder };
}

export function parseTldCsv(csv: string): TldCsvRow[] {
  const records = parseCsv(csv);
  if (records.length === 0) throw new Error("The CSV file is empty.");

  const headers = records[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  const missing = TLD_REQUIRED_HEADERS.filter(
    (required) => !headers.includes(required),
  );
  if (missing.length > 0) {
    throw new Error(`This is not a supported TLD export. Missing: ${missing.join(", ")}.`);
  }

  return records
    .slice(1)
    .filter((record) => record.some((value) => value.trim() !== ""))
    .map((record) => {
      const values = Object.fromEntries(
        headers.map((header, index) => [header, record[index]?.trim() ?? ""]),
      );
      return Object.fromEntries(
        TLD_REQUIRED_HEADERS.map((header) => [header, values[header] ?? ""]),
      ) as unknown as TldCsvRow;
    });
}

export function listTldAgents(rows: TldCsvRow[]): TldAgent[] {
  const agents = new Map<string, TldAgent>();
  for (const row of rows) {
    const key = agentKey(row);
    const current = agents.get(key);
    if (current) {
      current.count += 1;
    } else {
      agents.set(key, {
        key,
        name: cleanWhitespace(row.user_full_name) || "Unassigned",
        userId: row.user_user_id.trim(),
        count: 1,
      });
    }
  }
  return [...agents.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

export function findMatchingAgentKey(
  agents: TldAgent[],
  signedInName: string,
): string {
  const normalized = normalizeText(signedInName);
  return agents.find((agent) => normalizeText(agent.name) === normalized)?.key ?? "";
}

export function rowsForAgent(rows: TldCsvRow[], agentKeyValue: string): TldCsvRow[] {
  return rows.filter((row) => agentKey(row) === agentKeyValue);
}

export function mapTldDisposition(status: string): TldDispositionMapping {
  const normalized = status.trim().toUpperCase();
  return (
    DISPOSITION_BY_STATUS[normalized] ?? {
      key: null,
      label: normalized ? `Unmapped (${normalized})` : "Unmapped",
    }
  );
}

export function statusSummary(rows: TldCsvRow[]): Array<{
  status: string;
  count: number;
  mapping: TldDispositionMapping;
}> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = row.status.trim().toUpperCase() || "(blank)";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count, mapping: mapTldDisposition(status) }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

export function importTldRows(
  userId: string,
  rows: TldCsvRow[],
  now = new Date(),
): TldImportResult {
  const existing = loadTldContacts(userId);
  const byId = new Map(existing.map((contact) => [contact.id, contact]));
  let added = 0;
  let updated = 0;

  for (const [index, row] of rows.entries()) {
    const contact = rowToContact(row, index, now);
    if (byId.has(contact.id)) updated += 1;
    else added += 1;
    byId.set(contact.id, contact);
  }

  const contacts = [...byId.values()].sort(compareNewestFirst);
  localStorage.setItem(
    storageKey(userId),
    JSON.stringify({ version: STORAGE_VERSION, contacts }),
  );
  return { contacts, added, updated };
}

export function loadTldContacts(userId: string): ImportedTldContact[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; contacts?: unknown };
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.contacts)) return [];
    return parsed.contacts.filter(isImportedContact).sort(compareNewestFirst);
  } catch {
    return [];
  }
}

export function importedContactToActivity(
  contact: ImportedTldContact,
): ActivityListItem {
  return {
    id: contact.id,
    kind: "lead",
    lead_id: contact.id,
    call_id: null,
    twilio_call_sid: null,
    direction: null,
    caller_phone: contact.phone || contact.alternatePhone || null,
    name: contact.fullName || null,
    campaign_id: null,
    campaign_name: contact.listName ? `TLD • ${contact.listName}` : "TLD import",
    disposition_id: contact.dispositionKey,
    disposition_label: contact.dispositionLabel,
    call_status: null,
    started_at: contact.entryDate,
    ended_at: contact.lastLocalCallTime,
    has_recording: false,
    activity_at: contact.lastLocalCallTime || contact.entryDate || contact.importedAt,
  };
}

export function filterImportedContacts(
  contacts: ImportedTldContact[],
  filters: ActivityFilters,
  callbacksOnly: boolean,
): ImportedTldContact[] {
  if (filters.campaign_id) return [];
  return contacts.filter((contact) => {
    if (callbacksOnly && contact.dispositionKey !== "call_back") return false;
    if (filters.name) {
      const needle = normalizeText(filters.name);
      if (
        !normalizeText(contact.fullName).includes(needle) &&
        !normalizeText(contact.email).includes(needle)
      ) {
        return false;
      }
    }
    if (filters.caller_phone) {
      const needle = digits(filters.caller_phone);
      const phones = `${digits(contact.phone)} ${digits(contact.alternatePhone)}`;
      if (!phones.includes(needle)) return false;
    }
    return true;
  });
}

export function contactFormData(contact: ImportedTldContact): Record<string, unknown> {
  return {
    first_name: contact.firstName,
    last_name: contact.lastName,
    phone: contact.phone || contact.alternatePhone,
    address: "",
    address2: "",
    city: "",
    state: "",
    zip: "",
    email: contact.email,
    dob: "",
    sob: "",
    weight: "",
    height: "",
    dl_number: "",
    notes: contact.notes,
  };
}

function rowToContact(
  row: TldCsvRow,
  index: number,
  now: Date,
): ImportedTldContact {
  const fullName = cleanWhitespace(row.full_name);
  const [firstName, lastName] = splitName(fullName);
  const disposition = mapTldDisposition(row.status);
  const sourceLeadId = row.lead_id.trim() || `${row.vendor_lead_code.trim()}-${index}`;
  const entryDate = parseTldDate(row.entry_date);
  const lastLocalCallTime = parseTldDate(row.last_local_call_time);
  const phone = cleanPhone(row.phone_number);
  const alternatePhone = cleanPhone(row.alt_phone);
  const notes = [
    "Imported from TLD (front-end only)",
    `TLD lead ID: ${row.lead_id.trim() || "—"}`,
    `Vendor lead code: ${row.vendor_lead_code.trim() || "—"}`,
    `TLD list: ${row.list_list_name.trim() || "—"} (${row.list_id.trim() || "—"})`,
    `Original TLD status: ${row.status.trim() || "—"}`,
    `Called count: ${row.called_count.trim() || "—"}`,
    `Called since last reset: ${row.called_since_last_reset.trim() || "—"}`,
    `Last local call time: ${row.last_local_call_time.trim() || "—"}`,
    `TLD user: ${cleanWhitespace(row.user_full_name) || "—"} (${row.user_user_id.trim() || "—"})`,
    alternatePhone ? `Alternate phone: ${alternatePhone}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `tld:${sourceLeadId}`,
    sourceLeadId,
    importedAt: now.toISOString(),
    entryDate,
    fullName,
    firstName,
    lastName,
    email: row.email.trim(),
    phone,
    alternatePhone,
    listId: row.list_id.trim(),
    listName: row.list_list_name.trim(),
    vendorLeadCode: row.vendor_lead_code.trim(),
    tldStatus: row.status.trim().toUpperCase(),
    dispositionKey: disposition.key,
    dispositionLabel: disposition.label,
    calledCount: row.called_count.trim(),
    calledSinceLastReset: row.called_since_last_reset.trim(),
    lastLocalCallTime,
    tldUserName: cleanWhitespace(row.user_full_name),
    tldUserId: row.user_user_id.trim(),
    notes,
  };
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (quoted) throw new Error("The CSV has an unclosed quoted value.");
  if (value !== "" || row.length > 0) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function parseTldDate(value: string): string | null {
  const match = value
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const [, month, day, year, hour = "0", minute = "0"] = match;
  const date = new Date(+year, +month - 1, +day, +hour, +minute);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function splitName(fullName: string): [string, string] {
  const [firstName = "", ...rest] = fullName.split(" ").filter(Boolean);
  return [firstName, rest.join(" ")];
}

function agentKey(row: TldCsvRow): string {
  const userId = row.user_user_id.trim();
  const name = normalizeText(row.user_full_name);
  return userId ? `id:${userId}` : name ? `name:${name}` : UNASSIGNED_AGENT;
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function cleanWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeText(value: string): string {
  return cleanWhitespace(value).toLocaleLowerCase();
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function cleanPhone(value: string): string {
  const numeric = digits(value);
  return numeric.length === 11 && numeric.startsWith("1") ? numeric.slice(1) : numeric;
}

function compareNewestFirst(a: ImportedTldContact, b: ImportedTldContact): number {
  const aTime = Date.parse(a.lastLocalCallTime || a.entryDate || a.importedAt);
  const bTime = Date.parse(b.lastLocalCallTime || b.entryDate || b.importedAt);
  return bTime - aTime;
}

function isImportedContact(value: unknown): value is ImportedTldContact {
  if (!value || typeof value !== "object") return false;
  const contact = value as Partial<ImportedTldContact>;
  return (
    typeof contact.id === "string" &&
    contact.id.startsWith("tld:") &&
    typeof contact.sourceLeadId === "string" &&
    typeof contact.importedAt === "string" &&
    typeof contact.fullName === "string" &&
    typeof contact.dispositionLabel === "string"
  );
}
