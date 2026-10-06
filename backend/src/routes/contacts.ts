import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { requireCompanyPortfolio, householdOf } from "../middleware/requireCompanyPortfolio";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { contactSchema, contactPersonSchema } from "../lib/validation";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactType } from "../lib/constants";
import {
  contactDto, contactKey, ensureSuppliersBackfilled, findDuplicates, findOwnedContact, personDto, primaryPerson, supplierSnapshot, typesFromString, typesToString,
} from "../services/business/contacts";
import {
  CONTACT_COLUMNS, contactsTemplateCsv, contactsToCsv, groupContactRows, readContactsCsv, type ImportGroup,
} from "../services/business/contactsCsv";
import { iso } from "../services/business/sourcingDto";

const router = Router();
router.use(requireAuth, requireCompanyPortfolio);

/** Every place a contact can be linked from — used to count activity and to stop a linked contact being deleted. */
const linkCounts = {
  orders: true, payments: true, inspections: true, forwarderShipments: true, customsShipments: true, logisticsShipments: true, warehouseShipments: true, entries: true,
} as const;
const totalLinks = (c: Record<string, number>) => Object.keys(linkCounts).reduce((s, k) => s + (c[k] ?? 0), 0);

/** The columns of a contact's own details (everything except types, which is stored as text, and the optional first person). */
function contactData(parsed: ReturnType<typeof contactSchema.parse>) {
  const { types, person: _person, allowDuplicate: _allow, ...rest } = parsed;
  return { ...rest, types: typesToString(types), nameKey: contactKey(rest.name) };
}

async function householdContactNames(householdId: string) {
  return prisma.contact.findMany({ where: { householdId }, select: { id: true, name: true, isArchived: true } });
}

/** Contacts the user is about to duplicate: a friendly 409 that carries the matching contacts so the screen can offer them. */
function duplicateResponse(res: import("express").Response, duplicates: ReturnType<typeof findDuplicates>) {
  const first = duplicates[0]!;
  const message =
    first.match === "same"
      ? `You already have a contact called “${first.name}”${first.isArchived ? " (archived)" : ""}. Use that one, or save a new one anyway.`
      : `This looks like “${first.name}”${first.isArchived ? " (archived)" : ""}, which you already have. Use that one, or save a new one anyway.`;
  return res.status(409).json({ error: message, duplicates });
}

const lc = (v: string | null | undefined) => (v ?? "").toLowerCase();

