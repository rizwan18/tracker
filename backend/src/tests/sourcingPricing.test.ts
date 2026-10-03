import { describe, it, expect } from "vitest";
import { computeSourcingCosts, type SourcingCostInputs } from "../services/business/sourcing";
import { buildPricingDto, computeUnitPricing, landedCostLines, landedCostTotals, toAudEstimate, DEFAULT_TARGET_MARGIN_PERCENT } from "../services/business/pricing";
import { sourcingRecordSchema } from "../lib/validation";

const dollars = (d: number) => Math.round(d * 100);
/** What the screen does: 2 decimals, normal rounding. */
const display = (cents: number) => (Math.round(cents) / 100).toFixed(2);

/** An order shaped like the brief: manufacturing = quantity × unit price, plus one inspection and one shipment. */
function order(o: { quantity: number; manufacturing: number; inspection?: number; freight?: number; other?: number }): SourcingCostInputs {
  return {
    quantity: o.quantity,
    unitCostCents: dollars(o.manufacturing) / o.quantity,
    inspections: o.inspection ? [{ costCents: dollars(o.inspection) }] : [],
    shipments: o.freight || o.other ? [{ freightCostCents: dollars(o.freight ?? 0), customsDutyCents: 0, insuranceCostCents: 0, otherCostCents: dollars(o.other ?? 0) }] : [],
    payments: [],
  };
}
const price = (input: SourcingCostInputs, margin?: number | null) => computeUnitPricing({ lines: landedCostLines(input), quantity: input.quantity, targetMarginPercent: margin });

describe("cost per unit and 40% gross-margin selling price", () => {
  it("Example 1: $5,000 + $200 + $800 over 1,000 units → cost $6.00, selling $10.00, margin 40%", () => {
    const input = order({ quantity: 1000, manufacturing: 5000, inspection: 200, freight: 800 });
    const totals = landedCostTotals(landedCostLines(input));
    expect(totals).toEqual({ manufacturingCents: 500000, inspectionCents: 20000, freightCents: 80000, otherCents: 0, totalCents: 600000 });

    const p = price(input);
    if (!p.ok) throw new Error(p.message);
    expect(p.targetMarginPercent).toBe(40);
    expect(display(p.costPerUnitCents)).toBe("6.00");
    expect(display(p.sellingPricePerUnitCents)).toBe("10.00");
    expect(display(p.grossProfitPerUnitCents)).toBe("4.00");
    // the margin really is 40% of the selling price
    expect((p.sellingPricePerUnitCents - p.costPerUnitCents) / p.sellingPricePerUnitCents).toBeCloseTo(0.4, 12);
  });

  it("Example 2: $3,000 + $100 + $400 over 500 units → cost $7.00, selling $11.6667… shown as $11.67", () => {
    const p = price(order({ quantity: 500, manufacturing: 3000, inspection: 100, freight: 400 }));
    if (!p.ok) throw new Error(p.message);
    expect(p.totalCostCents).toBe(350000);
    expect(display(p.costPerUnitCents)).toBe("7.00");
    expect(p.sellingPricePerUnitCents / 100).toBeCloseTo(11.6666667, 6); // not rounded in the calculation
    expect(display(p.sellingPricePerUnitCents)).toBe("11.67"); // rounded only for display
  });

  it("is a margin, not a markup: cost × 1.40 would give only a 28.57% margin", () => {
    const p = price(order({ quantity: 1000, manufacturing: 5000, inspection: 200, freight: 800 }));
    if (!p.ok) throw new Error(p.message);
    const markup = p.costPerUnitCents * 1.4;
    expect(markup).toBeLessThan(p.sellingPricePerUnitCents);
    expect((markup - p.costPerUnitCents) / markup).toBeCloseTo(0.2857, 4);
    expect(p.sellingPricePerUnitCents).toBeCloseTo(p.costPerUnitCents / 0.6, 9);
  });

  it("scales with quantity: the same total over more units lowers the cost and price per unit", () => {
    const at = (qty: number) => {
      const p = price({ quantity: qty, unitCostCents: 0, inspections: [], shipments: [{ freightCostCents: 600000, customsDutyCents: 0, insuranceCostCents: 0, otherCostCents: 0 }], payments: [] });
      if (!p.ok) throw new Error(p.message);
      return p;
    };
    expect(display(at(1000).costPerUnitCents)).toBe("6.00");
    expect(display(at(2000).costPerUnitCents)).toBe("3.00");
    expect(display(at(2000).sellingPricePerUnitCents)).toBe("5.00");
    expect(display(at(300).costPerUnitCents)).toBe("20.00");
  });

  it("supports a different margin: 25% → ÷ 0.75, 0% → price equals cost", () => {
    const input = order({ quantity: 1000, manufacturing: 5000, inspection: 200, freight: 800 });
    const p25 = price(input, 25);
    const p0 = price(input, 0);
    if (!p25.ok || !p0.ok) throw new Error("expected prices");
    expect(display(p25.sellingPricePerUnitCents)).toBe("8.00");
    expect(display(p0.sellingPricePerUnitCents)).toBe("6.00");
    expect(price(input, null)).toEqual(price(input, DEFAULT_TARGET_MARGIN_PERCENT)); // missing margin → 40%
  });

  it("rejects a margin below 0 or at/above 100 instead of returning Infinity", () => {
    const input = order({ quantity: 10, manufacturing: 100 });
    for (const m of [-1, 100, 150, NaN]) {
      const p = price(input, m);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.reason).toBe("INVALID_MARGIN");
    }
  });

  it("uses fractional quantities (e.g. kg) without rounding", () => {
    const p = price({ quantity: 12.5, unitCostCents: 800, inspections: [], shipments: [], payments: [] }); // $100 over 12.5 kg
    if (!p.ok) throw new Error(p.message);
    expect(display(p.costPerUnitCents)).toBe("8.00");
    expect(display(p.sellingPricePerUnitCents)).toBe("13.33");
  });
});

