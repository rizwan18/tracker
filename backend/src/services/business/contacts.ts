/**
 * Contacts (Company Finance) — one record per business you deal with, used everywhere else.
 *
 * A Contact is the ORGANISATION; people at it are ContactPerson rows. A business that is both a supplier and a
 * manufacturer (or a supplier and a freight forwarder) is ONE contact with several types.
 *
 * Before Contacts existed, a sourcing order carried its supplier's details as free text. `backfillSuppliers`
 * links those orders to Contact records, using the same safe rules as the Products backfill (see products.ts):
 *   • orders whose supplier name is the same (ignoring case, spacing and punctuation) share ONE contact;
 *   • a contact already in the household with that name is reused, never duplicated, and never changed;
 *   • the order's own text fields are left exactly as they were — nothing is ever edited or deleted;
 *   • an order that already has a supplier link is never touched, so running it again does nothing.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactType } from "../../lib/constants";
import { FriendlyError } from "../../middleware/errorHandler";

// --------------------------------------------------------------------------- types as stored
/** ["SUPPLIER_MANUFACTURER","CUSTOMER"] → ",SUPPLIER_MANUFACTURER,CUSTOMER," (the wrapping commas make an exact match a plain `contains`). */
export function typesToString(types: readonly ContactType[]): string {
  const ordered = CONTACT_TYPES.filter((t) => types.includes(t));
  return ordered.length > 0 ? `,${ordered.join(",")},` : ",OTHER,";
}

export function typesFromString(stored: string | null | undefined): ContactType[] {
  const found = (stored ?? "").split(",").filter((t): t is ContactType => (CONTACT_TYPES as readonly string[]).includes(t));
  return found.length > 0 ? found : ["OTHER"];
}

export const typeLabels = (types: readonly ContactType[]) => types.map((t) => CONTACT_TYPE_LABELS[t]);

// --------------------------------------------------------------------------- duplicate detection
/** "ABC Manufacturing Co., Ltd" and "abc  manufacturing co ltd" are the same name. */
export const contactKey = (name: string): string =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,'’"`]/g, "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();

const COMPANY_SUFFIXES = new Set(["co", "company", "corp", "corporation", "inc", "incorporated", "ltd", "limited", "llc", "pty", "plc", "gmbh", "sa", "the"]);

/** The name without "Co Ltd" / "Pty Ltd" style endings, so "ABC Manufacturing" and "ABC Manufacturing Co Ltd" look alike. */
export const looseContactKey = (name: string): string =>
  contactKey(name)
    .split(" ")
    .filter((w) => !COMPANY_SUFFIXES.has(w))
    .join(" ");

export interface DuplicateMatch {
  id: string;
  name: string;
  /** same = the name is the same · similar = the same apart from endings such as "Co Ltd" */
  match: "same" | "similar";
  isArchived: boolean;
}

/** Pure: which existing contacts a new/renamed contact would duplicate (an exact match first). */
export function findDuplicates(existing: { id: string; name: string; isArchived: boolean }[], name: string, exceptId?: string): DuplicateMatch[] {
  const key = contactKey(name);
  const loose = looseContactKey(name);
  if (!key) return [];
  const out: DuplicateMatch[] = [];
  for (const c of existing) {
    if (c.id === exceptId) continue;
    if (contactKey(c.name) === key) out.push({ id: c.id, name: c.name, match: "same", isArchived: c.isArchived });
    else if (loose && looseContactKey(c.name) === loose) out.push({ id: c.id, name: c.name, match: "similar", isArchived: c.isArchived });
  }
  return out.sort((a, b) => (a.match === b.match ? 0 : a.match === "same" ? -1 : 1));
}

// --------------------------------------------------------------------------- ownership
/** A contact in this household, or a friendly 404 — so nothing can ever be linked to someone else's contact. */
export async function findOwnedContact(db: Pick<PrismaClient, "contact">, householdId: string, id: string) {
  const contact = await db.contact.findFirst({ where: { id, householdId } });
  if (!contact) throw new FriendlyError("We couldn't find that contact.", 404);
  return contact;
}

/** Checks an optional contact id and returns the contact (or null when none given). Archived contacts can't be newly picked. */
export async function resolveContact(db: Pick<PrismaClient, "contact">, householdId: string, id: string | null | undefined, opts: { allowArchivedId?: string | null } = {}) {
  if (!id) return null;
  const contact = await findOwnedContact(db, householdId, id);
  if (contact.isArchived && contact.id !== opts.allowArchivedId) {
    throw new FriendlyError(`“${contact.name}” is archived. Restore it from Contacts first, or choose another contact.`, 400);
  }
  return contact;
}

