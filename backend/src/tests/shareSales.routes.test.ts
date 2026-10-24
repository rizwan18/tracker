/**
 * Selling shares end to end: the real Express routes and services against an in-memory stand-in for the database.
 *
 * The stand-in models the database behaviours the sale code relies on (and deliberately has NO unique constraint on the
 * request id, matching the schema — duplicate protection must come from the lock and the check):
 *  - $transaction rolls everything back if the callback throws;
 *  - an UPDATE takes a row lock that is held until the transaction ends (as in PostgreSQL), so two transactions that
 *    both update the same investment run one after the other.
 * It is a model, not PostgreSQL — see the notes in the README about what a live database would add.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { investments: [] as Row[], txs: [] as Row[], vals: [] as Row[], seq: 0, failOnWrite: null as null | number };
  const locks = new Map<string, Promise<void>>();
  const id = (p: string) => `${p}${++state.seq}`;
  const clone = <T,>(v: T): T => structuredClone(v);
  /** Every database call yields to the event loop, as a real round trip would, so concurrent requests genuinely interleave. */
  const tick = () => new Promise<void>((r) => setImmediate(r));

  const matches = (obj: Row, where: Row | undefined): boolean =>
    !where ||
    Object.entries(where).every(([k, v]) => {
      if (k === "investment") return matches(state.investments.find((i) => i.id === obj.investmentId) ?? {}, v);
      if (v && typeof v === "object" && !(v instanceof Date)) return "in" in v ? v.in.includes(obj[k]) : false;
      return obj[k] === v;
    });

  function makeDb(onWrite: () => void, lock: (invId: string) => Promise<void>) {
    return withTicks({
      investment: {
        findFirst: async ({ where }: Row) => state.investments.find((i) => matches(i, where)) ?? null,
        findMany: async ({ where, include }: Row) =>
          state.investments.filter((i) => matches(i, where)).map((i) => ({
            ...i,
            investmentTransactions: include?.investmentTransactions ? state.txs.filter((t) => t.investmentId === i.id).sort((a, b) => a.date - b.date) : undefined,
            dividends: [],
            valuations: include?.valuations ? state.vals.filter((v) => v.investmentId === i.id).sort((a, b) => b.asAt - a.asAt).slice(0, include.valuations.take ?? 99) : undefined,
          })),
        updateMany: async ({ where, data }: Row) => {
          const rows = state.investments.filter((i) => matches(i, where));
          for (const r of rows) await lock(r.id);
          rows.forEach((r) => Object.assign(r, data));
          return { count: rows.length };
        },
      },
      investmentTransaction: {
        findMany: async ({ where }: Row) => state.txs.filter((t) => matches(t, where)).map(clone),
        findFirst: async ({ where }: Row) => state.txs.find((t) => matches(t, where)) ?? null,
        create: async ({ data }: Row) => {
          onWrite();
          const row = { id: id("tx"), createdAt: new Date(1_700_000_000_000 + state.seq * 1000), updatedAt: new Date(), notes: null, grossProceedsCents: null, netProceedsCents: null, costBaseCents: null, gainLossCents: null, costMethod: null, clientRequestId: null, ...data };
          state.txs.push(row);
          return clone(row);
        },
        delete: async ({ where }: Row) => { state.txs = state.txs.filter((t) => t.id !== where.id); },
      },
      investmentValuation: {
        findFirst: async ({ where }: Row) => clone(state.vals.filter((v) => matches(v, where)).sort((a, b) => b.asAt - a.asAt)[0] ?? null),
        findMany: async () => [],
        upsert: async ({ where, create, update }: Row) => {
          onWrite();
          const k = where.investmentId_asAt;
          const existing = state.vals.find((v) => v.investmentId === k.investmentId && v.asAt.getTime() === k.asAt.getTime());
          if (existing) { Object.assign(existing, update); return existing; }
          const row = { id: id("val"), ...create };
          state.vals.push(row);
          return row;
        },
      },
    });
  }
  const withTicks = (db: Row): Row =>
    Object.fromEntries(Object.entries(db).map(([model, ops]) => [model, Object.fromEntries(Object.entries(ops as Row).map(([op, fn]) => [op, async (...a: unknown[]) => { await tick(); return (fn as (...x: unknown[]) => unknown)(...a); }]))]));

  const prisma: Row = {
    ...makeDb(() => {}, async () => {}),
    $transaction: async (fn: (tx: Row) => Promise<unknown>) => {
      // Rollback restores what the data looked like when this transaction first took a lock / wrote. Taking the snapshot only then
      // (not at BEGIN) matters: with concurrent transactions, an earlier snapshot would wipe out another transaction's committed work.
      type Snap = { investments: Row[]; txs: Row[]; vals: Row[] };
      let before: Snap | null = null as Snap | null;
      const snapshot = (): Snap => clone({ investments: state.investments, txs: state.txs, vals: state.vals });
      const held: Array<() => void> = [];
      const lock = async (invId: string) => {
        while (locks.has(invId)) await locks.get(invId);
        let release!: () => void;
        locks.set(invId, new Promise<void>((r) => (release = r)));
        held.push(() => { locks.delete(invId); release(); });
        before ??= snapshot();
      };
      const tx = makeDb(() => {
        before ??= snapshot();
        if (state.failOnWrite !== null && --state.failOnWrite === 0) { state.failOnWrite = null; throw new Error("simulated database failure"); }
      }, lock);
      try {
        return await fn(tx);
      } catch (e) {
        if (before) { state.investments = before.investments; state.txs = before.txs; state.vals = before.vals; } // rollback
        throw e;
      } finally {
        held.forEach((r) => r());
      }
    },
    property: { findMany: async () => [] },
    capitalGainDisposal: { findMany: async () => [] },
  };
  return { state, prisma };
});