// --------------------------------------------------------------------------- list
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureSuppliersBackfilled(prisma, householdId);

    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const type = typeof req.query.type === "string" && (CONTACT_TYPES as readonly string[]).includes(req.query.type) ? (req.query.type as ContactType) : null;
    const country = typeof req.query.country === "string" ? req.query.country.trim() : "";
    const status = req.query.status === "archived" || req.query.status === "all" ? req.query.status : "active";

    // A household has tens to hundreds of contacts, so they are filtered here: case-insensitive on every database.
    const rows = await prisma.contact.findMany({
      where: { householdId },
      include: { people: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, _count: { select: linkCounts } },
    });

    const countries = [...new Set(rows.filter((r) => !r.isArchived).map((r) => r.country).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
    const typeWords = q ? CONTACT_TYPES.filter((t) => lc(CONTACT_TYPE_LABELS[t]).includes(q)) : [];

    const items = rows
      .filter((c) => (status === "all" ? true : status === "archived" ? c.isArchived : !c.isArchived))
      .filter((c) => !type || c.types.includes(`,${type},`))
      .filter((c) => !country || lc(c.country) === country.toLowerCase())
      .filter((c) => {
        if (!q) return true;
        return (
          [c.name, c.country, c.city, c.email, c.phone, c.mobile, c.whatsapp, c.wechat].some((v) => lc(v).includes(q)) ||
          typeWords.some((t) => c.types.includes(`,${t},`)) ||
          c.people.some((p) => [p.name, p.email, p.phone, p.mobile].some((v) => lc(v).includes(q)))
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((c) => {
        const main = primaryPerson(c.people);
        return {
          ...contactDto(c),
          personCount: c.people.length,
          primaryPerson: main ? { name: main.name, role: main.role } : null,
          linkCount: totalLinks(c._count),
        };
      });

    res.json({ items, countries });
  })
);

// --------------------------------------------------------------------------- picker options
/** Everything a searchable "pick a contact" box needs. Archived contacts are left out, except one that is already chosen. */
router.get(
  "/options",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureSuppliersBackfilled(prisma, householdId);
    const includeId = typeof req.query.includeId === "string" && req.query.includeId ? req.query.includeId : null;
    const rows = await prisma.contact.findMany({
      where: { householdId, OR: [{ isArchived: false }, ...(includeId ? [{ id: includeId }] : [])] },
      select: { id: true, name: true, types: true, country: true, email: true, phone: true, isArchived: true, people: { select: { name: true, isPrimary: true, createdAt: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } },
    });
    res.json(
      rows
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
        .map((c) => ({ id: c.id, name: c.name, types: typesFromString(c.types), country: c.country, email: c.email, phone: c.phone, isArchived: c.isArchived, personName: c.people[0]?.name ?? null }))
    );
  })
);

// --------------------------------------------------------------------------- CSV
router.get(
  "/export.csv",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureSuppliersBackfilled(prisma, householdId);
    const rows = await prisma.contact.findMany({
      where: { householdId },
      include: { people: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="contacts.csv"');
    res.send(contactsToCsv(rows.filter((r) => !r.isArchived)));
  })
);

router.get(
  "/template.csv",
  asyncHandler(async (_req: AuthedRequest, res) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="contacts-template.csv"');
    res.send(contactsTemplateCsv());
  })
);

const HEADER_OF = new Map(CONTACT_COLUMNS.map((c) => [c.key, c.header]));
const ISSUE_FIELD: Record<string, string> = { name: "name", types: "types", country: "country", state: "state", city: "city", address: "address" };

type ImportAction = "create" | "update" | "skip" | "error";
interface PlannedGroup {
  group: ImportGroup;
  action: ImportAction;
  messages: string[];
  parsed?: ReturnType<typeof contactSchema.parse>;
  people: ReturnType<typeof contactPersonSchema.parse>[];
  existingId?: string;
  /** Company fields to fill on an existing contact (only ones that are blank there). */
  fill: Record<string, unknown>;
  addTypes: ContactType[];
}

/** Works out what an import would do — used for both the preview and the real thing, so they can never disagree. */
async function planContactImport(householdId: string, csv: string) {
  const { rows, ignoredColumns } = readContactsCsv(csv);
  const { groups, skipped } = groupContactRows(rows);
  const existing = await prisma.contact.findMany({ where: { householdId }, include: { people: true } });
  const byKey = new Map(existing.map((c) => [c.nameKey || contactKey(c.name), c]));

  const planned: PlannedGroup[] = groups.map((group) => {
    const messages: string[] = [];
    const where = `row${group.rowNumbers.length > 1 ? "s" : ""} ${group.rowNumbers.join(", ")}`;
    if (group.unknownTypes.length > 0) messages.push(`Didn't recognise the type “${group.unknownTypes.join("”, “")}” — ignored.`);

    const c = group.company;
    const parsed = contactSchema.safeParse({
      name: group.name, types: group.types,
      country: c.country, state: c.state, city: c.city, address: c.address, website: c.website, email: c.email, phone: c.phone, mobile: c.mobile,
      whatsapp: c.whatsapp, wechat: c.wechat, otherContact: c.otherContact, abn: c.abn, registrationNumber: c.registrationNumber, taxNumber: c.taxNumber,
      paymentTerms: c.paymentTerms, currency: c.currency, notes: c.notes,
    });
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      const field = HEADER_OF.get(String(i.path[0])) ?? ISSUE_FIELD[String(i.path[0])] ?? String(i.path[0] ?? "");
      return { group, action: "error" as const, messages: [...messages, `${where}: ${field ? `${field} — ` : ""}${i.message}`], people: [], fill: {}, addTypes: [] };
    }

    const people: PlannedGroup["people"] = [];
    for (const p of group.people) {
      const pr = contactPersonSchema.safeParse({ name: p.name, role: p.role, email: p.email, phone: p.phone, mobile: p.mobile, whatsapp: p.whatsapp, wechat: p.wechat });
      if (!pr.success) {
        return { group, action: "error" as const, messages: [...messages, `row ${p.rowNumber}: ${pr.error.issues[0]!.message}`], people: [], fill: {}, addTypes: [] };
      }
      people.push(pr.data);
    }

    const found = byKey.get(group.key);
    if (!found) return { group, action: "create" as const, messages, parsed: parsed.data, people, fill: {}, addTypes: [] };

    // Already have this company: only ADD to it — fill blanks, add types, add people it doesn't have. Never overwrite.
    const fill: Record<string, unknown> = {};
    const d = contactData(parsed.data) as Record<string, unknown>;
    for (const f of ["country", "state", "city", "address", "website", "email", "phone", "mobile", "whatsapp", "wechat", "otherContact", "abn", "registrationNumber", "taxNumber", "paymentTerms", "currency", "notes"]) {
      if (d[f] && !(found as Record<string, unknown>)[f]) fill[f] = d[f];
    }
    const have = typesFromString(found.types);
    const addTypes = parsed.data.types.filter((t) => !have.includes(t) && !(t === "OTHER" && have.length > 0));
    const newPeople = people.filter((p) => !found.people.some((x) => contactKey(x.name) === contactKey(p.name)));
    const nothing = Object.keys(fill).length === 0 && addTypes.length === 0 && newPeople.length === 0;
    if (found.isArchived) messages.push("This contact is archived — it was left archived.");
    return {
      group, action: nothing ? ("skip" as const) : ("update" as const),
      messages: nothing ? [...messages, "Already in your contacts."] : messages,
      parsed: parsed.data, people: newPeople, existingId: found.id, fill, addTypes,
    };
  });

  return { planned, skipped, ignoredColumns };
}

