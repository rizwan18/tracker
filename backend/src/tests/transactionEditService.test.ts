import { describe, it, expect, beforeEach, vi } from "vitest";

// A minimal in-memory stand-in for the Prisma calls the edit service makes, so the whole edit (validation, writes,
// recomputation) is exercised without a database.
const db = vi.hoisted(() => {
  type Row = Record<string, any>;
  const store = { investments: [] as Row[], txs: [] as Row[], valuations: [] as Row[], brokers: [] as Row[] };
  const match = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" && !(v instanceof Date) ? true : row[k] === v));
  const fake: Row = {
    investmentTransaction: {
      findFirst: async ({ where }: Row) => {
        const t = store.txs.find((x) => x.id === where.id);
        const inv = t && store.investments.find((i) => i.id === t.investmentId);
        if (!t || !inv || inv.householdId !== where.investment.householdId) return null;
        return { ...t, investment: { ...inv } };
      },
      findMany: async ({ where }: Row) => store.txs.filter((t) => match(t, where)).map((t) => ({ ...t })),
      update: async ({ where, data }: Row) => {
        const t = store.txs.find((x) => x.id === where.id)!;
        Object.assign(t, data);
        return { ...t };
      },
      delete: async ({ where }: Row) => {
        store.txs = store.txs.filter((x) => x.id !== where.id);
      },
    },
    investment: {
      findFirst: async ({ where }: Row) => store.investments.find((i) => i.id === where.id && i.householdId === where.householdId) ?? null,
      updateMany: async () => ({ count: 1 }),
    },
    investmentValuation: {
      findFirst: async ({ where }: Row) => [...store.valuations].filter((v) => v.investmentId === where.investmentId).sort((a, b) => b.asAt.getTime() - a.asAt.getTime())[0] ?? null,
      update: async ({ where, data }: Row) => Object.assign(store.valuations.find((v) => v.id === where.id)!, data),
    },
    brokerAccount: { findFirst: async ({ where }: Row) => store.brokers.find((b) => b.id === where.id && b.householdId === where.householdId) ?? null },
  };
  fake.$transaction = async (fn: (d: Row) => unknown) => fn(fake);
  return { store, fake };
});
vi.mock("../lib/prisma", () => ({ prisma: db.fake }));

import { deleteInvestmentTransaction, editInvestmentTransaction } from "../services/transactionEdits";
import { replayLedger, transactionRowsOf } from "../services/holdings";

const H = "household-1";
const NO_SALE = { grossProceedsCents: null, netProceedsCents: null, costBaseCents: null, gainLossCents: null, costMethod: null };
const mk = (id: string, investmentId: string, type: "BUY" | "SELL", date: string, quantity: number, pricePerUnit: number, brokerage = 0, extra: Record<string, unknown> = {}) => ({
  id,
  investmentId,
  type,
  date: new Date(date),
  quantity,
  pricePerUnit,
  brokerage,
  createdAt: new Date(date),
  brokerAccountId: null,
  notes: null,
  clientRequestId: null,
  ...NO_SALE,
  ...extra,
});
const input = (o: Record<string, unknown>) => ({ type: "BUY", date: new Date("2026-01-01"), quantity: 100, pricePerUnit: 10, brokerage: 0, ...o }) as any;
const tx = (id: string) => db.store.txs.find((t) => t.id === id)!;
/** The stored history of one security, typed for the ledger functions. */
const history = (investmentId: string) => db.store.txs.filter((t) => t.investmentId === investmentId) as unknown as Parameters<typeof transactionRowsOf>[0];

beforeEach(() => {
  db.store.investments = [
    { id: "A", householdId: H, name: "Alpha", type: "SHARE" },
    { id: "B", householdId: H, name: "Beta", type: "ETF" },
    { id: "C", householdId: H, name: "Coin", type: "CRYPTO" },
    { id: "Z", householdId: "other", name: "Not mine", type: "SHARE" },
  ];
  // Alpha: bought 100 @ $10, a recorded sale of 40 @ $15 (stored figures), and a later purchase of 50 @ $12.
  db.store.txs = [
    mk("b1", "A", "BUY", "2026-01-01", 100, 10),
    mk("s1", "A", "SELL", "2026-02-01", 40, 15, 0, { grossProceedsCents: 60000, netProceedsCents: 60000, costBaseCents: 40000, gainLossCents: 20000, costMethod: "AVERAGE_COST" }),
    mk("b2", "A", "BUY", "2026-03-01", 50, 12),
    mk("o1", "Z", "BUY", "2026-01-01", 5, 5),
  ];
  db.store.valuations = [{ id: "v1", investmentId: "A", asAt: new Date("2026-03-01"), units: 110, marketPrice: 13, marketValue: 1430, marketValueAud: 1430 }];
  db.store.brokers = [{ id: "acc1", householdId: H }, { id: "accX", householdId: "other" }];
});

