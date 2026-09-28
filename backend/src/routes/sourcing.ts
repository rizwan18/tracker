import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { requireCompanyPortfolio, householdOf } from "../middleware/requireCompanyPortfolio";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { sourcingRecordSchema, sourcingPaymentSchema, sourcingInspectionSchema, sourcingShipmentSchema } from "../lib/validation";
import { computeSourcingCosts, toAudEstimateCents } from "../services/business/sourcing";
import { parseDay } from "../services/business/ledgerStore";

const router = Router();
router.use(requireAuth, requireCompanyPortfolio);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const detailInclude = {
  payments: { orderBy: { date: "desc" as const }, include: { bankAccount: { select: { id: true, code: true, name: true } } } },
  inspections: { orderBy: { date: "desc" as const } },
  shipments: { orderBy: { createdAt: "desc" as const } },
  documents: { select: { id: true, fileName: true, fileType: true, createdAt: true } },
} satisfies Prisma.SourcingRecordInclude;

type RecordWithChildren = Prisma.SourcingRecordGetPayload<{ include: typeof detailInclude }>;

function costDto(r: { quantity: number; unitCostCents: number; currency: string; exchangeRateToAud: number | null }, payments: { amountCents: number; feeCents: number }[], inspections: { costCents: number }[], shipments: { freightCostCents: number; customsDutyCents: number; insuranceCostCents: number; otherCostCents: number }[]) {
  const costs = computeSourcingCosts({ quantity: r.quantity, unitCostCents: r.unitCostCents, payments, inspections, shipments });
  return { ...costs, totalCostAudEstCents: toAudEstimateCents(costs.totalCostCents, r.currency, r.exchangeRateToAud), balanceAudEstCents: toAudEstimateCents(costs.balanceCents, r.currency, r.exchangeRateToAud) };
}

function summaryDto(r: RecordWithChildren) {
  return {
    id: r.id, origin: r.origin, status: r.status, reference: r.reference, itemDescription: r.itemDescription, quantity: r.quantity,
    unitCostCents: r.unitCostCents, currency: r.currency, exchangeRateToAud: r.exchangeRateToAud,
    orderDate: iso(r.orderDate), expectedDate: iso(r.expectedDate), deliveredDate: iso(r.deliveredDate),
    supplierName: r.supplierName, supplierCountry: r.supplierCountry,
    ...costDto(r, r.payments, r.inspections, r.shipments),
    paymentCount: r.payments.length, inspectionCount: r.inspections.length, shipmentCount: r.shipments.length, documentCount: r.documents.length,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

function detailDto(r: RecordWithChildren) {
  return {
    ...summaryDto(r),
    supplierContactName: r.supplierContactName, supplierEmail: r.supplierEmail, supplierPhone: r.supplierPhone, supplierWebsite: r.supplierWebsite, supplierAddress: r.supplierAddress,
    notes: r.notes,
    payments: r.payments.map((p) => ({
      id: p.id, date: iso(p.date), amountCents: p.amountCents, feeCents: p.feeCents, type: p.type, method: p.method,
      bankAccount: p.bankAccount, reference: p.reference, notes: p.notes,
    })),
    inspections: r.inspections.map((i) => ({ id: i.id, date: iso(i.date), inspector: i.inspector, result: i.result, costCents: i.costCents, notes: i.notes })),
    shipments: r.shipments.map((s) => ({
      id: s.id, method: s.method, carrier: s.carrier, trackingNumber: s.trackingNumber, shippedDate: iso(s.shippedDate), eta: iso(s.eta), arrivedDate: iso(s.arrivedDate),
      freightCostCents: s.freightCostCents, customsDutyCents: s.customsDutyCents, insuranceCostCents: s.insuranceCostCents, otherCostCents: s.otherCostCents, notes: s.notes,
    })),
    documents: r.documents.map((d) => ({ id: d.id, fileName: d.fileName, fileType: d.fileType, createdAt: d.createdAt.toISOString() })),
  };
}

/** A payment's "paid from" account, when given, must be an active bank/card account in this household. */
async function assertBankAccount(householdId: string, bankAccountId: string | null | undefined) {
  if (!bankAccountId) return;
  const bank = await prisma.ledgerAccount.findFirst({ where: { id: bankAccountId, householdId, isBank: true, isActive: true } });
  if (!bank) throw new FriendlyError("Please choose a bank account (or card) from your chart of accounts.", 400);
}

async function findRecord(req: AuthedRequest): Promise<RecordWithChildren> {
  const householdId = householdOf(req);
  const record = await prisma.sourcingRecord.findFirst({ where: { id: req.params.id, householdId }, include: detailInclude });
  if (!record) throw new FriendlyError("We couldn't find that sourcing record.", 404);
  return record;
}

// --------------------------------------------------------------------------- list & create
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const origin = req.query.origin === "OVERSEAS" || req.query.origin === "LOCAL" ? req.query.origin : undefined;
    const status = typeof req.query.status === "string" && req.query.status !== "ALL" ? req.query.status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to, true);

    const where: Prisma.SourcingRecordWhereInput = {
      householdId,
      ...(origin ? { origin } : {}),
      ...(status ? { status } : {}),
      ...(from || to ? { orderDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      // Plain `contains` (no `mode: "insensitive"`) to stay portable between Postgres and SQLite,
      // matching the convention used in routes/search.ts and routes/transactions.ts.
      ...(q ? { OR: [{ itemDescription: { contains: q } }, { supplierName: { contains: q } }, { reference: { contains: q } }, { supplierCountry: { contains: q } }] } : {}),
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
    const data = sourcingRecordSchema.parse(req.body);
    const created = await prisma.sourcingRecord.create({ data: { householdId, createdById: req.userId!, ...data }, include: detailInclude });
    res.status(201).json(detailDto(created));
  })
);

// --------------------------------------------------------------------------- one record
router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(detailDto(await findRecord(req)));
  })
);

router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const data = sourcingRecordSchema.parse(req.body);
    const updated = await prisma.sourcingRecord.update({ where: { id: existing.id }, data, include: detailInclude });
    res.json(detailDto(updated));
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    await prisma.sourcingRecord.delete({ where: { id: existing.id } });
    res.json({ message: "Sourcing record deleted." });
  })
);

// --------------------------------------------------------------------------- payments
router.post(
  "/:id/payments",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findRecord(req);
    const data = sourcingPaymentSchema.parse(req.body);
    await assertBankAccount(existing.householdId, data.bankAccountId);
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
    await prisma.sourcingInspection.create({ data: { sourcingRecordId: existing.id, ...data } });
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
    await prisma.sourcingInspection.update({ where: { id: inspection.id }, data });
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
    await prisma.sourcingShipment.create({ data: { sourcingRecordId: existing.id, ...data } });
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
    await prisma.sourcingShipment.update({ where: { id: shipment.id }, data });
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
