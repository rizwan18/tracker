/**
 * Contacts as a plain spreadsheet — readable column names, no database ids.
 *
 * A company with no one listed, or with one person who has no number of their own, is a single row. A company with
 * several people is a "company row" (no Contact Person — it carries the company's own email, phone, address…) followed
 * by one row per person carrying only that person's own details. The same company name on several rows means one company.
 * A hand-made file can simply put the company's details on its first row; a later person's email/phone is kept as theirs
 * unless it is the same as the company's.
 */
import { parseCsv, toCsv, escapeFormula, unescapeFormula } from "../../lib/csv";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactType } from "../../lib/constants";
import { FriendlyError } from "../../middleware/errorHandler";
import { contactKey, typesFromString, type ContactRow, type PersonRow } from "./contacts";

export interface ContactColumn {
  key: string;
  header: string;
  aliases?: string[];
  required?: boolean;
}

export const CONTACT_COLUMNS: ContactColumn[] = [
  { key: "name", header: "Company Name", aliases: ["business name", "business", "company", "name", "supplier", "organisation", "organization"], required: true },
  { key: "types", header: "Contact Type", aliases: ["type", "types", "category", "contact types", "role type"] },
  { key: "person", header: "Contact Person", aliases: ["person", "contact", "contact name", "full name"] },
  { key: "role", header: "Role", aliases: ["position", "job title", "title", "position role"] },
  { key: "email", header: "Email", aliases: ["email address", "e-mail"] },
  { key: "phone", header: "Phone", aliases: ["telephone", "tel", "phone number"] },
  { key: "mobile", header: "Mobile", aliases: ["cell", "mobile number", "cell phone"] },
  { key: "whatsapp", header: "WhatsApp", aliases: ["whats app"] },
  { key: "wechat", header: "WeChat", aliases: ["we chat", "wechat id", "weixin"] },
  { key: "address", header: "Address", aliases: ["street address", "factory address"] },
  { key: "city", header: "City", aliases: ["town", "suburb"] },
  { key: "state", header: "State", aliases: ["province", "state province", "region"] },
  { key: "country", header: "Country" },
  { key: "website", header: "Website", aliases: ["web", "url", "site"] },
  { key: "notes", header: "Notes", aliases: ["note", "comments", "comment"] },
  { key: "otherContact", header: "Other Contact Method", aliases: ["other contact", "other", "skype", "messaging"] },
  { key: "abn", header: "ABN" },
  { key: "registrationNumber", header: "Business Registration Number", aliases: ["registration number", "registration", "company number", "acn", "business registration"] },
  { key: "taxNumber", header: "Tax / VAT / GST Number", aliases: ["tax number", "vat number", "gst number", "vat", "tax id", "tax vat gst number"] },
  { key: "paymentTerms", header: "Payment Terms", aliases: ["terms"] },
  { key: "currency", header: "Currency" },
];

export const CONTACT_CSV_NOTE = "Example row - delete before importing";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// --------------------------------------------------------------------------- types in a spreadsheet cell
/** Words people use for each type in a spreadsheet; matched ignoring case and punctuation. */
const TYPE_WORDS: Array<[ContactType, string[]]> = [
  ["SUPPLIER_MANUFACTURER", ["supplier", "manufacturer", "factory", "vendor", "supplier manufacturer", "product supplier"]],
  ["FREIGHT_FORWARDER", ["freight forwarder", "forwarder", "freight"]],
  ["INSPECTION", ["inspection", "inspection company", "inspector", "qc"]],
  ["CUSTOMS_AGENT", ["customs", "customs agent", "import agent", "customs import agent", "broker", "customs broker"]],
  ["LOGISTICS", ["logistics", "shipping", "shipping logistics", "carrier", "courier"]],
  ["WAREHOUSE_3PL", ["warehouse", "3pl", "warehouse 3pl", "fulfilment", "fulfillment", "storage"]],
  ["CUSTOMER", ["customer", "client", "buyer"]],
  ["OTHER", ["other"]],
];