describe("editInvestmentTransaction", () => {
  it("saves the corrected fields", async () => {
    await editInvestmentTransaction(H, "b1", input({ date: new Date("2026-01-05"), quantity: 120, pricePerUnit: 9.5, brokerage: 19.95, brokerAccountId: "acc1" }));
    expect(tx("b1")).toMatchObject({ quantity: 120, pricePerUnit: 9.5, brokerage: 19.95, brokerAccountId: "acc1", investmentId: "A" });
    expect(tx("b1").date).toEqual(new Date("2026-01-05"));
  });

  it("recomputes a recorded sale's stored cost base and gain when an earlier purchase's price is corrected", async () => {
    await editInvestmentTransaction(H, "b1", input({ pricePerUnit: 12 })); // sold 40 units now cost $480, not $400
    expect(tx("s1")).toMatchObject({ costBaseCents: 48000, gainLossCents: 12000, netProceedsCents: 60000 });
  });

  it("recomputes proceeds and gain when the sale itself is corrected", async () => {
    await editInvestmentTransaction(H, "s1", input({ type: "SELL", date: new Date("2026-02-01"), quantity: 40, pricePerUnit: 16, brokerage: 10 }));
    expect(tx("s1")).toMatchObject({ grossProceedsCents: 64000, netProceedsCents: 63000, costBaseCents: 40000, gainLossCents: 23000 });
  });

  it("keeps the books balanced after a correction: cost taken out by sales + cost still held = total paid", async () => {
    await editInvestmentTransaction(H, "b1", input({ quantity: 110, pricePerUnit: 9.5, brokerage: 20 }));
    const sold = db.store.txs.filter((t) => t.investmentId === "A").reduce((a, t) => a + (t.costBaseCents ?? 0), 0) / 100;
    expect(sold + replayLedger(history("A")).costBase).toBeCloseTo(110 * 9.5 + 20 + 50 * 12, 1);
  });

  it("updates the holding: units, realised P&L and units after every transaction follow the edit", async () => {
    await editInvestmentTransaction(H, "s1", input({ type: "SELL", date: new Date("2026-02-01"), quantity: 100, pricePerUnit: 15 }));
    const rows = new Map(transactionRowsOf(history("A")).map((r) => [r.id, r]));
    expect(rows.get("s1")!.unitsAfter).toBe(0);
    expect(rows.get("b2")!.unitsAfter).toBe(50);
  });

  it("moves the holding's recorded units along when they were tracking the history", async () => {
    await editInvestmentTransaction(H, "b2", input({ date: new Date("2026-03-01"), quantity: 70, pricePerUnit: 12 })); // 110 → 130 units
    expect(db.store.valuations[0]).toMatchObject({ units: 130 });
    expect(db.store.valuations[0]!.marketValue).toBeCloseTo(1430 * (130 / 110), 5);
  });

  it("leaves a recorded valuation alone when it deliberately differs from the history", async () => {
    db.store.valuations[0]!.units = 500; // e.g. from a broker statement
    await editInvestmentTransaction(H, "b2", input({ date: new Date("2026-03-01"), quantity: 70, pricePerUnit: 12 }));
    expect(db.store.valuations[0]!.units).toBe(500);
  });

  it("refuses a correction that would leave fewer units than were sold, and changes nothing", async () => {
    const before = JSON.stringify(db.store.txs);
    await expect(editInvestmentTransaction(H, "b1", input({ quantity: 30 }))).rejects.toThrow(/fewer units than were sold/);
    expect(JSON.stringify(db.store.txs)).toBe(before);
  });

  it("refuses moving a purchase to a date after the sale that relies on it", async () => {
    await expect(editInvestmentTransaction(H, "b1", input({ date: new Date("2026-03-15") }))).rejects.toThrow(/fewer units/);
    expect(tx("b1").date).toEqual(new Date("2026-01-01"));
  });

  it("turning a mistaken sale into a purchase clears its stored sale figures", async () => {
    await editInvestmentTransaction(H, "s1", input({ type: "BUY", date: new Date("2026-02-01"), quantity: 40, pricePerUnit: 15 }));
    expect(tx("s1")).toMatchObject({ type: "BUY", ...NO_SALE });
    expect(replayLedger(history("A")).quantity).toBe(190);
  });

  it("moves a transaction to the right security, rechecking both holdings", async () => {
    await editInvestmentTransaction(H, "b2", input({ investmentId: "B", date: new Date("2026-03-01"), quantity: 50, pricePerUnit: 12 }));
    expect(tx("b2").investmentId).toBe("B");
    expect(db.store.txs.filter((t) => t.investmentId === "A")).toHaveLength(2);
    expect(db.store.txs.filter((t) => t.investmentId === "B")).toHaveLength(1);
  });

  it("refuses moving a purchase away if sales left behind would be stranded", async () => {
    await expect(editInvestmentTransaction(H, "b1", input({ investmentId: "B" }))).rejects.toThrow(/fewer units/);
    expect(tx("b1").investmentId).toBe("A");
  });

  it("only allows moving between shares/ETFs, and only to the person's own securities", async () => {
    await expect(editInvestmentTransaction(H, "b2", input({ investmentId: "C", date: new Date("2026-03-01") }))).rejects.toThrow(/shares, ETFs and LICs/);
    await expect(editInvestmentTransaction(H, "b2", input({ investmentId: "Z", date: new Date("2026-03-01") }))).rejects.toThrow(/couldn't find the security/);
    await expect(editInvestmentTransaction(H, "b2", input({ investmentId: "nope", date: new Date("2026-03-01") }))).rejects.toThrow(/couldn't find the security/);
  });

  it("rejects a broker account that isn't the household's, and can clear the account", async () => {
    await expect(editInvestmentTransaction(H, "b1", input({ brokerAccountId: "accX" }))).rejects.toThrow(/broker account/);
    await editInvestmentTransaction(H, "b1", input({ brokerAccountId: "acc1" }));
    expect(tx("b1").brokerAccountId).toBe("acc1");
    await editInvestmentTransaction(H, "b1", input({ brokerAccountId: null }));
    expect(tx("b1").brokerAccountId).toBeNull();
  });

  it("can't touch another household's transaction", async () => {
    await expect(editInvestmentTransaction(H, "o1", input({}))).rejects.toThrow(/couldn't find that transaction/);
    expect(tx("o1").quantity).toBe(5);
  });

  it("saving the same values twice is harmless: no duplicate records, same figures", async () => {
    const edit = () => editInvestmentTransaction(H, "b1", input({ pricePerUnit: 11 }));
    await edit();
    const once = JSON.stringify(db.store.txs);
    await edit();
    expect(JSON.stringify(db.store.txs)).toBe(once);
    expect(db.store.txs).toHaveLength(4);
  });
});

describe("deleteInvestmentTransaction", () => {
  it("deleting a later purchase leaves the earlier sale alone and follows the holding's units", async () => {
    // Alpha: b1 100 @ 10, s1 sells 40, b2 50 @ 12. Deleting b2 leaves 60 units; the sale came before b2.
    await deleteInvestmentTransaction(H, "b2");
    expect(db.store.txs.some((t) => t.id === "b2")).toBe(false);
    expect(replayLedger(history("A")).quantity).toBe(60);
    expect(db.store.valuations[0]!.units).toBe(60);
    expect(tx("s1")).toMatchObject({ costBaseCents: 40000, gainLossCents: 20000 });
  });
  it("deleting an earlier purchase re-freezes a later sale's stored figures against the new pool", async () => {
    // A bad extra purchase (100 @ 20) sits before the sale, so the sale's stored figures were frozen against a 200-unit pool
    // averaging $15: 40 units cost $600, a $0 result. Deleting it must put them back to the 100 @ $10 pool: $400 cost, $200 gain.
    db.store.txs.unshift(mk("bad", "A", "BUY", "2025-12-01", 100, 20));
    Object.assign(tx("s1"), { costBaseCents: 60000, gainLossCents: 0 });
    await deleteInvestmentTransaction(H, "bad");
    expect(tx("s1")).toMatchObject({ costBaseCents: 40000, gainLossCents: 20000, netProceedsCents: 60000 });
  });
  it("deleting a recorded sale gives the units back", async () => {
    await deleteInvestmentTransaction(H, "s1");
    expect(tx("s1")).toBeUndefined();
    expect(replayLedger(history("A")).quantity).toBe(150);
    expect(db.store.valuations[0]!.units).toBe(150);
  });
  it("refuses to delete a purchase a later sale relies on, changing nothing", async () => {
    const before = structuredClone({ txs: db.store.txs, vals: db.store.valuations });
    await expect(deleteInvestmentTransaction(H, "b1")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/later sale relies/) });
    expect({ txs: db.store.txs, vals: db.store.valuations }).toEqual(before);
  });
  it("404s for a missing transaction and for another household's", async () => {
    await expect(deleteInvestmentTransaction(H, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(deleteInvestmentTransaction(H, "o1")).rejects.toMatchObject({ status: 404 });
    expect(tx("o1")).toBeDefined();
  });
});
