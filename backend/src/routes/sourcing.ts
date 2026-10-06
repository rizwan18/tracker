import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { requireCompanyPortfolio, householdOf } from "../middleware/requireCompanyPortfolio";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { sourcingRecordSchema, sourcingPaymentSchema, sourcingInspectionSchema, sourcingShipmentSchema } from "../lib/validation";
import { toAudEstimateCents } from "../services/business/sourcing";
import { detailInclude, detailDto, summaryDto, type RecordWithChildren } from "../services/business/sourcingDto";
import { ensureProductsBackfilled, findOrCreateProductByName, findOwnedProduct } from "../services/business/products";
import { parseDay } from "../services/business/ledgerStore";
import { ensureSuppliersBackfilled, findOrCreateSupplierByName, primaryPerson, resolveContact, supplierSnapshot } from "../services/business/contacts";

const router = Router();
router.use(requireAuth, requireCompanyPortfolio);

/** A payment's "paid from" account, when given, must be an active bank/card account in this household. */
async function assertBankAccount(householdId: string, bankAccountId: string | null | undefined) {
  if (!bankAccountId) return;
  const bank = await prisma.ledgerAccount.findFirst({ where: { id: bankAccountId, householdId, isBank: true, isActive: true } });
  if (!bank) throw new FriendlyError("Please choose a bank account (or card) from your chart of accounts.", 400);
}

/**
 * The supplier details stored on an order. With a Contact picked, the details are copied from that contact (it is the
 * one source of truth); with only a name typed (an older client, an import) the matching contact is found — or created —
 * so every order ends up linked to a contact. The order's own "contact person" is kept as typed, defaulting to the
 * contact's main person.
 */
