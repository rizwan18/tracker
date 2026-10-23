import { describe, it, expect } from "vitest";
import { computeSale, parseSaleDate } from "../lib/shareSale";
import { dec } from "../lib/decimal";
import { shareSaleSchema, shareSaleRecordSchema } from "../lib/validation";

/** A holding of `qty` units that cost `cost` dollars in total, sold: quantity @ price less fees. */
const sale = (o: { qty: number; cost: number; sell: number; price: number; fees?: number }) =>
  computeSale({ quantity: dec(o.sell), pricePerShare: dec(o.price), fees: dec(o.fees ?? 0), poolQuantity: dec(o.qty), poolCostBase: dec(o.cost) });

describe("computeSale — the three worked examples from the spec", () => {
  it("Example 1: capital gain — 100 @ $10 cost, sold @ $15, $10 fees → $490.00 gain", () => {
    const f = sale({ qty: 100, cost: 1000, sell: 100, price: 15, fees: 10 });
    expect(f.grossProceedsCents).toBe(150000);
    expect(f.netProceedsCents).toBe(149000);
    expect(f.costBaseCents).toBe(100000);
    expect(f.gainLossCents).toBe(49000);
    expect(f.outcome).toBe("GAIN");
  });

  it("Example 2: capital loss — 100 @ $15 cost, sold @ $10, $10 fees → $510.00 loss", () => {
    const f = sale({ qty: 100, cost: 1500, sell: 100, price: 10, fees: 10 });
    expect(f.grossProceedsCents).toBe(100000);
    expect(f.netProceedsCents).toBe(99000);
    expect(f.costBaseCents).toBe(150000);
    expect(f.gainLossCents).toBe(-51000);
    expect(f.outcome).toBe("LOSS");
  });

  it("Example 3: break-even — no fees, same price as cost → exactly zero", () => {
    const f = sale({ qty: 100, cost: 1000, sell: 100, price: 10 });
    expect(f.gainLossCents).toBe(0);
    expect(f.outcome).toBe("BREAK_EVEN");
  });
});

describe("computeSale — fees, allocation and precision", () => {
  it("selling fees reduce net proceeds and therefore the gain", () => {
    const noFees = sale({ qty: 100, cost: 1000, sell: 100, price: 15 });
    const fees = sale({ qty: 100, cost: 1000, sell: 100, price: 15, fees: 19.95 });
    expect(noFees.gainLossCents - fees.gainLossCents).toBe(1995);
    expect(fees.netProceedsCents).toBe(fees.grossProceedsCents - 1995);
  });

  it("fees larger than the proceeds give a negative net figure and a loss", () => {
    const f = sale({ qty: 1, cost: 1, sell: 1, price: 0.5, fees: 10 });
    expect(f.netProceedsCents).toBe(-950);
    expect(f.outcome).toBe("LOSS");
  });

  it("a worthless sale (price $0) is a valid sale and realises the whole cost as a loss", () => {
    const f = sale({ qty: 50, cost: 500, sell: 50, price: 0 });
    expect(f.grossProceedsCents).toBe(0);
    expect(f.gainLossCents).toBe(-50000);
  });

  it("partial sale allocates cost in proportion and the remainder keeps the rest (200 units, $2,000 → sell 50)", () => {
    const f = sale({ qty: 200, cost: 2000, sell: 50, price: 12 });
    expect(f.costBaseCents).toBe(50000);
    expect(f.remainingQuantity).toBe(150);
    expect(f.remainingCostBaseCents).toBe(150000);
    expect(f.costBasePerShare).toBe(10);
    expect(f.closesHolding).toBe(false);
  });

  it("a partial sale leaves the per-unit cost of the remaining units unchanged", () => {
    const f = sale({ qty: 300, cost: 3100.5, sell: 120, price: 9 });
    const before = 3100.5 / 300;
    const after = f.remainingCostBaseCents / 100 / f.remainingQuantity;
    expect(after).toBeCloseTo(before, 2);
  });

  it("a full sale takes ALL remaining cost base — nothing left behind by rounding", () => {
    // 3 units cost $10.00 (3.3333… each): selling them all must allocate exactly $10.00.
    const f = sale({ qty: 3, cost: 10, sell: 3, price: 4 });
    expect(f.costBaseCents).toBe(1000);
    expect(f.closesHolding).toBe(true);
    expect(f.remainingQuantity).toBe(0);
    expect(f.remainingCostBaseCents).toBe(0);
  });

  it("successive partial sales never create or lose cost: allocations + remainder = original cost", () => {
    let qty = dec(7);
    let cost = dec(100);
    let allocated = 0;
    for (const sell of [2, 2, 2, 1]) {
      const f = computeSale({ quantity: dec(sell), pricePerShare: dec(20), fees: dec(0), poolQuantity: qty, poolCostBase: cost });
      allocated += f.costBaseCents;
      qty = qty.minus(sell);
      cost = cost.minus(dec(f.costBaseCents / 100));
    }
    expect(qty.toNumber()).toBe(0);
    expect(allocated).toBe(10000); // the full $100.00, to the cent
  });

  it("uses exact decimal arithmetic where binary floats go wrong", () => {
    // 0.1 + 0.2 style: 3 × $0.10 = $0.30 exactly; floats give 0.30000000000000004
    expect(sale({ qty: 3, cost: 0.3, sell: 3, price: 0.1 }).grossProceedsCents).toBe(30);
    // 1.005 is below 1.005 in binary; as a decimal it rounds half-up to 1.01
    expect(sale({ qty: 1, cost: 1, sell: 1, price: 1.005 }).grossProceedsCents).toBe(101);
    // 4-decimal prices × fractional units
    expect(sale({ qty: 12.5, cost: 100, sell: 12.5, price: 9.2397 }).grossProceedsCents).toBe(11550); // 115.49625 → 115.50
  });
});

