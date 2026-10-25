import { describe, it, expect } from "vitest";
import { computeHoldingSummary } from "../services/holdings";
import { investmentInitialTransactionSchema } from "../lib/validation";

const buy = (quantity: number, pricePerUnit: number, brokerage = 0, date = "2026-01-01") => ({ type: "BUY", quantity, pricePerUnit, brokerage, date: new Date(date) });
const sell = (quantity: number, pricePerUnit: number, brokerage = 0, date = "2026-06-01") => ({ type: "SELL", quantity, pricePerUnit, brokerage, date: new Date(date) });

describe("computeHoldingSummary — cost base and brokerage (existing calculation, unchanged)", () => {
  it("has no cost base for a holding with no buy/sell history (e.g. a Stake-only import)", () => {
    const summary = computeHoldingSummary([], null, null);
    expect(summary.costBaseKnown).toBe(false);
    expect(summary.costBase).toBe(0);
    expect(summary.unrealisedGainLoss).toBe(0);
    expect(Number.isNaN(summary.costBase)).toBe(false);
  });

  it("includes brokerage in the cost base for a single buy", () => {
    const summary = computeHoldingSummary([buy(100, 10, 19.95)], null, null);
    expect(summary.costBaseKnown).toBe(true);
    expect(summary.quantity).toBe(100);
    // 100 x $10 + $19.95 brokerage
    expect(summary.costBase).toBeCloseTo(1019.95, 5);
  });

  it("defaults brokerage of 0 for historical transactions that predate the brokerage field", () => {
    // Older records always had brokerage persisted as 0 by the API (never null/undefined) — this
    // confirms that still produces a clean cost base with no NaN.
    const summary = computeHoldingSummary([buy(50, 4, 0)], null, null);
    expect(summary.costBase).toBe(200);
    expect(Number.isNaN(summary.costBase)).toBe(false);
  });

  it("accumulates brokerage across multiple buys", () => {
    const summary = computeHoldingSummary([buy(100, 10, 20, "2026-01-01"), buy(50, 12, 15, "2026-02-01")], null, null);
    // (100*10 + 20) + (50*12 + 15) = 1020 + 615
    expect(summary.costBase).toBeCloseTo(1635, 5);
    expect(summary.quantity).toBe(150);
  });

  it("deducts sell-side brokerage from proceeds when computing realised gain", () => {
    const summary = computeHoldingSummary([buy(100, 10, 0), sell(100, 15, 10)], null, null);
    // proceeds = 100*15 - 10 = 1490; cost of sold = 1000; gain = 490
    expect(summary.realisedGain).toBeCloseTo(490, 5);
    expect(summary.realisedLoss).toBe(0);
    expect(summary.quantity).toBe(0);
  });

  it("still reports unrealised gain/loss correctly against a live current value once brokerage is included", () => {
    const summary = computeHoldingSummary([buy(100, 10, 20)], null, null);
    // costBase = 1020; currentValue falls back to quantity × lastPrice (10) since there's no valuation/override
    expect(summary.currentValue).toBe(1000);
    expect(summary.unrealisedGainLoss).toBeCloseTo(-20, 5);
  });
});

describe("investmentInitialTransactionSchema — the initial buy recorded from \"Add an investment\"", () => {
  it("accepts a purchase with brokerage fees", () => {
    const parsed = investmentInitialTransactionSchema.parse({ date: "2026-01-01", quantity: 100, pricePerUnit: 10, brokerage: 19.95 });
    expect(parsed.brokerage).toBe(19.95);
  });

  it("defaults brokerage to undefined (persisted as 0) when omitted, keeping it optional", () => {
    const parsed = investmentInitialTransactionSchema.parse({ date: "2026-01-01", quantity: 100, pricePerUnit: 10 });
    expect(parsed.brokerage).toBeUndefined();
  });

  it("rejects negative brokerage fees", () => {
    expect(() => investmentInitialTransactionSchema.parse({ date: "2026-01-01", quantity: 100, pricePerUnit: 10, brokerage: -5 })).toThrow();
  });

  it("rejects a non-numeric brokerage value", () => {
    expect(() => investmentInitialTransactionSchema.parse({ date: "2026-01-01", quantity: 100, pricePerUnit: 10, brokerage: "abc" })).toThrow();
  });

  it("rejects zero/negative quantity or price (an initial buy must be a genuine purchase)", () => {
    expect(() => investmentInitialTransactionSchema.parse({ date: "2026-01-01", quantity: 0, pricePerUnit: 10 })).toThrow();
    expect(() => investmentInitialTransactionSchema.parse({ date: "2026-01-01", quantity: 100, pricePerUnit: 0 })).toThrow();
  });
});

describe("computeHoldingSummary — realisedCostBase (denominator for the realised % return)", () => {
  it("is zero when nothing has been sold", () => {
    expect(computeHoldingSummary([buy(100, 10, 20)], null, null).realisedCostBase).toBe(0);
  });

  it("is the average cost of the units sold, never the proceeds", () => {
    // Bought 100 @ $10 + $20 brokerage = $1,020 → $10.20/unit. Sell 40 @ $15: cost of sold = 40 × 10.20 = $408.
    const summary = computeHoldingSummary([buy(100, 10, 20), sell(40, 15, 0)], null, null);
    expect(summary.realisedCostBase).toBeCloseTo(408, 5);
    expect(summary.realisedGain).toBeCloseTo(600 - 408, 5);
    // The 60 units left keep the same per-unit cost.
    expect(summary.costBase).toBeCloseTo(612, 5);
  });

  it("accumulates across several sales, and gain + cost of sold reconcile to proceeds", () => {
    const summary = computeHoldingSummary([buy(100, 10), sell(50, 12, 5, "2026-03-01"), sell(50, 8, 5, "2026-04-01")], null, null);
    // Proceeds: (600 − 5) + (400 − 5) = 990; cost of sold = 1,000 in total; net = −10.
    expect(summary.realisedCostBase).toBeCloseTo(1000, 5);
    expect(summary.realisedGain - summary.realisedLoss).toBeCloseTo(990 - 1000, 5);
  });
});