router.post(
  "/import",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
    if (!csv.trim()) throw new FriendlyError("Please choose a CSV file to import.", 400);
    if (csv.length > 5_000_000) throw new FriendlyError("That file is too large. Please import up to 2,000 contacts at a time.", 400);
    const commit = req.body?.commit === true;

    const { planned, skipped, ignoredColumns } = await planContactImport(householdId, csv);

    if (commit) {
      await prisma.$transaction(
        async (tx) => {
          for (const p of planned) {
            if (p.action === "create" && p.parsed) {
              await tx.contact.create({
                data: {
                  householdId, createdById: req.userId!, ...contactData(p.parsed),
                  people: { create: p.people.map(({ isPrimary: _i, ...person }, i) => ({ ...person, isPrimary: i === 0 })) },
                },
              });
            } else if (p.action === "update" && p.existingId) {
              const existing = await tx.contact.findFirst({ where: { id: p.existingId, householdId }, include: { people: { select: { id: true } } } });
              if (!existing) continue;
              await tx.contact.update({
                where: { id: existing.id },
                data: { ...p.fill, ...(p.addTypes.length > 0 ? { types: typesToString([...typesFromString(existing.types).filter((t) => t !== "OTHER" || p.addTypes.length === 0), ...p.addTypes]) } : {}) },
              });
              for (const [i, person] of p.people.entries()) {
                const { isPrimary: _i, ...data } = person;
                await tx.contactPerson.create({ data: { ...data, contactId: existing.id, isPrimary: existing.people.length === 0 && i === 0 } });
              }
            }
          }
        },
        { timeout: 30_000 }
      );
    }

    const count = (a: ImportAction) => planned.filter((p) => p.action === a).length;
    res.json({
      committed: commit,
      summary: { create: count("create"), update: count("update"), skip: count("skip"), error: count("error") + skipped.length },
      rows: [
        ...planned.map((p) => ({
          name: p.group.name, action: p.action, rows: p.group.rowNumbers, types: p.group.types.map((t) => CONTACT_TYPE_LABELS[t]),
          people: p.group.people.map((x) => x.name), messages: p.messages,
        })),
        ...skipped.map((s) => ({ name: "", action: "error" as const, rows: [s.rowNumber], types: [], people: [], messages: [`row ${s.rowNumber}: ${s.reason}.`] })),
      ],
      ignoredColumns,
    });
  })
);

// --------------------------------------------------------------------------- create
router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const parsed = contactSchema.parse(req.body);
    if (!parsed.allowDuplicate) {
      const dups = findDuplicates(await householdContactNames(householdId), parsed.name);
      if (dups.length > 0) return duplicateResponse(res, dups);
    }
    const first = parsed.person?.name ? parsed.person : null;
    const created = await prisma.contact.create({
      data: {
        householdId, createdById: req.userId!, ...contactData(parsed),
        ...(first ? { people: { create: [{ name: first.name, role: first.role, isPrimary: true }] } } : {}),
      },
      include: { people: true },
    });
    res.status(201).json({ ...contactDto(created), people: created.people.map(personDto) });
  })
);