describe("unsafe input never produces NaN, Infinity or a wrong price", () => {
  const base = order({ quantity: 100, manufacturing: 1000 });
  const lines = landedCostLines(base);

  it("zero quantity", () => {
    const p = computeUnitPricing({ lines, quantity: 0 });
    expect(p).toMatchObject({ ok: false, reason: "INVALID_QUANTITY" });
  });
  it("negative quantity", () => expect(computeUnitPricing({ lines, quantity: -5 })).toMatchObject({ ok: false, reason: "INVALID_QUANTITY" }));
  it("missing quantity (undefined, null or NaN)", () => {
    for (const q of [undefined, null, NaN]) expect(computeUnitPricing({ lines, quantity: q })).toMatchObject({ ok: false, reason: "MISSING_QUANTITY" });
  });
  it("infinite quantity", () => expect(computeUnitPricing({ lines, quantity: Infinity })).toMatchObject({ ok: false, reason: "INVALID_QUANTITY" }));
  it("negative costs, even when another cost would hide them in the total", () => {
    const negative = [...lines, { key: "x", label: "Bad", group: "OTHER" as const, cents: -50000 }];
    expect(computeUnitPricing({ lines: negative, quantity: 100 })).toMatchObject({ ok: false, reason: "INVALID_COST" });
  });
  it("zero sourcing cost asks for costs rather than recommending a $0.00 price", () => {
    const p = price({ quantity: 100, unitCostCents: 0, inspections: [], shipments: [], payments: [] });
    expect(p).toMatchObject({ ok: false, reason: "NO_COST" });
  });
  it("every failure carries a readable message", () => {
    for (const p of [computeUnitPricing({ lines, quantity: 0 }), computeUnitPricing({ lines, quantity: null }), computeUnitPricing({ lines: [], quantity: 1 })]) {
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.message.length).toBeGreaterThan(10);
    }
  });
});