async function supplierFields(householdId: string, userId: string, data: ReturnType<typeof sourcingRecordSchema.parse>, currentSupplierId?: string | null) {
  const { supplierId, supplierName, supplierCountry, supplierEmail, supplierPhone, supplierWebsite, supplierAddress, supplierContactName } = data;
  if (supplierId) {
    const contact = await resolveContact(prisma, householdId, supplierId, { allowArchivedId: currentSupplierId });
    if (data.origin === "OVERSEAS" && !contact!.country) {
      throw new FriendlyError(`“${contact!.name}” has no country yet. Add it on the contact (Contacts → ${contact!.name}) — an overseas order needs the supplier's country.`, 400);
    }
    let contactName = supplierContactName;
    if (!contactName) {
      const people = await prisma.contactPerson.findMany({ where: { contactId: contact!.id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 });
      contactName = primaryPerson(people)?.name ?? null;
    }
    return { supplierId: contact!.id, ...supplierSnapshot(contact!), supplierContactName: contactName };
  }
  const contact = await findOrCreateSupplierByName(prisma, householdId, userId, { name: supplierName, country: supplierCountry, email: supplierEmail, phone: supplierPhone, website: supplierWebsite, address: supplierAddress });
  return { supplierId: contact.id, supplierName, supplierCountry, supplierEmail, supplierPhone, supplierWebsite, supplierAddress, supplierContactName };
}

/** Checks an optional contact id (this household's, and not archived unless it is already on the record). */
async function pickContact(householdId: string, id: string | null | undefined, current?: string | null) {
  return id ? resolveContact(prisma, householdId, id, { allowArchivedId: current }) : null;
}

/** Checks the contacts picked for a shipment, and fills the carrier text from the forwarder/logistics provider when none was typed. */
async function shipmentContacts(householdId: string, data: ReturnType<typeof sourcingShipmentSchema.parse>, current?: { forwarderId: string | null; customsAgentId: string | null; logisticsId: string | null; warehouseId: string | null }) {
  const forwarder = await pickContact(householdId, data.forwarderId, current?.forwarderId);
  await pickContact(householdId, data.customsAgentId, current?.customsAgentId);
  const logistics = await pickContact(householdId, data.logisticsId, current?.logisticsId);
  await pickContact(householdId, data.warehouseId, current?.warehouseId);
  return { ...data, carrier: data.carrier ?? forwarder?.name ?? logistics?.name ?? null };
}

async function findRecord(req: AuthedRequest): Promise<RecordWithChildren> {
  const householdId = householdOf(req);
  const record = await prisma.sourcingRecord.findFirst({ where: { id: req.params.id, householdId }, include: detailInclude });
  if (!record) throw new FriendlyError("We couldn't find that sourcing order.", 404);
  return record;
}

// --------------------------------------------------------------------------- list & create
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureProductsBackfilled(prisma, householdId);
    await ensureSuppliersBackfilled(prisma, householdId);
    const productId = typeof req.query.productId === "string" && req.query.productId ? req.query.productId : undefined;
    const origin = req.query.origin === "OVERSEAS" || req.query.origin === "LOCAL" ? req.query.origin : undefined;
    const status = typeof req.query.status === "string" && req.query.status !== "ALL" ? req.query.status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to, true);

    const where: Prisma.SourcingRecordWhereInput = {
      householdId,
      ...(productId ? { productId } : {}),
      ...(origin ? { origin } : {}),
      ...(status ? { status } : {}),
      ...(from || to ? { orderDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      // Plain `contains` (no `mode: "insensitive"`) to stay portable between Postgres and SQLite,
      // matching the convention used in routes/search.ts and routes/transactions.ts.
      ...(q ? { OR: [{ itemDescription: { contains: q } }, { supplierName: { contains: q } }, { reference: { contains: q } }, { supplierCountry: { contains: q } }, { product: { is: { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } } }] } : {}),
    };

    const rows = await prisma.sourcingRecord.findMany({ where, include: detailInclude, orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }] });
    const items = rows.map(summaryDto);
    const open = items.filter((i) => i.status !== "DELIVERED" && i.status !== "CANCELLED");
    const active = items.filter((i) => i.status !== "CANCELLED");
    res.json({
      items,
      totals: {
        openCount: open.length,
        totalCostAudEstCents: active.reduce((s, i) => s + i.totalCostAudEstCents, 0),
        paidAudEstCents: active.reduce((s, i) => s + toAudEstimateCents(i.paidCents, i.currency, i.exchangeRateToAud), 0),
        balanceAudEstCents: active.reduce((s, i) => s + i.balanceAudEstCents, 0),
      },
    });
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const parsed = sourcingRecordSchema.parse(req.body);
    const { productId, supplierId: _supplierId, supplierName: _sn, supplierCountry: _sc, supplierContactName: _scn, supplierEmail: _se, supplierPhone: _sp, supplierWebsite: _sw, supplierAddress: _sa, ...data } = parsed;
    const supplier = await supplierFields(householdId, req.userId!, parsed);
    // An order always belongs to a product/SKU. With a productId it is added to that product (never a duplicate);
    // without one (an older client) the product is matched — or created — from the item description.
    const product = productId ? await findOwnedProduct(prisma, householdId, productId) : await findOrCreateProductByName(prisma, householdId, req.userId!, data.itemDescription);
    const created = await prisma.sourcingRecord.create({ data: { householdId, createdById: req.userId!, productId: product.id, ...data, ...supplier }, include: detailInclude });
    res.status(201).json(detailDto(created));
  })
);

// --------------------------------------------------------------------------- one record
router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    await ensureProductsBackfilled(prisma, householdOf(req));
    await ensureSuppliersBackfilled(prisma, householdOf(req));
    res.json(detailDto(await findRecord(req)));
  })
);

router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const parsed = sourcingRecordSchema.parse(req.body);
    const { productId, supplierId: _supplierId, supplierName: _sn, supplierCountry: _sc, supplierContactName: _scn, supplierEmail: _se, supplierPhone: _sp, supplierWebsite: _sw, supplierAddress: _sa, ...data } = parsed;
    const supplier = await supplierFields(existing.householdId, req.userId!, parsed, existing.supplierId);
    // Left out = stays under its current product; given = moved to that product (which must be this household's).
    if (productId && productId !== existing.productId) await findOwnedProduct(prisma, existing.householdId, productId);
    const updated = await prisma.sourcingRecord.update({ where: { id: existing.id }, data: { ...data, ...supplier, ...(productId ? { productId } : {}) }, include: detailInclude });
    res.json(detailDto(updated));
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    await prisma.sourcingRecord.delete({ where: { id: existing.id } });
    res.json({ message: "Sourcing order deleted." });
  })
);

