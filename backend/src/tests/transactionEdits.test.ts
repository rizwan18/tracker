import { describe, it, expect } from "vitest";
import { checkEditShortfall, recomputeSaleSnapshots, replayLedger, transactionRowsOf } from "../services/holdings";

let n = 0;
type T = ReturnType<typeof tx>;
const tx = (type: "BUY" | "SELL", quantity: number, pricePerUnit: number, brokerage: number, date: string, extra: Record<string, unknown> = {}) => ({
  id: `e${++n}`,
  type,
  quantity,
  pricePerUnit,
  brokerage,
  date: new Date(date),
  createdAt: new Date(date),
  grossProceedsCents: null as number | null,
  netProceedsCents: null as number | null,
  costBaseCents: null as number | null,
  gainLossCents: null as number | null,
  costMethod: null as string | null,
  ...extra,
});
/** A sale recorded with the Sell action carries stored (frozen) figures. */
const recordedSale = (quantity: number, price: number, fees: number, date: string) =>
  tx("SELL", quantity, price, fees, date, { grossProceedsCents: 1, netProceedsCents: 1, costBaseCents: 1, gainLossCents: 0, costMethod: "AVERAGE_COST" });

describe("transactionRowsOf — what is needed to match sells with buys", () => {
  const b1 = tx("BUY", 100, 40, 0, "2026-01-10");
  const s1 = tx("SELL", 40, 45, 0, "2026-03-15");
  const b2 = tx("BUY", 50, 42, 0, "2026-04-20");
  const s2 = tx("SELL", 30, 46, 0, "2026-05-10");
  const rows = new Map(transactionRowsOf([s2, b2, s1, b1]).map((r) => [r.id, r]));

  it("numbers transactions in replay order, regardless of input order", () => {
    expect([b1, s1, b2, s2].map((t) => rows.get(t.id)!.seq)).toEqual([0, 1, 2, 3]);
  });
  it("shows the pool a sale draws its average cost from, and the cost it takes out", () => {
    const r = rows.get(s1.id)!;
    expect(r.poolQuantityBefore).toBe(100);
    expect(r.poolCostBefore).toBe(4000);
    expect(r.costOfSold).toBeCloseTo(1600, 5); // 40 × $40
    expect(r.realisedGainLoss).toBeCloseTo(200, 5); // $1,800 − $1,600
    const r2 = rows.get(s2.id)!;
    expect(r2.poolQuantityBefore).toBe(110); // 60 left + 50 bought
    expect(r2.poolCostBefore).toBeCloseTo(2400 + 2100, 5);
    expect(r2.costOfSold).toBeCloseTo((4500 / 110) * 30, 5);
  });
  it("keeps everything in one holding period until the position is sold down to nothing", () => {
    expect([b1, s1, b2, s2].map((t) => rows.get(t.id)!.period)).toEqual([1, 1, 1, 1]);
  });
  it("starts a new holding period when the security is bought again after being fully sold", () => {
    const a = tx("BUY", 10, 10, 0, "2026-01-01");
    const b = tx("SELL", 10, 12, 0, "2026-02-01");
    const c = tx("BUY", 5, 20, 0, "2026-03-01");
    const d = tx("SELL", 2, 25, 0, "2026-04-01");
    const r = new Map(transactionRowsOf([a, b, c, d]).map((x) => [x.id, x]));
    expect([a, b, c, d].map((t) => r.get(t.id)!.period)).toEqual([1, 1, 2, 2]);
    expect(r.get(d.id)!.poolQuantityBefore).toBe(5); // the earlier, fully sold period is not blended in
    expect(r.get(d.id)!.poolCostBefore).toBe(100);
  });
  it("flags a sale of more than was held as a shortfall, and a sale with nothing held as period 0", () => {
    const over = tx("SELL", 50, 10, 0, "2026-02-01");
    const r = transactionRowsOf([tx("BUY", 10, 10, 0, "2026-01-01"), over]);
    expect(r.find((x) => x.id === over.id)!.shortfall).toBe(true);
    const lone = tx("SELL", 1, 10, 0, "2026-01-01");
    const r2 = transactionRowsOf([lone]);
    expect(r2[0]!.period).toBe(0);
    expect(r2[0]!.shortfall).toBe(true);
  });
  it("does not flag a sale of exactly what was held", () => {
    const s = tx("SELL", 10, 12, 0, "2026-02-01");
    expect(transactionRowsOf([tx("BUY", 10, 10, 0, "2026-01-01"), s]).find((x) => x.id === s.id)!.shortfall).toBe(false);
  });
  it("orders a purchase and a sale on the same day buy-first, so the day always replays the same way", () => {
    const buy = tx("BUY", 10, 10, 0, "2026-02-01");
    const sell = tx("SELL", 5, 11, 0, "2026-02-01");
    const r = new Map(transactionRowsOf([sell, buy]).map((x) => [x.id, x]));
    expect(r.get(buy.id)!.seq).toBeLessThan(r.get(sell.id)!.seq);
    expect(r.get(sell.id)!.shortfall).toBe(false);
  });
});