// --------------------------------------------------------------------------- one contact
router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureSuppliersBackfilled(prisma, householdId);
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, householdId },
      include: { people: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
    });
    if (!contact) throw new FriendlyError("We couldn't find that contact.", 404);
    const id = contact.id;

    const [orders, payments, shipments, inspections, entries] = await Promise.all([
      prisma.sourcingRecord.findMany({
        where: { householdId, supplierId: id },
        select: { id: true, reference: true, itemDescription: true, status: true, orderDate: true, quantity: true, unitCostCents: true, currency: true, product: { select: { id: true, name: true, sku: true } } },
        orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }], take: 50,
      }),
      // Payments to this contact: ones naming them as the payee, and payments on their orders that don't name someone else.
      prisma.sourcingPayment.findMany({
        where: { sourcingRecord: { householdId }, OR: [{ contactId: id }, { contactId: null, sourcingRecord: { supplierId: id } }] },
        select: { id: true, date: true, amountCents: true, feeCents: true, type: true, sourcingRecord: { select: { id: true, reference: true, itemDescription: true, currency: true } } },
        orderBy: { date: "desc" }, take: 50,
      }),
      prisma.sourcingShipment.findMany({
        where: { sourcingRecord: { householdId }, OR: [{ forwarderId: id }, { customsAgentId: id }, { logisticsId: id }, { warehouseId: id }, { sourcingRecord: { supplierId: id } }] },
        select: {
          id: true, method: true, carrier: true, trackingNumber: true, shippedDate: true, eta: true, arrivedDate: true, forwarderId: true, customsAgentId: true, logisticsId: true, warehouseId: true,
          sourcingRecord: { select: { id: true, reference: true, itemDescription: true, supplierId: true } },
        },
        orderBy: { createdAt: "desc" }, take: 50,
      }),
      prisma.sourcingInspection.findMany({
        where: { inspectorId: id, sourcingRecord: { householdId } },
        select: { id: true, date: true, result: true, costCents: true, sourcingRecord: { select: { id: true, reference: true, itemDescription: true, currency: true } } },
        orderBy: { date: "desc" }, take: 50,
      }),
      prisma.businessEntry.findMany({
        where: { householdId, contactId: id },
        select: { id: true, kind: true, date: true, description: true, totalCents: true, status: true },
        orderBy: { date: "desc" }, take: 50,
      }),
    ]);

    const orderRef = (r: { id: string; reference: string | null; itemDescription: string }) => ({ id: r.id, reference: r.reference, itemDescription: r.itemDescription });
    res.json({
      ...contactDto(contact),
      people: contact.people.map(personDto),
      activity: {
        orders: orders.map((o) => ({
          id: o.id, reference: o.reference, itemDescription: o.itemDescription, status: o.status, orderDate: iso(o.orderDate), quantity: o.quantity, unitCostCents: o.unitCostCents, currency: o.currency,
          product: o.product ? { id: o.product.id, name: o.product.name, sku: o.product.sku } : null,
        })),
        payments: payments.map((p) => ({ id: p.id, date: iso(p.date), amountCents: p.amountCents, feeCents: p.feeCents, type: p.type, currency: p.sourcingRecord.currency, order: orderRef(p.sourcingRecord) })),
        shipments: shipments.map((s) => ({
          id: s.id, method: s.method, carrier: s.carrier, trackingNumber: s.trackingNumber, shippedDate: iso(s.shippedDate), eta: iso(s.eta), arrivedDate: iso(s.arrivedDate),
          roles: [
            ...(s.sourcingRecord.supplierId === id ? ["SUPPLIER"] : []), ...(s.forwarderId === id ? ["FORWARDER"] : []), ...(s.customsAgentId === id ? ["CUSTOMS_AGENT"] : []),
            ...(s.logisticsId === id ? ["LOGISTICS"] : []), ...(s.warehouseId === id ? ["WAREHOUSE"] : []),
          ],
          order: orderRef(s.sourcingRecord),
        })),
        inspections: inspections.map((i) => ({ id: i.id, date: iso(i.date), result: i.result, costCents: i.costCents, currency: i.sourcingRecord.currency, order: orderRef(i.sourcingRecord) })),
        entries: entries.map((e) => ({ id: e.id, kind: e.kind, date: iso(e.date), description: e.description, totalCents: e.totalCents, status: e.status })),
      },
    });
  })
);

