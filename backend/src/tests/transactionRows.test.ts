import { describe, it, expect } from "vitest";
import { addingLeavesShortfall, removingLeavesShortfall, transactionRowsOf } from "../services/holdings";

let n = 0;
const tx = (type: "BUY" | "SELL", quantity: number, pricePerUnit: number, brokerage: number, date: string, extra: Record<string, unknown> = {}) => ({
  id: `t${++n}`,
  type,
  quantity,
  pricePerUnit,
  brokerage,
  date: new Date(date),
  createdAt: new Date(date),
  ...extra,
});
const rowsById = (txs: ReturnType<typeof tx>[]) => new Map(transactionRowsOf(txs).map((r) => [r.id, r]));

describe("transactionRowsOf — rows of the unified Shares & ETFs transactions table", () => {
  it("a buy's total is units × price + brokerage, it adds to the units held, and it has no realised P&L", () => {
    const b = tx("BUY", 100, 10, 19.95, "2026-01-05");
    const r = rowsById([b]).get(b.id)!;
    expect(r.totalValue).toBeCloseTo(1019.95, 5);
    expect(r.unitsAfter).toBe(100);
    expect(r.realisedGainLoss).toBeNull();
  });

  it("a sell's total is net proceeds (units × price − brokerage) and its P&L is net proceeds − average cost of the units sold", () => {
    const b = tx("BUY", 100, 10, 20, "2026-01-05"); // cost $1,020 → $10.20/unit
    const s = tx("SELL", 40, 15, 10, "2026-03-01"); // net $590, cost of sold $408 → +$182
    const rows = rowsById([b, s]);
    expect(rows.get(s.id)!.totalValue).toBeCloseTo(590, 5);
    expect(rows.get(s.id)!.realisedGainLoss).toBeCloseTo(182, 5);
    expect(rows.get(s.id)!.unitsAfter).toBe(60);
  });

  it("a loss-making sale has a negative realised figure", () => {
    const rows = rowsById([tx("BUY", 100, 10, 0, "2026-01-05"), tx("SELL", 100, 8, 5, "2026-02-01")]);
    expect([...rows.values()].find((r) => r.realisedGainLoss !== null)!.realisedGainLoss).toBeCloseTo(795 - 1000, 5);
  });

  it("selling everything leaves 0 units after, and the sale keeps its realised P&L", () => {
    const b = tx("BUY", 50, 4, 0, "2026-01-05");
    const s = tx("SELL", 50, 6, 0, "2026-02-05");
    const r = rowsById([b, s]);
    expect(r.get(s.id)!.unitsAfter).toBe(0);
    expect(r.get(s.id)!.realisedGainLoss).toBeCloseTo(100, 5);
  });

  it("multiple buys then partial and complete sales give the running units and the average-cost P&L", () => {
    const b1 = tx("BUY", 100, 10, 0, "2026-01-01");
    const b2 = tx("BUY", 100, 20, 0, "2026-02-01"); // avg cost $15
    const s1 = tx("SELL", 50, 18, 0, "2026-03-01"); // +$150
    const s2 = tx("SELL", 150, 12, 0, "2026-04-01"); // 150 × (12−15) = −$450
    const r = rowsById([s2, b2, s1, b1]); // given out of order on purpose
    expect(r.get(b1.id)!.unitsAfter).toBe(100);
    expect(r.get(b2.id)!.unitsAfter).toBe(200);
    expect(r.get(s1.id)!.unitsAfter).toBe(150);
    expect(r.get(s1.id)!.realisedGainLoss).toBeCloseTo(150, 5);
    expect(r.get(s2.id)!.unitsAfter).toBe(0);
    expect(r.get(s2.id)!.realisedGainLoss).toBeCloseTo(-450, 5);
  });

  it("buying again after a fully closed position starts a fresh cost base and restores the units", () => {
    const b1 = tx("BUY", 10, 10, 0, "2026-01-01");
    const s1 = tx("SELL", 10, 12, 0, "2026-02-01");
    const b2 = tx("BUY", 20, 30, 0, "2026-03-01");
    const s2 = tx("SELL", 5, 31, 0, "2026-04-01"); // cost is $30/unit, not blended with the old position: +$5
    const r = rowsById([b1, s1, b2, s2]);
    expect(r.get(s1.id)!.unitsAfter).toBe(0);
    expect(r.get(b2.id)!.unitsAfter).toBe(20);
    expect(r.get(s2.id)!.unitsAfter).toBe(15);
    expect(r.get(s2.id)!.realisedGainLoss).toBeCloseTo(5, 5);
  });

  it("uses the frozen figures of a sale recorded with the Sell action, never recalculating them", () => {
    const b = tx("BUY", 100, 10, 0, "2026-01-01");
    const s = tx("SELL", 10, 99, 0, "2026-02-01", { grossProceedsCents: 12000, netProceedsCents: 11900, costBaseCents: 10000, gainLossCents: 1900 });
    const r = rowsById([b, s]).get(s.id)!;
    expect(r.totalValue).toBeCloseTo(119, 5);
    expect(r.realisedGainLoss).toBeCloseTo(19, 5);
  });

  it("works for rows that have no broker account (older data)", () => {
    const b = tx("BUY", 5, 2, 0, "2026-01-01", { brokerAccountId: null });
    expect(transactionRowsOf([b])).toHaveLength(1);
  });
});

describe("negative holdings are prevented (no short selling)", () => {
  const history = () => [tx("BUY", 100, 10, 0, "2026-01-01"), tx("SELL", 40, 12, 0, "2026-02-01")]; // 60 held

  it("accepts a sale within the units held", () => {
    expect(addingLeavesShortfall(history(), tx("SELL", 60, 12, 0, "2026-03-01"))).toBe(false);
  });
  it("rejects a sale of more units than are held", () => {
    expect(addingLeavesShortfall(history(), tx("SELL", 61, 12, 0, "2026-03-01"))).toBe(true);
  });
  it("rejects a sale dated before the units were bought", () => {
    expect(addingLeavesShortfall(history(), tx("SELL", 1, 12, 0, "2025-12-01"))).toBe(true);
  });
  it("rejects selling anything when nothing has been bought", () => {
    expect(addingLeavesShortfall([], tx("SELL", 1, 12, 0, "2026-03-01"))).toBe(true);
  });
  it("a back-dated sale can't leave a later sale short", () => {
    // 100 bought on 1 Jan, 90 sold on 1 Mar. A new sale of 20 on 1 Feb would leave only 80 for the March sale of 90.
    const h = [tx("BUY", 100, 10, 0, "2026-01-01"), tx("SELL", 90, 12, 0, "2026-03-01")];
    expect(addingLeavesShortfall(h, tx("SELL", 20, 11, 0, "2026-02-01"))).toBe(true);
  });
  it("a purchase can't be removed if a later sale relies on it, but an unneeded one can", () => {
    const b1 = tx("BUY", 100, 10, 0, "2026-01-01");
    const b2 = tx("BUY", 50, 11, 0, "2026-01-15");
    const s = tx("SELL", 120, 12, 0, "2026-02-01");
    expect(removingLeavesShortfall([b1, b2, s], b1.id)).toBe(true);
    expect(removingLeavesShortfall([b1, b2, tx("SELL", 100, 12, 0, "2026-02-01")], b2.id)).toBe(false);
  });
});