describe("recomputeSaleSnapshots — stored sale figures follow a correction", () => {
  it("recomputes a recorded sale's cost base after an earlier buy is corrected", () => {
    const buy = tx("BUY", 100, 10, 0, "2026-01-01"); // cost $1,000
    const sale = recordedSale(40, 15, 0, "2026-02-01"); // net $600
    expect(recomputeSaleSnapshots([buy, sale]).get(sale.id)).toMatchObject({ netProceedsCents: 60000, costBaseCents: 40000, gainLossCents: 20000 });
    // Correct the buy price to $12: the sold units now cost $480 and the gain falls to $120.
    const corrected = { ...buy, pricePerUnit: 12 };
    expect(recomputeSaleSnapshots([corrected, sale]).get(sale.id)).toMatchObject({ costBaseCents: 48000, gainLossCents: 12000 });
  });
  it("recomputes proceeds when the sale's own price, units or fees are corrected", () => {
    const buy = tx("BUY", 100, 10, 0, "2026-01-01");
    const sale = recordedSale(40, 15, 5, "2026-02-01");
    const fixed = { ...sale, pricePerUnit: 16, brokerage: 10 };
    expect(recomputeSaleSnapshots([buy, fixed]).get(sale.id)).toMatchObject({ grossProceedsCents: 64000, netProceedsCents: 63000, gainLossCents: 23000 });
  });
  it("only touches sales that carry stored figures", () => {
    const buy = tx("BUY", 100, 10, 0, "2026-01-01");
    const plain = tx("SELL", 10, 12, 0, "2026-02-01");
    expect(recomputeSaleSnapshots([buy, plain]).size).toBe(0);
  });
  it("keeps the books balanced: cost taken out by sales + cost still held = total paid, after any correction", () => {
    const b1 = tx("BUY", 100, 10, 20, "2026-01-01");
    const b2 = tx("BUY", 50, 12, 15, "2026-02-01");
    const s1 = recordedSale(60, 14, 10, "2026-03-01");
    const s2 = recordedSale(40, 9, 10, "2026-04-01");
    const correctedB1 = { ...b1, quantity: 110, pricePerUnit: 9.5 };
    const history: T[] = [correctedB1, b2, s1, s2];
    const snaps = recomputeSaleSnapshots(history);
    const soldCost = [...snaps.values()].reduce((a, s) => a + s.costBaseCents, 0) / 100;
    const held = replayLedger(history.map((t) => ({ ...t, ...(snaps.get(t.id) ?? {}) })));
    const paid = 110 * 9.5 + 20 + 50 * 12 + 15;
    expect(soldCost + held.costBase).toBeCloseTo(paid, 1);
  });
  it("multiple purchases at different prices followed by partial then complete sales", () => {
    const b1 = tx("BUY", 100, 10, 0, "2026-01-01");
    const b2 = tx("BUY", 100, 20, 0, "2026-02-01"); // average $15
    const s1 = recordedSale(50, 18, 0, "2026-03-01");
    const s2 = recordedSale(150, 12, 0, "2026-04-01");
    const snaps = recomputeSaleSnapshots([b1, b2, s1, s2]);
    expect(snaps.get(s1.id)!.gainLossCents).toBe(15000); // 50 × ($18 − $15)
    expect(snaps.get(s2.id)!.gainLossCents).toBe(-45000); // 150 × ($12 − $15)
  });
});