// --------------------------------------------------------------------------- edit
router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await findOwnedContact(prisma, householdId, req.params.id!);
    const parsed = contactSchema.parse(req.body);
    if (!parsed.allowDuplicate && contactKey(parsed.name) !== (existing.nameKey || contactKey(existing.name))) {
      const dups = findDuplicates(await householdContactNames(householdId), parsed.name, existing.id);
      if (dups.length > 0) return duplicateResponse(res, dups);
    }
    const data = contactData(parsed);
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.contact.update({ where: { id: existing.id }, data, include: { people: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } });
      // One source of truth: records that kept this business's details as text are brought up to date, so search, exports and reports agree with the contact.
      await tx.sourcingRecord.updateMany({ where: { householdId, supplierId: u.id }, data: supplierSnapshot(u) });
      await tx.businessEntry.updateMany({ where: { householdId, contactId: u.id }, data: { contactName: u.name } });
      await tx.sourcingInspection.updateMany({ where: { inspectorId: u.id }, data: { inspector: u.name } });
      return u;
    });
    res.json({ ...contactDto(updated), people: updated.people.map(personDto) });
  })
);

// --------------------------------------------------------------------------- archive / delete
async function setArchived(req: AuthedRequest, isArchived: boolean) {
  const existing = await findOwnedContact(prisma, householdOf(req), req.params.id!);
  const updated = await prisma.contact.update({ where: { id: existing.id }, data: { isArchived } });
  return contactDto(updated);
}
router.post("/:id/archive", asyncHandler(async (req: AuthedRequest, res) => res.json(await setArchived(req, true))));
router.post("/:id/unarchive", asyncHandler(async (req: AuthedRequest, res) => res.json(await setArchived(req, false))));

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await findOwnedContact(prisma, householdId, req.params.id!);
    const counts = await prisma.contact.findFirst({ where: { id: existing.id }, select: { _count: { select: linkCounts } } });
    const links = counts ? totalLinks(counts._count) : 0;
    if (links > 0) {
      throw new FriendlyError(
        `“${existing.name}” is used on ${links} record${links === 1 ? "" : "s"} (orders, payments, shipments or sales/expenses). Archive it instead — it stays on those records but won't be offered for new ones.`,
        409
      );
    }
    await prisma.contact.delete({ where: { id: existing.id } });
    res.json({ message: "Contact deleted." });
  })
);

// --------------------------------------------------------------------------- people at the business
async function findPerson(req: AuthedRequest) {
  const contact = await findOwnedContact(prisma, householdOf(req), req.params.id!);
  const person = await prisma.contactPerson.findFirst({ where: { id: req.params.personId, contactId: contact.id } });
  if (!person) throw new FriendlyError("We couldn't find that person.", 404);
  return { contact, person };
}

router.post(
  "/:id/people",
  asyncHandler(async (req: AuthedRequest, res) => {
    const contact = await findOwnedContact(prisma, householdOf(req), req.params.id!);
    const { isPrimary, ...data } = contactPersonSchema.parse(req.body);
    const count = await prisma.contactPerson.count({ where: { contactId: contact.id } });
    const makePrimary = count === 0 || isPrimary === true;
    const created = await prisma.$transaction(async (tx) => {
      if (makePrimary) await tx.contactPerson.updateMany({ where: { contactId: contact.id }, data: { isPrimary: false } });
      return tx.contactPerson.create({ data: { ...data, contactId: contact.id, isPrimary: makePrimary } });
    });
    res.status(201).json(personDto(created));
  })
);

router.put(
  "/:id/people/:personId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { contact, person } = await findPerson(req);
    const { isPrimary, ...data } = contactPersonSchema.parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      if (isPrimary === true) await tx.contactPerson.updateMany({ where: { contactId: contact.id, id: { not: person.id } }, data: { isPrimary: false } });
      return tx.contactPerson.update({ where: { id: person.id }, data: { ...data, ...(isPrimary !== undefined ? { isPrimary } : {}) } });
    });
    res.json(personDto(updated));
  })
);

router.delete(
  "/:id/people/:personId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { contact, person } = await findPerson(req);
    await prisma.$transaction(async (tx) => {
      await tx.contactPerson.delete({ where: { id: person.id } });
      // Someone should stay marked as the main person while anyone is left.
      if (person.isPrimary) {
        const next = await tx.contactPerson.findFirst({ where: { contactId: contact.id }, orderBy: { createdAt: "asc" } });
        if (next) await tx.contactPerson.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });
    res.json({ message: "Person removed." });
  })
);

export default router;