/** "Supplier / Manufacturer; Freight Forwarder" → types, plus anything that couldn't be understood. */
export function parseTypesCell(cell: string): { types: ContactType[]; unknown: string[] } {
  const types = new Set<ContactType>();
  const unknown: string[] = [];
  const whole = norm(cell);
  // The full label "Supplier / Manufacturer" contains a slash, so try the whole cell and each label first.
  for (const t of CONTACT_TYPES) if (whole === norm(CONTACT_TYPE_LABELS[t]) || whole === norm(t)) types.add(t);
  if (types.size === 0) {
    for (const part of cell.split(/[;|,\n]+/).map((p) => p.trim()).filter(Boolean)) {
      const n = norm(part);
      const exact = CONTACT_TYPES.find((t) => n === norm(CONTACT_TYPE_LABELS[t]) || n === norm(t));
      if (exact) { types.add(exact); continue; }
      // "Supplier / Manufacturer" typed as two words in one part, or "Supplier/Manufacturer".
      const bits = part.split("/").map((b) => b.trim()).filter(Boolean);
      let any = false;
      for (const b of bits.length > 1 ? bits : [part]) {
        const hit = TYPE_WORDS.find(([, words]) => words.some((w) => norm(w) === norm(b)));
        if (hit) { types.add(hit[0]); any = true; }
      }
      if (!any) unknown.push(part);
    }
  }
  return { types: CONTACT_TYPES.filter((t) => types.has(t)), unknown };
}

// --------------------------------------------------------------------------- export
export interface ExportContact extends ContactRow {
  people: PersonRow[];
}

const ordered = (people: PersonRow[]) => [...people].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

const CHANNEL_KEYS = ["email", "phone", "mobile", "whatsapp", "wechat"] as const;

export function contactsToCsv(contacts: ExportContact[]): string {
  const rows: string[][] = [CONTACT_COLUMNS.map((c) => c.header)];
  const push = (v: Record<string, string | null>) => rows.push(CONTACT_COLUMNS.map((col) => escapeFormula(v[col.key] ?? "")));
  for (const c of contacts) {
    const types = typesFromString(c.types).map((t) => CONTACT_TYPE_LABELS[t]).join("; ");
    const people = ordered(c.people);
    const company: Record<string, string | null> = {
      name: c.name, types, person: null, role: null,
      email: c.email, phone: c.phone, mobile: c.mobile, whatsapp: c.whatsapp, wechat: c.wechat,
      address: c.address, city: c.city, state: c.state, country: c.country, website: c.website, notes: c.notes, otherContact: c.otherContact,
      abn: c.abn, registrationNumber: c.registrationNumber, taxNumber: c.taxNumber, paymentTerms: c.paymentTerms, currency: c.currency,
    };
    const hasOwnChannels = (p: PersonRow) => CHANNEL_KEYS.some((k) => !!p[k] && norm(p[k]!) !== norm(c[k] ?? ""));
    if (people.length === 0) {
      push(company);
    } else if (people.length === 1 && !hasOwnChannels(people[0]!)) {
      push({ ...company, person: people[0]!.name, role: people[0]!.role });
    } else {
      push(company);
      for (const p of people) push({ name: c.name, person: p.name, role: p.role, email: p.email, phone: p.phone, mobile: p.mobile, whatsapp: p.whatsapp, wechat: p.wechat });
    }
  }
  return "\uFEFF" + toCsv(rows);
}

export function contactsTemplateCsv(): string {
  const example: Record<string, string> = {
    name: "ABC Manufacturing Co Ltd", types: "Supplier / Manufacturer", person: "John Smith", role: "Sales", email: "john@example.com", phone: "+86 755 0000 0000",
    mobile: "", whatsapp: "+86 138 0000 0000", wechat: "john123", address: "Building 5, Industrial Park", city: "Shenzhen", state: "Guangdong", country: "China",
    website: "www.example.com", notes: CONTACT_CSV_NOTE, otherContact: "", abn: "", registrationNumber: "", taxNumber: "", paymentTerms: "30% deposit, 70% before shipping", currency: "USD",
  };
  return "\uFEFF" + toCsv([CONTACT_COLUMNS.map((c) => c.header), CONTACT_COLUMNS.map((c) => example[c.key] ?? "")]);
}

// --------------------------------------------------------------------------- import: read
export const MAX_CONTACT_ROWS = 2000;

export interface ContactCsvRow {
  /** The row number as it shows in Excel (the heading row is row 1). */
  rowNumber: number;
  cells: Record<string, string>;
}