describe("checkEditShortfall — corrections can't create a negative holding", () => {
  const base = () => {
    const b = tx("BUY", 100, 10, 0, "2026-01-01");
    const s = tx("SELL", 40, 12, 0, "2026-02-01");
    return { b, s, history: [b, s] };
  };

  it("allows a harmless correction (price, fees)", () => {
    const { b, history } = base();
    expect(checkEditShortfall({ sourceHistory: history, after: { ...b, pricePerUnit: 11 }, moves: false }).ok).toBe(true);
  });
  it("allows increasing a sale up to the units held", () => {
    const { s, history } = base();
    expect(checkEditShortfall({ sourceHistory: history, after: { ...s, quantity: 100 }, moves: false }).ok).toBe(true);
    expect(checkEditShortfall({ sourceHistory: history, after: { ...s, quantity: 101 }, moves: false }).ok).toBe(false);
  });
  it("refuses cutting a purchase below what later sales need", () => {
    const { b, history } = base();
    expect(checkEditShortfall({ sourceHistory: history, after: { ...b, quantity: 30 }, moves: false }).ok).toBe(false);
    expect(checkEditShortfall({ sourceHistory: history, after: { ...b, quantity: 40 }, moves: false }).ok).toBe(true);
  });
  it("refuses moving a purchase's date after the sale that relies on it", () => {
    const { b, history } = base();
    const r = checkEditShortfall({ sourceHistory: history, after: { ...b, date: new Date("2026-03-01") }, moves: false });
    expect(r.ok).toBe(false);
    expect(r.where).toBe("source");
  });
  it("refuses turning a purchase into a sale when that leaves the holding short", () => {
    const { b, history } = base();
    expect(checkEditShortfall({ sourceHistory: history, after: { ...b, type: "SELL" }, moves: false }).ok).toBe(false);
  });
  it("allows turning a mistaken sale into a purchase", () => {
    const { s, history } = base();
    expect(checkEditShortfall({ sourceHistory: history, after: { ...s, type: "BUY" }, moves: false }).ok).toBe(true);
  });
  it("moving a purchase to another security is checked on both: it must not strand sales left behind", () => {
    const { b, history } = base();
    const other = [tx("BUY", 5, 3, 0, "2026-01-01")];
    const r = checkEditShortfall({ sourceHistory: history, targetHistory: other, after: b, moves: true });
    expect(r.ok).toBe(false);
    expect(r.where).toBe("source");
  });
  it("moving a sale to a security that doesn't hold enough is refused, and one that does is accepted", () => {
    const { s, history } = base();
    expect(checkEditShortfall({ sourceHistory: history, targetHistory: [tx("BUY", 10, 3, 0, "2026-01-01")], after: s, moves: true })).toMatchObject({ ok: false, where: "target" });
    expect(checkEditShortfall({ sourceHistory: history, targetHistory: [tx("BUY", 50, 3, 0, "2026-01-01")], after: s, moves: true }).ok).toBe(true);
  });
  it("lets legacy data that is already short be edited, as long as it doesn't get worse", () => {
    const over = tx("SELL", 10, 5, 0, "2026-01-01"); // sold before anything was bought
    const buy = tx("BUY", 5, 5, 0, "2026-02-01");
    expect(checkEditShortfall({ sourceHistory: [over, buy], after: { ...buy, pricePerUnit: 6 }, moves: false }).ok).toBe(true);
    expect(checkEditShortfall({ sourceHistory: [over, buy], after: { ...over, quantity: 20 }, moves: false }).ok).toBe(false);
  });
});