describe("parseSaleDate", () => {
  it("accepts a real YYYY-MM-DD date as that day at 00:00 UTC", () => {
    expect(parseSaleDate("2026-10-23")?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
  it("keeps only the UTC day of an ISO date-time", () => {
    expect(parseSaleDate("2026-10-23T18:45:00Z")?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
  it("rejects impossible, malformed and absurd dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "23/10/2026", "yesterday", "", "1850-01-01", "2026-1-1"]) expect(parseSaleDate(bad), bad).toBeNull();
  });
});

describe("shareSaleSchema — rejects invalid quantities, prices, fees and dates", () => {
  const ok = { quantity: 50, pricePerShare: 12.5, saleDate: "2026-10-01", fees: 9.95 };
  const msg = (input: unknown) => {
    const r = shareSaleSchema.safeParse(input);
    return r.success ? null : r.error.issues[0]?.message;
  };

  it("accepts a valid sale, and numeric strings typed into a form", () => {
    expect(shareSaleSchema.parse(ok)).toMatchObject({ quantity: 50, pricePerShare: 12.5, fees: 9.95 });
    expect(shareSaleSchema.parse({ quantity: "50", pricePerShare: "$1,234.50", saleDate: "2026-10-01" })).toMatchObject({ quantity: 50, pricePerShare: 1234.5, fees: 0 });
  });

  it("fees are optional and default to zero (omitted, blank or null)", () => {
    for (const fees of [undefined, "", null]) expect(shareSaleSchema.parse({ ...ok, fees }).fees).toBe(0);
  });

  it("allows a $0 price (worthless shares) but not a negative one", () => {
    expect(shareSaleSchema.parse({ ...ok, pricePerShare: 0 }).pricePerShare).toBe(0);
    expect(msg({ ...ok, pricePerShare: -1 })).toMatch(/can't be negative/);
  });

  it("rejects zero, negative, non-numeric and missing quantities", () => {
    expect(msg({ ...ok, quantity: 0 })).toMatch(/greater than zero/);
    expect(msg({ ...ok, quantity: -5 })).toMatch(/greater than zero/);
    expect(msg({ ...ok, quantity: "abc" })).toMatch(/as a number/);
    expect(msg({ ...ok, quantity: "" })).toMatch(/Please enter/);
    expect(msg({ ...ok, quantity: undefined })).toMatch(/Please enter/);
    expect(msg({ ...ok, quantity: NaN })).toBeTruthy();
    expect(msg({ ...ok, quantity: Infinity })).toBeTruthy();
  });

  it("a blank price is an error — never silently recorded as a $0 sale", () => {
    expect(msg({ ...ok, pricePerShare: "" })).toMatch(/Please enter/);
    expect(msg({ ...ok, pricePerShare: null })).toBeTruthy();
    expect(msg({ ...ok, pricePerShare: "abc" })).toMatch(/as a number/);
  });

  it("rejects negative fees and fees with fractions of a cent", () => {
    expect(msg({ ...ok, fees: -1 })).toMatch(/can't be negative/);
    expect(msg({ ...ok, fees: 9.995 })).toMatch(/2 decimal places/);
    expect(msg({ ...ok, fees: "abc" })).toMatch(/as a number/);
  });

  it("limits decimal places so what is recorded is what was typed", () => {
    expect(msg({ ...ok, quantity: 1.123456789 })).toMatch(/8 decimal places/);
    expect(msg({ ...ok, pricePerShare: 1.1234567 })).toMatch(/6 decimal places/);
    expect(shareSaleSchema.parse({ ...ok, quantity: 0.00000001 }).quantity).toBe(1e-8);
  });

  it("rejects invalid or missing dates", () => {
    for (const saleDate of ["2026-02-30", "not a date", "", "2026/10/01"]) expect(msg({ ...ok, saleDate }), saleDate).toMatch(/valid sale date|Please enter/);
    expect(msg({ ...ok, saleDate: undefined })).toMatch(/Please enter the sale date/);
    expect(msg({ ...ok, saleDate: 20261001 })).toMatch(/valid sale date/);
  });
});

describe("shareSaleRecordSchema — idempotency key", () => {
  const base = { quantity: 1, pricePerShare: 1, saleDate: "2026-10-01" };
  it("requires a well-formed request id", () => {
    expect(shareSaleRecordSchema.safeParse(base).success).toBe(false);
    expect(shareSaleRecordSchema.safeParse({ ...base, clientRequestId: "short" }).success).toBe(false);
    expect(shareSaleRecordSchema.safeParse({ ...base, clientRequestId: "has spaces and ! symbols!!" }).success).toBe(false);
    expect(shareSaleRecordSchema.safeParse({ ...base, clientRequestId: "3f9c1c1e-7a52-4d2b-9d77-0a1b2c3d4e5f" }).success).toBe(true);
  });
});