export function readContactsCsv(text: string): { rows: ContactCsvRow[]; ignoredColumns: string[] } {
  const all = parseCsv(text);
  const headerAt = all.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerAt === -1) throw new FriendlyError("That file is empty. Please choose a CSV with a heading row and at least one contact.", 400);

  const byName = new Map<string, string>();
  for (const c of CONTACT_COLUMNS) for (const n of [c.header, c.key, ...(c.aliases ?? [])]) byName.set(norm(n), c.key);

  const columnOf = new Map<string, number>();
  const ignoredColumns: string[] = [];
  all[headerAt]!.forEach((raw, i) => {
    const h = raw.trim();
    if (!h) return;
    const key = byName.get(norm(h));
    if (key && !columnOf.has(key)) columnOf.set(key, i);
    else ignoredColumns.push(h);
  });
  if (!columnOf.has("name")) {
    throw new FriendlyError("Your file needs a “Company Name” column. Download the template to see the columns to use.", 400);
  }

  const rows: ContactCsvRow[] = [];
  for (let i = headerAt + 1; i < all.length; i++) {
    const raw = all[i]!;
    if (raw.every((c) => c.trim() === "")) continue;
    const cells: Record<string, string> = {};
    for (const [key, col] of columnOf) cells[key] = unescapeFormula((raw[col] ?? "").trim());
    // The template's example row is skipped so it can't be imported by accident.
    if (norm(cells.notes ?? "").startsWith("examplerow")) continue;
    rows.push({ rowNumber: i + 1, cells });
  }
  if (rows.length === 0) throw new FriendlyError("That file has headings but no contacts. Add a row for each contact and try again.", 400);
  if (rows.length > MAX_CONTACT_ROWS) throw new FriendlyError(`That file has ${rows.length.toLocaleString("en-AU")} rows. Please import up to ${MAX_CONTACT_ROWS.toLocaleString("en-AU")} at a time.`, 400);
  return { rows, ignoredColumns };
}

// --------------------------------------------------------------------------- import: group rows into companies
export interface ImportPerson {
  rowNumber: number;
  name: string;
  role: string;
  email: string;
  phone: string;
  mobile: string;
  whatsapp: string;
  wechat: string;
}
export interface ImportGroup {
  key: string;
  name: string;
  rowNumbers: number[];
  types: ContactType[];
  unknownTypes: string[];
  /** The company's own details: from the first row for that company, with later rows only filling gaps. */
  company: Record<string, string>;
  people: ImportPerson[];
}

const COMPANY_FIELDS = ["email", "phone", "mobile", "whatsapp", "wechat", "address", "city", "state", "country", "website", "notes", "otherContact", "abn", "registrationNumber", "taxNumber", "paymentTerms", "currency"];
const CHANNELS = ["email", "phone", "mobile", "whatsapp", "wechat"] as const;

/** Rows with the same Company Name (ignoring case and punctuation) become ONE company with several people. */
export function groupContactRows(rows: ContactCsvRow[]): { groups: ImportGroup[]; skipped: { rowNumber: number; reason: string }[] } {
  const groups = new Map<string, ImportGroup>();
  const skipped: { rowNumber: number; reason: string }[] = [];
  for (const row of rows) {
    const name = (row.cells.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) {
      skipped.push({ rowNumber: row.rowNumber, reason: "No company name" });
      continue;
    }
    const key = contactKey(name);
    let g = groups.get(key);
    const isFirst = !g;
    if (!g) {
      g = { key, name, rowNumbers: [], types: [], unknownTypes: [], company: {}, people: [] };
      groups.set(key, g);
    }
    g.rowNumbers.push(row.rowNumber);

    const t = parseTypesCell(row.cells.types ?? "");
    g.types = CONTACT_TYPES.filter((x) => g!.types.includes(x) || t.types.includes(x));
    for (const u of t.unknown) if (!g.unknownTypes.includes(u)) g.unknownTypes.push(u);

    for (const f of COMPANY_FIELDS) {
      const v = (row.cells[f] ?? "").trim();
      // On a later row of the same company, the phone/email columns are that person's own (kept on the person below), not the company's.
      if (!v || g.company[f]) continue;
      if (!isFirst && (CHANNELS as readonly string[]).includes(f)) continue;
      g.company[f] = v;
    }

    const person = (row.cells.person ?? "").trim();
    if (person) {
      const p: ImportPerson = {
        rowNumber: row.rowNumber, name: person, role: (row.cells.role ?? "").trim(),
        email: (row.cells.email ?? "").trim(), phone: (row.cells.phone ?? "").trim(), mobile: (row.cells.mobile ?? "").trim(),
        whatsapp: (row.cells.whatsapp ?? "").trim(), wechat: (row.cells.wechat ?? "").trim(),
      };
      if (!g.people.some((x) => x.name.toLowerCase() === person.toLowerCase())) g.people.push(p);
    }
  }
  // A person's channel that is the same as the company's is just the company's — don't store it twice.
  for (const g of groups.values()) {
    for (const p of g.people) for (const ch of CHANNELS) if (p[ch] && norm(p[ch]) === norm(g.company[ch] ?? "")) p[ch] = "";
    if (g.types.length === 0) g.types = ["OTHER"];
  }
  return { groups: [...groups.values()], skipped };
}