// --------------------------------------------------------------------------- payments
router.post(
  "/:id/payments",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const data = sourcingPaymentSchema.parse(req.body);
    await assertBankAccount(existing.householdId, data.bankAccountId);
    await pickContact(existing.householdId, data.contactId);
    await prisma.sourcingPayment.create({ data: { sourcingRecordId: existing.id, ...data } });
    res.status(201).json(detailDto(await findRecord(req)));
  })
);

router.put(
  "/:id/payments/:paymentId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const payment = existing.payments.find((p) => p.id === req.params.paymentId);
    if (!payment) throw new FriendlyError("We couldn't find that payment.", 404);
    const data = sourcingPaymentSchema.parse(req.body);
    await assertBankAccount(existing.householdId, data.bankAccountId);
    await pickContact(existing.householdId, data.contactId, payment.contactId);
    await prisma.sourcingPayment.update({ where: { id: payment.id }, data });
    res.json(detailDto(await findRecord(req)));
  })
);

router.delete(
  "/:id/payments/:paymentId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const payment = existing.payments.find((p) => p.id === req.params.paymentId);
    if (!payment) throw new FriendlyError("We couldn't find that payment.", 404);
    await prisma.sourcingPayment.delete({ where: { id: payment.id } });
    res.json(detailDto(await findRecord(req)));
  })
);

// --------------------------------------------------------------------------- inspections
router.post(
  "/:id/inspections",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const data = sourcingInspectionSchema.parse(req.body);
    const inspector = await pickContact(existing.householdId, data.inspectorId);
    await prisma.sourcingInspection.create({ data: { sourcingRecordId: existing.id, ...data, ...(inspector ? { inspector: inspector.name } : {}) } });
    res.status(201).json(detailDto(await findRecord(req)));
  })
);

router.put(
  "/:id/inspections/:inspectionId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const inspection = existing.inspections.find((i) => i.id === req.params.inspectionId);
    if (!inspection) throw new FriendlyError("We couldn't find that inspection.", 404);
    const data = sourcingInspectionSchema.parse(req.body);
    const inspector = await pickContact(existing.householdId, data.inspectorId, inspection.inspectorId);
    await prisma.sourcingInspection.update({ where: { id: inspection.id }, data: { ...data, ...(inspector ? { inspector: inspector.name } : {}) } });
    res.json(detailDto(await findRecord(req)));
  })
);

router.delete(
  "/:id/inspections/:inspectionId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const inspection = existing.inspections.find((i) => i.id === req.params.inspectionId);
    if (!inspection) throw new FriendlyError("We couldn't find that inspection.", 404);
    await prisma.sourcingInspection.delete({ where: { id: inspection.id } });
    res.json(detailDto(await findRecord(req)));
  })
);

// --------------------------------------------------------------------------- shipments
router.post(
  "/:id/shipments",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const data = sourcingShipmentSchema.parse(req.body);
    await prisma.sourcingShipment.create({ data: { sourcingRecordId: existing.id, ...(await shipmentContacts(existing.householdId, data)) } });
    res.status(201).json(detailDto(await findRecord(req)));
  })
);

router.put(
  "/:id/shipments/:shipmentId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const shipment = existing.shipments.find((s) => s.id === req.params.shipmentId);
    if (!shipment) throw new FriendlyError("We couldn't find that shipment.", 404);
    const data = sourcingShipmentSchema.parse(req.body);
    await prisma.sourcingShipment.update({ where: { id: shipment.id }, data: await shipmentContacts(existing.householdId, data, shipment) });
    res.json(detailDto(await findRecord(req)));
  })
);

router.delete(
  "/:id/shipments/:shipmentId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const shipment = existing.shipments.find((s) => s.id === req.params.shipmentId);
    if (!shipment) throw new FriendlyError("We couldn't find that shipment.", 404);
    await prisma.sourcingShipment.delete({ where: { id: shipment.id } });
    res.json(detailDto(await findRecord(req)));
  })
);

export default router;