vi.mock("../lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = "u1"; req.householdId = req.headers["x-test-household"] ?? "h1"; next(); },
}));

import { createApp } from "../app";
import { totalRealisedCapitalGains, portfolioValue } from "../services/calculations";

let server: Server;
let base: string;
beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise((r) => server.close(r)));

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};

const today = () => new Date().toISOString().slice(0, 10);
let n = 0;
const rid = () => `req-${String(++n).padStart(4, "0")}-aaaaaaaaaaaa`;
const sellBody = (o: Record<string, unknown> = {}) => ({ quantity: 50, pricePerShare: 15, saleDate: today(), fees: 10, clientRequestId: rid(), ...o });

/** A holding bought as 200 units @ $10 (cost $2,000.00) a year ago, with the recorded unit count the app keeps alongside. */
function seed({ withValuation = true, type = "SHARE" }: { withValuation?: boolean; type?: string } = {}) {
  h.state.investments.push({ id: "inv1", householdId: "h1", name: "Acme Ltd", ticker: "ACM", type, currency: "AUD", market: "ASX", currentValueOverride: null, marketPrice: 14, updatedAt: new Date(0), createdAt: new Date(0) });
  h.state.txs.push({ id: "buy1", investmentId: "inv1", type: "BUY", date: new Date("2025-06-01T00:00:00Z"), quantity: 200, pricePerUnit: 10, brokerage: 0, createdAt: new Date("2025-06-01"), grossProceedsCents: null, netProceedsCents: null, costBaseCents: null, gainLossCents: null, clientRequestId: null });
  if (withValuation) h.state.vals.push({ id: "val0", investmentId: "inv1", asAt: new Date("2025-06-01T00:00:00Z"), units: 200, marketPrice: 10, marketValue: 2000, marketValueAud: 2000, currency: "AUD", source: "MANUAL" });
}

beforeEach(() => {
  Object.assign(h.state, { investments: [], txs: [], vals: [], seq: 0, failOnWrite: null });
});

