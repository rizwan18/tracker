import type { Prisma } from "@prisma/client";
import { computeSourcingCosts, toAudEstimateCents } from "./sourcing";
import { buildPricingDto } from "./pricing";
import { contactRefDto, contactRefSelect } from "./contacts";

/** Shapes a sourcing order for the API. Shared by the orders routes and the products routes, so an order's
 *  costs, cost per unit and selling price are worked out in exactly one place. */

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// Shared column list for a document reference (used at record, payment and shipment level).
export const documentSelect = { id: true, fileName: true, fileType: true, createdAt: true } satisfies Prisma.DocumentSelect;

export const childrenInclude = {
  payments: {
    orderBy: { date: "desc" as const },
    include: { bankAccount: { select: { id: true, code: true, name: true } }, documents: { select: documentSelect }, contact: { select: contactRefSelect } },
  },
  inspections: { orderBy: { date: "desc" as const }, include: { inspectorContact: { select: contactRefSelect } } },
  shipments: {
    orderBy: { createdAt: "desc" as const },
    include: {
      documents: { select: documentSelect },
      forwarder: { select: contactRefSelect }, customsAgent: { select: contactRefSelect }, logistics: { select: contactRefSelect }, warehouse: { select: contactRefSelect },
    },
  },
  documents: { select: documentSelect },
  supplier: { select: contactRefSelect },
} satisfies Prisma.SourcingRecordInclude;

/** Just enough of the parent product to show its name, SKU and thumbnail beside an order. */
export const productRefSelect = { id: true, name: true, sku: true, imagePath: true, imageUpdatedAt: true } satisfies Prisma.SourcingProductSelect;

export const detailInclude = { ...childrenInclude, product: { select: productRefSelect } } satisfies Prisma.SourcingRecordInclude;

type ProductRef = Prisma.SourcingProductGetPayload<{ select: typeof productRefSelect }>;
export type OrderChildren = Prisma.SourcingRecordGetPayload<{ include: typeof childrenInclude }>;

export type RecordWithChildren = OrderChildren & { product?: ProductRef | null };

export const productRefDto = (p: ProductRef) => ({ id: p.id, name: p.name, sku: p.sku, hasImage: !!p.imagePath, imageVersion: p.imageUpdatedAt ? p.imageUpdatedAt.getTime() : 0 });

export function costDto(r: { quantity: number; unitCostCents: number; currency: string; exchangeRateToAud: number | null; targetMarginPercent: number }, payments: { amountCents: number; feeCents: number }[], inspections: { costCents: number }[], shipments: { freightCostCents: number; customsDutyCents: number; insuranceCostCents: number; otherCostCents: number }[]) {
  const inputs = { quantity: r.quantity, unitCostCents: r.unitCostCents, payments, inspections, shipments };
  const costs = computeSourcingCosts(inputs);
  return { ...costs, pricing: buildPricingDto(inputs, { currency: r.currency, exchangeRateToAud: r.exchangeRateToAud, targetMarginPercent: r.targetMarginPercent }), totalCostAudEstCents: toAudEstimateCents(costs.totalCostCents, r.currency, r.exchangeRateToAud), balanceAudEstCents: toAudEstimateCents(costs.balanceCents, r.currency, r.exchangeRateToAud) };
}

export function summaryDto(r: RecordWithChildren) {
  return {
    id: r.id, productId: r.productId, product: r.product ? productRefDto(r.product) : null, origin: r.origin, status: r.status, reference: r.reference, itemDescription: r.itemDescription, quantity: r.quantity,
    unitCostCents: r.unitCostCents, currency: r.currency, exchangeRateToAud: r.exchangeRateToAud, targetMarginPercent: r.targetMarginPercent,
    orderDate: iso(r.orderDate), expectedDate: iso(r.expectedDate), deliveredDate: iso(r.deliveredDate),
    supplierId: r.supplierId, supplier: contactRefDto(r.supplier), supplierName: r.supplierName, supplierCountry: r.supplierCountry,
    ...costDto(r, r.payments, r.inspections, r.shipments),
    paymentCount: r.payments.length, inspectionCount: r.inspections.length, shipmentCount: r.shipments.length, documentCount: r.documents.length,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

export function detailDto(r: RecordWithChildren) {
  return {
    ...summaryDto(r),
    supplierContactName: r.supplierContactName, supplierEmail: r.supplierEmail, supplierPhone: r.supplierPhone, supplierWebsite: r.supplierWebsite, supplierAddress: r.supplierAddress,
    notes: r.notes,
    payments: r.payments.map((p) => ({
      id: p.id, date: iso(p.date), amountCents: p.amountCents, feeCents: p.feeCents, type: p.type, method: p.method,
      bankAccount: p.bankAccount, reference: p.reference, notes: p.notes, contactId: p.contactId, contact: contactRefDto(p.contact),
      documents: p.documents.map((d) => ({ id: d.id, fileName: d.fileName, fileType: d.fileType, createdAt: d.createdAt.toISOString() })),
    })),
    inspections: r.inspections.map((i) => ({ id: i.id, date: iso(i.date), inspector: i.inspector, inspectorId: i.inspectorId, inspectorContact: contactRefDto(i.inspectorContact), result: i.result, costCents: i.costCents, notes: i.notes })),
    shipments: r.shipments.map((s) => ({
      id: s.id, method: s.method, carrier: s.carrier,
      forwarderId: s.forwarderId, forwarder: contactRefDto(s.forwarder), customsAgentId: s.customsAgentId, customsAgent: contactRefDto(s.customsAgent),
      logisticsId: s.logisticsId, logistics: contactRefDto(s.logistics), warehouseId: s.warehouseId, warehouse: contactRefDto(s.warehouse), trackingNumber: s.trackingNumber, shippedDate: iso(s.shippedDate), eta: iso(s.eta), arrivedDate: iso(s.arrivedDate),
      freightCostCents: s.freightCostCents, customsDutyCents: s.customsDutyCents, insuranceCostCents: s.insuranceCostCents, otherCostCents: s.otherCostCents, notes: s.notes,
      documents: s.documents.map((d) => ({ id: d.id, fileName: d.fileName, fileType: d.fileType, createdAt: d.createdAt.toISOString() })),
    })),
    documents: r.documents.map((d) => ({ id: d.id, fileName: d.fileName, fileType: d.fileType, createdAt: d.createdAt.toISOString() })),
  };
}