describe("consistency with the existing sourcing cost model", () => {
  const rich: SourcingCostInputs = {
    quantity: 800,
    unitCostCents: 425,
    shipments: [
      { freightCostCents: 120000, customsDutyCents: 15000, insuranceCostCents: 4000, otherCostCents: 2500 },
      { freightCostCents: 30000, customsDutyCents: 0, insuranceCostCents: 0, otherCostCents: 700 },
    ],
    inspections: [{ costCents: 25000 }, { costCents: 9000 }],
    payments: [{ amountCents: 100000, feeCents: 1800 }, { amountCents: 240000, feeCents: 900 }],
  };

  it("the landed-cost lines add up to exactly the existing total cost (so the two can never disagree)", () => {
    const lines = landedCostLines(rich);
    expect(landedCostTotals(lines).totalCents).toBe(computeSourcingCosts(rich).totalCostCents);
  });

  it("groups freight, inspection, manufacturing and 'other' (duty, insurance, other shipping, payment fees)", () => {
    const t = landedCostTotals(landedCostLines(rich));
    expect(t.manufacturingCents).toBe(800 * 425);
    expect(t.freightCents).toBe(150000);
    expect(t.inspectionCents).toBe(34000);
    expect(t.otherCents).toBe(15000 + 4000 + 2500 + 700 + 1800 + 900);
  });

  it("a brand-new existing-style record (qty 1, no costs yet) says to add costs instead of a price", () => {
    const dto = buildPricingDto({ quantity: 1, unitCostCents: 0, shipments: [], inspections: [], payments: [] }, { currency: "AUD", exchangeRateToAud: null, targetMarginPercent: 40 });
    expect(dto.unit).toMatchObject({ ok: false, reason: "NO_COST" });
  });

  it("an existing record with no stored margin falls back to 40%", () => {
    const dto = buildPricingDto(order({ quantity: 1000, manufacturing: 5000, inspection: 200, freight: 800 }), { currency: "AUD", exchangeRateToAud: null, targetMarginPercent: undefined });
    expect(dto.targetMarginPercent).toBe(40);
    expect(dto.unit.ok && display(dto.unit.sellingPricePerUnitCents)).toBe("10.00");
  });

  it("editing a record re-prices it: change the quantity, margin or a cost and the numbers follow", () => {
    const before = buildPricingDto(order({ quantity: 1000, manufacturing: 5000, inspection: 200, freight: 800 }), { currency: "AUD", exchangeRateToAud: null, targetMarginPercent: 40 });
    const after = buildPricingDto(order({ quantity: 1000, manufacturing: 5000, inspection: 200, freight: 1800 }), { currency: "AUD", exchangeRateToAud: null, targetMarginPercent: 50 });
    expect(before.unit.ok && display(before.unit.sellingPricePerUnitCents)).toBe("10.00");
    expect(after.unit.ok && display(after.unit.costPerUnitCents)).toBe("7.00");
    expect(after.unit.ok && display(after.unit.sellingPricePerUnitCents)).toBe("14.00"); // 7 ÷ 0.5
  });

  it("a new cost line is picked up by the total without touching the formula", () => {
    const lines = [...landedCostLines(order({ quantity: 1000, manufacturing: 5000, inspection: 200, freight: 800 })), { key: "packaging", label: "Packaging", group: "OTHER" as const, cents: 100000 }];
    const p = computeUnitPricing({ lines, quantity: 1000 });
    if (!p.ok) throw new Error(p.message);
    expect(display(p.costPerUnitCents)).toBe("7.00");
    expect(landedCostTotals(lines).otherCents).toBe(100000);
  });
});

describe("foreign-currency orders", () => {
  it("adds an unrounded AUD estimate only when there is a rate; leaves AUD orders alone", () => {
    const input = order({ quantity: 1000, manufacturing: 5000, inspection: 200, freight: 800 });
    const usd = buildPricingDto(input, { currency: "USD", exchangeRateToAud: 1.5, targetMarginPercent: 40 });
    const noRate = buildPricingDto(input, { currency: "USD", exchangeRateToAud: null, targetMarginPercent: 40 });
    const aud = buildPricingDto(input, { currency: "AUD", exchangeRateToAud: null, targetMarginPercent: 40 });
    expect(usd.unit.ok && display(usd.unit.sellingPricePerUnitAudEstCents ?? NaN)).toBe("15.00"); // US$10.00 × 1.5
    expect(noRate.unit.ok && noRate.unit.sellingPricePerUnitAudEstCents).toBeNull();
    expect(aud.unit.ok && aud.unit.sellingPricePerUnitAudEstCents).toBeNull();
    expect(toAudEstimate(1000, "AUD", 2)).toBe(1000);
  });
});

describe("target margin on the sourcing record schema", () => {
  const valid = { origin: "LOCAL", itemDescription: "Shower filter", quantity: 1000, unitCostCents: 500, currency: "AUD", supplierName: "Acme" };
  it("is optional, so an existing client that doesn't send it still saves (the column default of 40% applies)", () => {
    const r = sourcingRecordSchema.parse(valid);
    expect(r.targetMarginPercent).toBeUndefined();
  });
  it("accepts 0 to just under 100, including decimals", () => {
    for (const m of [0, 25, 37.5, 40, 99.5]) expect(sourcingRecordSchema.safeParse({ ...valid, targetMarginPercent: m }).success).toBe(true);
  });
  it("rejects negative, 100+, and non-numbers", () => {
    for (const m of [-1, 100, 101, "40", NaN]) expect(sourcingRecordSchema.safeParse({ ...valid, targetMarginPercent: m }).success).toBe(false);
  });
});