describe("POST /investments/:id/sales — recording a sale", () => {
  it("partial sale (200 → sell 50 @ $15, $10 fees): records the sale, frozen figures, reduces units, keeps cost base", async () => {
    seed();
    const r = await call("POST", "/investments/inv1/sales", sellBody());
    expect(r.status).toBe(201);
    expect(r.body.sale).toMatchObject({ grossProceedsCents: 75000, feesCents: 1000, netProceedsCents: 74000, costBaseCents: 50000, gainLossCents: 24000, outcome: "GAIN", costMethod: "AVERAGE_COST" });
    expect(r.body).toMatchObject({ duplicate: false, remainingQuantity: 150, closed: false });

    // persisted in the ledger alongside (not replacing) the original purchase
    expect(h.state.txs.map((t) => t.type)).toEqual(["BUY", "SELL"]);
    expect(h.state.txs[0]).toMatchObject({ quantity: 200, pricePerUnit: 10 });

    // the holding now reports 150 units and the cost base of those 150 is untouched per-unit ($10 → $1,500)
    const list = await call("GET", "/investments");
    const inv = list.body[0];
    expect(inv.summary).toMatchObject({ quantity: 150, costBase: 1500, closed: false });
    expect(inv.holding.units).toBe(150);
    expect(inv.sellable.availableQuantity).toBe(150);
    // realised is separate from unrealised
    expect(inv.summary.realisedGain).toBe(240);
    expect(inv.summary.realisedLoss).toBe(0);
  });

  it("full sale closes the holding without deleting anything", async () => {
    seed();
    const r = await call("POST", "/investments/inv1/sales", sellBody({ quantity: 200, pricePerShare: 8, fees: 0 }));
    expect(r.status).toBe(201);
    expect(r.body.sale).toMatchObject({ costBaseCents: 200000, gainLossCents: -40000, outcome: "LOSS" });
    expect(r.body).toMatchObject({ remainingQuantity: 0, closed: true });

    expect(h.state.investments).toHaveLength(1); // asset kept
    expect(h.state.txs).toHaveLength(2); // purchase + sale kept
    expect(h.state.vals.some((v) => v.units === 0)).toBe(true);
    const inv = (await call("GET", "/investments")).body[0];
    expect(inv.summary).toMatchObject({ quantity: 0, costBase: 0, currentValue: 0, closed: true, realisedLoss: 400 });
    expect(inv.sellable.canSell).toBe(false);
  });

  it("the sale flows into realised gains and portfolio totals, kept separate from the value of what is still held", async () => {
    seed();
    await call("POST", "/investments/inv1/sales", sellBody({ quantity: 50, pricePerShare: 15, fees: 10 }));
    const fy = (await call("GET", "/capital-gains")).body;
    expect(fy.items).toHaveLength(1);
    expect(fy.items[0]).toMatchObject({ grossProceeds: 750, saleCosts: 10, proceeds: 740, costBase: 500, grossGainLoss: 240, costMethod: "AVERAGE_COST" });
    expect(fy.items[0].recordedAt).toBeTruthy();

    const fyId = fy.items[0].financialYear as string;
    expect(await totalRealisedCapitalGains("h1", fyId)).toEqual({ gains: 240, losses: 0, net: 240 });
    // shares are valued from the recorded holding: 150 units × $10 purchase price — the $740 proceeds are NOT added back
    expect((await portfolioValue("h1")).shares).toBe(1500);
  });

  it("a ledger-only holding (no recorded unit count) works too", async () => {
    seed({ withValuation: false });
    const r = await call("POST", "/investments/inv1/sales", sellBody());
    expect(r.status).toBe(201);
    expect(h.state.vals).toHaveLength(0);
    expect((await call("GET", "/investments")).body[0].summary.quantity).toBe(150);
  });

  it("a sale dated after the latest holding record adds a newer record; the old one is kept as history", async () => {
    seed();
    await call("POST", "/investments/inv1/sales", sellBody({ saleDate: today() }));
    expect(h.state.vals).toHaveLength(2);
    expect(h.state.vals.find((v) => v.id === "val0")!.units).toBe(200);
    expect(h.state.vals.find((v) => v.id !== "val0")).toMatchObject({ units: 150, source: "SALE" });
  });

  it("two successive partial sales keep the remaining per-unit cost steady", async () => {
    seed();
    await call("POST", "/investments/inv1/sales", sellBody({ quantity: 50, fees: 0 }));
    const second = await call("POST", "/investments/inv1/sales", sellBody({ quantity: 50, fees: 0 }));
    expect(second.body.sale.costBaseCents).toBe(50000);
    expect((await call("GET", "/investments")).body[0].summary).toMatchObject({ quantity: 100, costBase: 1000 });
  });

  it("a later purchase at a different price changes the average for later sales, not for recorded ones", async () => {
    seed();
    const first = await call("POST", "/investments/inv1/sales", sellBody({ quantity: 100, pricePerShare: 15, fees: 0, saleDate: "2025-09-01" }));
    expect(first.body.sale.costBaseCents).toBe(100000);
    h.state.txs.push({ id: "buy2", investmentId: "inv1", type: "BUY", date: new Date("2025-10-01T00:00:00Z"), quantity: 100, pricePerUnit: 30, brokerage: 0, createdAt: new Date("2025-10-01"), grossProceedsCents: null, netProceedsCents: null, costBaseCents: null, gainLossCents: null, clientRequestId: null });
    const second = await call("POST", "/investments/inv1/sales", sellBody({ quantity: 100, pricePerShare: 15, fees: 0, saleDate: "2025-11-01" }));
    expect(second.body.sale.costBaseCents).toBe(200000); // avg of (100 @ $10 left + 100 @ $30) = $20
    const gains = (await call("GET", "/capital-gains")).body.items.map((i: any) => i.grossGainLoss).sort();
    expect(gains).toEqual([-500, 500]);
  });
});