// --------------------------------------------------------------------------- DTOs
export const contactRefSelect = { id: true, name: true, types: true, country: true, isArchived: true } satisfies Prisma.ContactSelect;
type ContactRef = Prisma.ContactGetPayload<{ select: typeof contactRefSelect }>;

/** Just enough of a contact to show its name beside a payment, shipment or order. */
export const contactRefDto = (c: ContactRef | null | undefined) =>
  c ? { id: c.id, name: c.name, types: typesFromString(c.types), country: c.country, isArchived: c.isArchived } : null;

export interface ContactRow {
  id: string;
  name: string;
  types: string;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  wechat: string | null;
  otherContact: string | null;
  abn: string | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  paymentTerms: string | null;
  currency: string | null;
  notes: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface PersonRow {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  wechat: string | null;
  notes: string | null;
  isPrimary: boolean;
}

export const personDto = (p: PersonRow) => ({
  id: p.id, name: p.name, role: p.role, email: p.email, phone: p.phone, mobile: p.mobile, whatsapp: p.whatsapp, wechat: p.wechat, notes: p.notes, isPrimary: p.isPrimary,
});

/** The person to show first: the one marked primary, otherwise the one added first. */
export const primaryPerson = <P extends { isPrimary: boolean }>(people: P[]): P | null => people.find((p) => p.isPrimary) ?? people[0] ?? null;

export function contactDto(c: ContactRow) {
  return {
    id: c.id, name: c.name, types: typesFromString(c.types), country: c.country, state: c.state, city: c.city, address: c.address, website: c.website,
    email: c.email, phone: c.phone, mobile: c.mobile, whatsapp: c.whatsapp, wechat: c.wechat, otherContact: c.otherContact,
    abn: c.abn, registrationNumber: c.registrationNumber, taxNumber: c.taxNumber, paymentTerms: c.paymentTerms, currency: c.currency, notes: c.notes,
    isArchived: c.isArchived, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
  };
}

// --------------------------------------------------------------------------- order supplier snapshot
/**
 * The supplier text kept on an order for history, search and export. When the order is linked to a contact these
 * are copied from it (and refreshed when the contact is edited — see routes/contacts.ts), so there is only ever
 * one set of details to keep up to date.
 */
export function supplierSnapshot(c: Pick<ContactRow, "name" | "country" | "email" | "phone" | "website" | "address">) {
  return { supplierName: c.name, supplierCountry: c.country, supplierEmail: c.email, supplierPhone: c.phone, supplierWebsite: c.website, supplierAddress: c.address };
}

// --------------------------------------------------------------------------- backfill of existing suppliers
export interface SupplierBackfillRecord {
  id: string;
  supplierName: string;
  supplierCountry: string | null;
  supplierContactName: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  supplierWebsite: string | null;
  supplierAddress: string | null;
  createdById: string;
  createdAt: Date;
}
export interface ExistingContactKey {
  id: string;
  name: string;
}
export interface NewSupplierContact {
  name: string;
  createdById: string;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  /** Everyone named as the contact on one of these orders (each once), oldest first. */
  people: string[];
  recordIds: string[];
}
export interface SupplierBackfillPlan {
  /** Orders to attach to a contact that already exists. */
  link: { contactId: string; recordIds: string[] }[];
  create: NewSupplierContact[];
}

const clean = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");

/**
 * Pure: decides which contacts to create / reuse. `records` should be oldest first. For a new contact the NEWEST
 * non-blank value of each detail wins (the latest order is the most likely to be current); every person named is kept.
 */
export function planSupplierBackfill(records: SupplierBackfillRecord[], existing: ExistingContactKey[]): SupplierBackfillPlan {
  const existingByKey = new Map<string, string>();
  for (const c of existing) if (!existingByKey.has(contactKey(c.name))) existingByKey.set(contactKey(c.name), c.id);

  const link = new Map<string, string[]>();
  const groups = new Map<string, NewSupplierContact>();
  for (const r of records) {
    const name = clean(r.supplierName) || "Unnamed supplier";
    const key = contactKey(name);
    const existingId = existingByKey.get(key);
    if (existingId) {
      link.set(existingId, [...(link.get(existingId) ?? []), r.id]);
      continue;
    }
    let g = groups.get(key);
    if (!g) {
      g = { name, createdById: r.createdById, country: null, email: null, phone: null, website: null, address: null, people: [], recordIds: [] };
      groups.set(key, g);
    }
    g.recordIds.push(r.id);
    g.country = clean(r.supplierCountry) || g.country;
    g.email = clean(r.supplierEmail) || g.email;
    g.phone = clean(r.supplierPhone) || g.phone;
    g.website = clean(r.supplierWebsite) || g.website;
    g.address = clean(r.supplierAddress) || g.address;
    const person = clean(r.supplierContactName);
    if (person && !g.people.some((p) => p.toLowerCase() === person.toLowerCase())) g.people.push(person);
  }
  return { link: [...link].map(([contactId, recordIds]) => ({ contactId, recordIds })), create: [...groups.values()] };
}

type BackfillDb = Pick<Prisma.TransactionClient, "contact" | "contactPerson" | "sourcingRecord" | "$executeRaw">;

/** Links every order that has no supplier contact yet (see the rules at the top). Safe to repeat and to run concurrently. */
export async function backfillSuppliers(db: BackfillDb, householdId: string): Promise<{ contactsCreated: number; ordersLinked: number }> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"contacts:" + householdId}))`;

  const records = await db.sourcingRecord.findMany({
    where: { householdId, supplierId: null },
    select: {
      id: true, supplierName: true, supplierCountry: true, supplierContactName: true, supplierEmail: true, supplierPhone: true,
      supplierWebsite: true, supplierAddress: true, createdById: true, createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (records.length === 0) return { contactsCreated: 0, ordersLinked: 0 };

  const existing = await db.contact.findMany({ where: { householdId }, select: { id: true, name: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const plan = planSupplierBackfill(records, existing);

  let ordersLinked = 0;
  for (const l of plan.link) {
    const r = await db.sourcingRecord.updateMany({ where: { id: { in: l.recordIds }, householdId, supplierId: null }, data: { supplierId: l.contactId } });
    ordersLinked += r.count;
  }
  for (const c of plan.create) {
    const contact = await db.contact.create({
      data: {
        householdId, createdById: c.createdById, name: c.name, nameKey: contactKey(c.name), types: typesToString(["SUPPLIER_MANUFACTURER"]),
        country: c.country, email: c.email, phone: c.phone, website: c.website, address: c.address,
        notes: "Created automatically from your existing sourcing orders.",
      },
      select: { id: true },
    });
    for (const [i, person] of c.people.entries()) {
      await db.contactPerson.create({ data: { contactId: contact.id, name: person, isPrimary: i === 0 } });
    }
    const r = await db.sourcingRecord.updateMany({ where: { id: { in: c.recordIds }, householdId, supplierId: null }, data: { supplierId: contact.id } });
    ordersLinked += r.count;
  }
  return { contactsCreated: plan.create.length, ordersLinked };
}

/** Cheap to call on every request: does nothing unless some order in the household still has no supplier contact. */
export async function ensureSuppliersBackfilled(client: Pick<PrismaClient, "sourcingRecord" | "$transaction">, householdId: string): Promise<void> {
  const pending = await client.sourcingRecord.count({ where: { householdId, supplierId: null } });
  if (pending === 0) return;
  await client.$transaction((tx) => backfillSuppliers(tx, householdId), { timeout: 20_000 });
}

/**
 * The supplier contact for an order created with only a name typed (an older client, an import): the existing contact if
 * the name matches (ignoring case, spacing and punctuation), otherwise a new one. Never makes a duplicate of a name that exists.
 */
export async function findOrCreateSupplierByName(
  db: Pick<PrismaClient, "contact">,
  householdId: string,
  createdById: string,
  details: { name: string; country?: string | null; email?: string | null; phone?: string | null; website?: string | null; address?: string | null }
) {
  const name = clean(details.name) || "Unnamed supplier";
  const candidates = await db.contact.findMany({ where: { householdId, nameKey: contactKey(name) }, orderBy: { createdAt: "asc" } });
  const match = candidates[0];
  if (match) return match;
  return db.contact.create({
    data: {
      householdId, createdById, name, nameKey: contactKey(name), types: typesToString(["SUPPLIER_MANUFACTURER"]),
      country: details.country ?? null, email: details.email ?? null, phone: details.phone ?? null, website: details.website ?? null, address: details.address ?? null,
    },
  });
}
