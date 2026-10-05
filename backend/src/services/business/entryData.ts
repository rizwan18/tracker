import type { businessEntrySchema } from "../../lib/validation";
import { computeGst } from "./gst";

/**
 * The stored form of a sale/expense: GST worked out, and the payment details kept only when it is paid.
 * Shared by the entry form and the CSV import, so both always produce exactly the same record.
 */
export function entryData(data: ReturnType<typeof businessEntrySchema.parse>, gstRegistered: boolean) {
  const g = computeGst(data.amountCents, data.gstMode, gstRegistered, data.gstCents ?? null);
  const paid = data.status === "PAID";
  return {
    kind: data.kind,
    date: data.date,
    dueDate: data.dueDate ?? null,
    description: data.description,
    contactName: data.contactName || null,
    reference: data.reference || null,
    accountId: data.accountId,
    totalCents: g.totalCents,
    gstCents: g.gstCents,
    gstMode: gstRegistered ? data.gstMode : "FREE",
    status: data.status,
    paidDate: paid ? data.paidDate ?? null : null,
    bankAccountId: paid ? data.bankAccountId ?? null : null,
    notes: data.notes || null,
  };
}