describe("rejecting bad sales (validated by the server, not just the form)", () => {
  const rejected = async (body: Record<string, unknown>, status: number, message: RegExp) => {
    const r = await call("POST", "/investments/inv1/sales", sellBody(body));
    expect(r.status).toBe(status);
    expect(r.body.error).toMatch(message);
    expect(h.state.txs).toHaveLength(1); // nothing recorded
    expect(h.state.vals.find((v) => v.id === "val0")!.units).toBe(200);
  };

  it("selling more than is held", async () => {
    seed();
    await rejected({ quantity: 201 }, 400, /only 200 are available/);
  });
  it("selling more than remains after an earlier sale", async () => {
    seed();
    await call("POST", "/investments/inv1/sales", sellBody({ quantity: 150 }));
    h.state.txs.length = 2; // (leave the recorded sale in place)
    const r = await call("POST", "/investments/inv1/sales", sellBody({ quantity: 51 }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/only 50 are available/);
  });
  it("zero / negative / missing / non-numeric quantity", async () => {
    seed();
    await rejected({ quantity: 0 }, 400, /greater than zero/);
    await rejected({ quantity: -3 }, 400, /greater than zero/);
    await rejected({ quantity: "abc" }, 400, /as a number/);
    await rejected({ quantity: undefined }, 400, /Please enter/);
  });
  it("negative, blank or non-numeric price", async () => {
    seed();
    await rejected({ pricePerShare: -1 }, 400, /can't be negative/);
    await rejected({ pricePerShare: "" }, 400, /Please enter/);
    await rejected({ pricePerShare: "x" }, 400, /as a number/);
  });
  it("negative fees", async () => {
    seed();
    await rejected({ fees: -0.01 }, 400, /can't be negative/);
  });
  it("invalid, future or pre-purchase dates", async () => {
    seed();
    await rejected({ saleDate: "2026-02-30" }, 400, /valid sale date/);
    await rejected({ saleDate: "" }, 400, /sale date/);
    await rejected({ saleDate: "2999-01-01" }, 400, /future/);
    await rejected({ saleDate: "2025-05-31" }, 400, /first purchase/);
  });
  it("a missing or malformed idempotency key", async () => {
    seed();
    await rejected({ clientRequestId: undefined }, 400, /request id/);
    await rejected({ clientRequestId: "short" }, 400, /request id/);
  });
  it("types that can't be sold here, and holdings with no purchase history", async () => {
    seed({ type: "CRYPTO" });
    await rejected({}, 409, /shares, ETFs and LICs/);
    h.state.investments[0]!.type = "SHARE";
    h.state.txs.length = 0;
    const r = await call("POST", "/investments/inv1/sales", sellBody());
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/no purchase history/);
  });
  it("a sale dated in the past is measured against what was held then, and can't starve a later sale", async () => {
    seed();
    h.state.txs.push({ id: "buy2", investmentId: "inv1", type: "BUY", date: new Date("2025-12-01T00:00:00Z"), quantity: 100, pricePerUnit: 10, brokerage: 0, createdAt: new Date(), grossProceedsCents: null, netProceedsCents: null, costBaseCents: null, gainLossCents: null, clientRequestId: null });
    h.state.vals[0]!.units = 300;
    // on 2025-09-01 only 200 were held
    let r = await call("POST", "/investments/inv1/sales", sellBody({ quantity: 250, saleDate: "2025-09-01" }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/you only held 200 then/);
    // a later recorded sale of 290 on 2025-12-15, then a backdated sale of 20 would leave it short
    expect((await call("POST", "/investments/inv1/sales", sellBody({ quantity: 290, saleDate: "2025-12-15" }))).status).toBe(201);
    r = await call("POST", "/investments/inv1/sales", sellBody({ quantity: 20, saleDate: "2025-08-01" }));
    expect(r.status).toBe(400);
  });
  it("an investment in another household is not found (no cross-household access)", async () => {
    seed();
    const r = await call("POST", "/investments/inv1/sales", sellBody(), { "x-test-household": "someone-else" });
    expect(r.status).toBe(404);
    expect(h.state.txs).toHaveLength(1);
    expect((await call("POST", "/investments/inv1/sales/preview", sellBody(), { "x-test-household": "someone-else" })).status).toBe(404);
  });
});

describe("duplicate and concurrent submissions", () => {
  it("repeating the same request records ONE sale and returns the original", async () => {
    seed();
    const body = sellBody();
    const first = await call("POST", "/investments/inv1/sales", body);
    const again = await call("POST", "/investments/inv1/sales", body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.sale.id).toBe(first.body.sale.id);
    expect(h.state.txs.filter((t) => t.type === "SELL")).toHaveLength(1);
    expect(h.state.vals.find((v) => v.source === "SALE")!.units).toBe(150); // units reduced once, not twice
  });

  it("the same request id reused for a DIFFERENT sale is refused", async () => {
    seed();
    const body = sellBody();
    await call("POST", "/investments/inv1/sales", body);
    const r = await call("POST", "/investments/inv1/sales", { ...body, quantity: 60 });
    expect(r.status).toBe(409);
    expect(h.state.txs.filter((t) => t.type === "SELL")).toHaveLength(1);
  });

  it("ten simultaneous identical submissions (double-click storm) record exactly one sale", async () => {
    seed();
    const body = sellBody();
    const results = await Promise.all(Array.from({ length: 10 }, () => call("POST", "/investments/inv1/sales", body)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(9);
    expect(h.state.txs.filter((t) => t.type === "SELL")).toHaveLength(1);
  });

  it("concurrent DIFFERENT sales can't oversell: 5 × 50 of 200 units → 4 succeed, 1 is refused", async () => {
    seed();
    const results = await Promise.all(Array.from({ length: 5 }, () => call("POST", "/investments/inv1/sales", sellBody({ quantity: 50, fees: 0 }))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.status).toBe(409);
    expect(refused[0]!.body.error).toBe("No units left to sell.");
    expect(h.state.txs.filter((t) => t.type === "SELL")).toHaveLength(4);
    expect((await call("GET", "/investments")).body[0].summary).toMatchObject({ quantity: 0, closed: true });
  });
});

describe("atomicity: a failure leaves the holding and history exactly as they were", () => {
  it("if the holding update fails AFTER the sale row was written, the sale row is rolled back too", async () => {
    seed();
    const before = structuredClone({ investments: h.state.investments, txs: h.state.txs, vals: h.state.vals });
    h.state.failOnWrite = 2; // write #1 = the sale row (succeeds), write #2 = the holding's unit count (fails)
    const r = await call("POST", "/investments/inv1/sales", sellBody());
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/Something went wrong/); // an actionable, non-leaky message
    expect(h.state.failOnWrite).toBeNull(); // the failure really was reached after the first write
    expect({ investments: h.state.investments, txs: h.state.txs, vals: h.state.vals }).toEqual(before);
  });

  it("if the sale row itself fails to write, nothing changes", async () => {
    seed();
    const before = structuredClone({ txs: h.state.txs, vals: h.state.vals });
    h.state.failOnWrite = 1;
    expect((await call("POST", "/investments/inv1/sales", sellBody())).status).toBe(500);
    expect({ txs: h.state.txs, vals: h.state.vals }).toEqual(before);
  });

  it("after a failed attempt the same request can simply be retried, and is recorded once", async () => {
    seed();
    const body = sellBody();
    h.state.failOnWrite = 2;
    expect((await call("POST", "/investments/inv1/sales", body)).status).toBe(500);
    const retry = await call("POST", "/investments/inv1/sales", body);
    expect(retry.status).toBe(201);
    expect(h.state.txs.filter((t) => t.type === "SELL")).toHaveLength(1);
    expect(h.state.vals.find((v) => v.source === "SALE")!.units).toBe(150);
  });
});

describe("POST /investments/:id/sales/preview", () => {
  it("returns the figures without saving anything", async () => {
    seed();
    const r = await call("POST", "/investments/inv1/sales/preview", { quantity: 50, pricePerShare: 15, saleDate: today(), fees: 10 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ grossProceedsCents: 75000, netProceedsCents: 74000, costBaseCents: 50000, gainLossCents: 24000, outcome: "GAIN", availableQuantity: 200, remainingQuantity: 150, costBasePerShare: 10, ticker: "ACM" });
    expect(h.state.txs).toHaveLength(1);
    expect(h.state.vals).toHaveLength(1);
  });
  it("applies the same validation as recording", async () => {
    seed();
    expect((await call("POST", "/investments/inv1/sales/preview", { quantity: 999, pricePerShare: 1, saleDate: today() })).status).toBe(400);
    expect((await call("POST", "/investments/inv1/sales/preview", { quantity: 1, pricePerShare: -1, saleDate: today() })).status).toBe(400);
  });
});

describe("recorded sales are permanent; existing behaviour is untouched", () => {
  it("a sale recorded with the Sell action can't be deleted", async () => {
    seed();
    const sale = (await call("POST", "/investments/inv1/sales", sellBody())).body.sale;
    const r = await call("DELETE", `/investments/transactions/${sale.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/can't be deleted/);
    expect(h.state.txs.some((t) => t.id === sale.id)).toBe(true);
  });
  it("older SELL rows and purchases can still be deleted as before", async () => {
    seed();
    h.state.txs.push({ id: "old", investmentId: "inv1", type: "SELL", date: new Date("2025-07-01T00:00:00Z"), quantity: 5, pricePerUnit: 11, brokerage: 0, createdAt: new Date(), grossProceedsCents: null, netProceedsCents: null, costBaseCents: null, gainLossCents: null, clientRequestId: null });
    expect((await call("DELETE", "/investments/transactions/old")).status).toBe(200);
    expect((await call("DELETE", "/investments/transactions/buy1")).status).toBe(200);
  });
  it("legacy SELL rows still produce the same realised figures in the Capital Gains report", async () => {
    seed();
    h.state.txs.push({ id: "old", investmentId: "inv1", type: "SELL", date: new Date("2025-07-01T00:00:00Z"), quantity: 100, pricePerUnit: 15, brokerage: 10, createdAt: new Date(), grossProceedsCents: null, netProceedsCents: null, costBaseCents: null, gainLossCents: null, clientRequestId: null });
    const item = (await call("GET", "/capital-gains")).body.items[0];
    expect(item).toMatchObject({ proceeds: 1490, costBase: 1000, grossGainLoss: 490, grossProceeds: 1500, costMethod: null });
  });
});
