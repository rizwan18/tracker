import { describe, it, expect } from "vitest";
import { sourcingRecordSchema, sourcingPaymentSchema, sourcingInspectionSchema, sourcingShipmentSchema } from "../lib/validation";

const validOrder = {
  origin: "OVERSEAS", itemDescription: "Ceramic mugs", quantity: 500, unitCostCents: 120, currency: "usd",
  supplierName: "Shenzhen Ceramics Co", supplierCountry: "China",
};

describe("sourcingRecordSchema", () => {
  it("accepts a valid overseas order, upper-casing the currency and defaulting the status", () => {
    const r = sourcingRecordSchema.parse(validOrder);
    expect(r.currency).toBe("USD");
    expect(r.status).toBe("ENQUIRY");
  });

  it("requires a supplier country for overseas orders but not for local ones", () => {
    expect(sourcingRecordSchema.safeParse({ ...validOrder, supplierCountry: "" }).success).toBe(false);
    expect(sourcingRecordSchema.safeParse({ ...validOrder, origin: "LOCAL", supplierCountry: "" }).success).toBe(true);
  });

  it("rejects a bad currency code, a non-positive quantity and fractional cents", () => {
    expect(sourcingRecordSchema.safeParse({ ...validOrder, currency: "DOLLARS" }).success).toBe(false);
    expect(sourcingRecordSchema.safeParse({ ...validOrder, quantity: 0 }).success).toBe(false);
    expect(sourcingRecordSchema.safeParse({ ...validOrder, unitCostCents: 12.5 }).success).toBe(false);
  });

  it("validates the supplier email and turns blank optional text into null", () => {
    expect(sourcingRecordSchema.safeParse({ ...validOrder, supplierEmail: "not-an-email" }).success).toBe(false);
    const r = sourcingRecordSchema.parse({ ...validOrder, supplierEmail: "", notes: "  " });
    expect(r.supplierEmail).toBeNull();
    expect(r.notes).toBeNull();
  });

  it("accepts null dates and an optional exchange rate, but not a zero rate", () => {
    expect(sourcingRecordSchema.safeParse({ ...validOrder, orderDate: null, expectedDate: null, exchangeRateToAud: null }).success).toBe(true);
    expect(sourcingRecordSchema.safeParse({ ...validOrder, exchangeRateToAud: 1.52 }).success).toBe(true);
    expect(sourcingRecordSchema.safeParse({ ...validOrder, exchangeRateToAud: 0 }).success).toBe(false);
  });

  it("rejects an unknown origin or status", () => {
    expect(sourcingRecordSchema.safeParse({ ...validOrder, origin: "MARS" }).success).toBe(false);
    expect(sourcingRecordSchema.safeParse({ ...validOrder, status: "LOST" }).success).toBe(false);
  });
});

describe("child record schemas", () => {
  it("requires a payment to be a positive whole number of cents", () => {
    expect(sourcingPaymentSchema.safeParse({ date: "2026-09-01", amountCents: 50000 }).success).toBe(true);
    expect(sourcingPaymentSchema.safeParse({ date: "2026-09-01", amountCents: 0 }).success).toBe(false);
    expect(sourcingPaymentSchema.safeParse({ date: "2026-09-01", amountCents: 99.5 }).success).toBe(false);
    expect(sourcingPaymentSchema.safeParse({ amountCents: 100 }).success).toBe(false); // date is required
  });

  it("lets an inspection be free (cost defaults to 0) and rejects a negative cost", () => {
    expect(sourcingInspectionSchema.parse({ date: "2026-09-01" }).costCents).toBe(0);
    expect(sourcingInspectionSchema.safeParse({ date: "2026-09-01", costCents: -1 }).success).toBe(false);
  });

  it("defaults every shipment cost to 0 and accepts empty dates", () => {
    const s = sourcingShipmentSchema.parse({ shippedDate: null, eta: null });
    expect([s.freightCostCents, s.customsDutyCents, s.insuranceCostCents, s.otherCostCents]).toEqual([0, 0, 0, 0]);
    expect(sourcingShipmentSchema.safeParse({ freightCostCents: -5 }).success).toBe(false);
  });
});
