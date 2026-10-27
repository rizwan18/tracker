import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { BrokerAccount, Investment, TransactionRow } from "../api/types";
import { EditTransactionDialog } from "../components/EditTransactionDialog";
import { RealisedCell, TransactionsTable, TypeBadge } from "../components/TransactionsTable";
import { brokerLabel, holdingBrokerAccountId } from "../lib/brokers";
import { NO_BROKER, NO_FILTERS, buildTransactionLines, filterLines, groupBySecurity, groupMetricsOf, matchSale, validateTransactionEdit } from "../lib/transactions";

type Tx = Investment["investmentTransactions"][number];
const tx = (id: string, type: "BUY" | "SELL", date: string, quantity: number, pricePerUnit: number, brokerage = 0, brokerAccountId: string | null = null): Tx =>
  ({ id, type, date: `${date}T00:00:00.000Z`, createdAt: `${date}T01:00:00.000Z`, quantity, pricePerUnit, brokerage, notes: null, brokerAccountId }) as Tx;
const row = (id: string, o: Partial<TransactionRow>): TransactionRow => ({ id, seq: 0, period: 1, totalValue: 0, unitsAfter: 0, realisedGainLoss: null, poolQuantityBefore: 0, poolCostBefore: 0, costOfSold: null, shortfall: false, ...o });

function inv(o: Partial<Investment> & { id: string; txs: Tx[]; rows?: TransactionRow[] }): Investment {
  const { txs, rows, ...rest } = o;
  return {
    name: "Test Co",
    ticker: "TST",
    type: "SHARE",
    notes: null,
    currentValueOverride: null,
    market: "ASX",
    currency: "AUD",
    marketPrice: 12,
    marketPriceUpdatedAt: "2026-10-26T01:00:00Z",
    investmentTransactions: txs,
    transactionRows: rows,
    dividends: [],
    holding: null,
    summary: { quantity: 60, costBase: 600, costBaseKnown: true, currentValue: 720, unrealisedGainLoss: 120, realisedGain: 0, realisedLoss: 0, realisedCostBase: 0, closed: false },
    sellable: { canSell: true, availableQuantity: 60, reason: null },
    ...rest,
  } as Investment;
}

// TST: bought 100 @ $10 (+$20), sold 40 @ $15 (−$10): profit $182 on a cost of $408 ($10.20 average).
const tst = inv({
  id: "a",
  txs: [tx("t2", "SELL", "2026-03-01", 40, 15, 10, "acc1"), tx("t1", "BUY", "2026-01-05", 100, 10, 20, "acc1")], // deliberately out of order
  rows: [
    row("t1", { seq: 0, totalValue: 1020, unitsAfter: 100 }),
    row("t2", { seq: 1, totalValue: 590, unitsAfter: 60, realisedGainLoss: 182, poolQuantityBefore: 100, poolCostBefore: 1020, costOfSold: 408 }),
  ],
});
// XYZ: bought 50 @ $4, sold all 50 @ $3 → loss of $50, position closed.
const xyz = inv({
  id: "b",
  name: "Xyz Ltd",
  ticker: "XYZ",
  txs: [tx("t3", "BUY", "2026-02-01", 50, 4), tx("t4", "SELL", "2026-04-01", 50, 3)],
  rows: [
    row("t3", { seq: 0, totalValue: 200, unitsAfter: 50 }),
    row("t4", { seq: 1, totalValue: 150, unitsAfter: 0, realisedGainLoss: -50, poolQuantityBefore: 50, poolCostBefore: 200, costOfSold: 200 }),
  ],
  marketPrice: null,
  summary: { quantity: 0, costBase: 0, costBaseKnown: true, currentValue: 0, unrealisedGainLoss: 0, realisedGain: 0, realisedLoss: 50, realisedCostBase: 200, closed: true },
  sellable: { canSell: false, availableQuantity: 0, reason: "No units left to sell." },
});
const accounts: BrokerAccount[] = [
  { id: "acc1", brokerName: "CommSec", accountName: "Joint", loginEmail: "joint@example.com", transactionCount: 2 },
  { id: "acc2", brokerName: "CommSec", accountName: "SMSF", loginEmail: "smsf@example.com", transactionCount: 0 },
];
const lines = buildTransactionLines([tst, xyz]);

describe("building the list", () => {
  it("has every transaction exactly once, with the server's totals, units after and realised P&L", () => {
    expect(lines).toHaveLength(4);
    expect(new Set(lines.map((l) => l.id)).size).toBe(4);
    expect(lines.find((l) => l.id === "t2")).toMatchObject({ type: "SELL", totalValue: 590, unitsAfter: 60, realisedGainLoss: 182, costOfSold: 408 });
    expect(lines.find((l) => l.id === "t1")).toMatchObject({ type: "BUY", totalValue: 1020, unitsAfter: 100, realisedGainLoss: null });
  });
  it("never lists a transaction twice, even if the same one is sent twice", () => {
    const dup = inv({ id: "d", txs: [tx("x1", "BUY", "2026-01-01", 1, 1), tx("x1", "BUY", "2026-01-01", 1, 1)] });
    expect(buildTransactionLines([dup])).toHaveLength(1);
  });
  it("ignores crypto and other non-share investments", () => {
    expect(buildTransactionLines([inv({ id: "c", type: "CRYPTO", txs: [tx("c1", "BUY", "2026-01-01", 1, 1)] })])).toHaveLength(0);
  });
  it("still works when the server sent no derived rows", () => {
    const l = buildTransactionLines([inv({ id: "z", txs: [tx("z1", "BUY", "2026-01-01", 10, 2, 5), tx("z2", "SELL", "2026-02-01", 5, 3, 5)] })]);
    expect(l.find((x) => x.id === "z1")!.totalValue).toBe(25);
    expect(l.find((x) => x.id === "z2")!.totalValue).toBe(10);
  });
  it("uses US$ for Wall St holdings", () => {
    expect(buildTransactionLines([inv({ id: "u", market: "WALL_ST", currency: "USD", txs: [tx("u1", "BUY", "2026-01-01", 1, 1)] })])[0]!.currency).toBe("USD");
  });
});

describe("grouping by security", () => {
  const groups = groupBySecurity([xyz, tst], lines);
  it("makes one group per security with all of its transactions together, oldest first (even if sent out of order)", () => {
    expect(groups.map((g) => g.investment.ticker)).toEqual(["TST", "XYZ"]);
    expect(groups[0]!.lines.map((l) => l.id)).toEqual(["t1", "t2"]);
    expect(groups[1]!.lines.map((l) => l.id)).toEqual(["t3", "t4"]);
  });
  it("lists holdings before fully sold securities", () => {
    expect(groupBySecurity([xyz, tst], lines).map((g) => g.metrics.closed)).toEqual([false, true]);
  });
  it("covers every transaction exactly once across all groups", () => {
    expect(groups.flatMap((g) => g.lines).map((l) => l.id).sort()).toEqual(["t1", "t2", "t3", "t4"]);
  });
  it("keeps a security that has no transactions yet, so a statement-only holding doesn't vanish", () => {
    const empty = inv({ id: "e", ticker: "EMP", name: "Empty Ltd", txs: [], summary: { quantity: 0, costBase: 0, costBaseKnown: false, currentValue: 0, unrealisedGainLoss: 0, realisedGain: 0, realisedLoss: 0, closed: false } });
    const g = groupBySecurity([empty], buildTransactionLines([empty]));
    expect(g).toHaveLength(1);
    expect(g[0]!.allLines).toHaveLength(0);
  });
  it("filters by type, security, date and broker without changing the matching data", () => {
    const sells = groupBySecurity([tst, xyz], lines, { ...NO_FILTERS, type: "SELL" });
    expect(sells.map((g) => g.lines.map((l) => l.id))).toEqual([["t2"], ["t4"]]);
    expect(sells[0]!.allLines).toHaveLength(2); // the sale can still be matched to its purchase
    expect(groupBySecurity([tst, xyz], lines, { ...NO_FILTERS, investmentId: "b" }).map((g) => g.id)).toEqual(["b"]);
    expect(filterLines(lines, { ...NO_FILTERS, from: "2026-02-01", to: "2026-03-01" }).map((l) => l.id).sort()).toEqual(["t2", "t3"]);
  });
  it("keeps transactions of different broker accounts apart, and finds those with none", () => {
    const mixed = lines.map((l) => (l.id === "t3" ? { ...l, brokerAccountId: "acc2" } : l));
    expect(filterLines(mixed, { ...NO_FILTERS, brokerAccountId: "acc1" }).map((l) => l.id).sort()).toEqual(["t1", "t2"]);
    expect(filterLines(mixed, { ...NO_FILTERS, brokerAccountId: "acc2" }).map((l) => l.id)).toEqual(["t3"]);
    expect(filterLines(mixed, { ...NO_FILTERS, brokerAccountId: NO_BROKER }).map((l) => l.id)).toEqual(["t4"]);
  });
});

describe("matching sales to purchases (average cost)", () => {
  it("matches a sale to the earlier purchases in its pool and shows the average cost it used", () => {
    const g = groupBySecurity([tst], lines)[0]!;
    const m = matchSale(g.allLines.find((l) => l.id === "t2")!, g.allLines);
    expect(m.buys.map((b) => b.id)).toEqual(["t1"]);
    expect(m.poolQuantity).toBe(100);
    expect(m.avgCost).toBeCloseTo(10.2, 5);
    expect(m.costOfSold).toBe(408);
    expect(m.netProceeds).toBe(590);
    expect(m.realised).toBe(182);
  });
  it("one purchase can be matched to several sales, and several purchases to one sale — nothing is double counted", () => {
    const multi = inv({
      id: "m",
      txs: [tx("m1", "BUY", "2026-01-01", 100, 40), tx("m2", "SELL", "2026-03-15", 40, 45), tx("m3", "BUY", "2026-04-20", 50, 42), tx("m4", "SELL", "2026-05-10", 30, 46)],
      rows: [
        row("m1", { seq: 0, totalValue: 4000, unitsAfter: 100 }),
        row("m2", { seq: 1, totalValue: 1800, unitsAfter: 60, realisedGainLoss: 200, poolQuantityBefore: 100, poolCostBefore: 4000, costOfSold: 1600 }),
        row("m3", { seq: 2, totalValue: 2100, unitsAfter: 110, poolQuantityBefore: 60, poolCostBefore: 2400 }),
        row("m4", { seq: 3, totalValue: 1380, unitsAfter: 80, realisedGainLoss: 1380 - (4500 / 110) * 30, poolQuantityBefore: 110, poolCostBefore: 4500, costOfSold: (4500 / 110) * 30 }),
      ],
    });
    const g = groupBySecurity([multi], buildTransactionLines([multi]))[0]!;
    const first = matchSale(g.allLines[1]!, g.allLines);
    const second = matchSale(g.allLines[3]!, g.allLines);
    expect(first.buys.map((b) => b.id)).toEqual(["m1"]);
    expect(second.buys.map((b) => b.id)).toEqual(["m1", "m3"]); // both purchases contribute to the second sale
    expect(second.poolQuantity).toBe(110); // the 40 units already sold are not counted again
    expect(second.avgCost).toBeCloseTo(4500 / 110, 5);
  });
  it("a purchase bought after the position was fully sold belongs to a new holding period and is not blended into old sales", () => {
    const re = inv({
      id: "r",
      txs: [tx("r1", "BUY", "2026-01-01", 10, 10), tx("r2", "SELL", "2026-02-01", 10, 12), tx("r3", "BUY", "2026-03-01", 5, 20), tx("r4", "SELL", "2026-04-01", 2, 25)],
      rows: [
        row("r1", { seq: 0, period: 1, totalValue: 100, unitsAfter: 10 }),
        row("r2", { seq: 1, period: 1, totalValue: 120, unitsAfter: 0, realisedGainLoss: 20, poolQuantityBefore: 10, poolCostBefore: 100, costOfSold: 100 }),
        row("r3", { seq: 2, period: 2, totalValue: 100, unitsAfter: 5 }),
        row("r4", { seq: 3, period: 2, totalValue: 50, unitsAfter: 3, realisedGainLoss: 10, poolQuantityBefore: 5, poolCostBefore: 100, costOfSold: 40 }),
      ],
    });
    const g = groupBySecurity([re], buildTransactionLines([re]))[0]!;
    expect(matchSale(g.allLines[1]!, g.allLines).buys.map((b) => b.id)).toEqual(["r1"]);
    expect(matchSale(g.allLines[3]!, g.allLines).buys.map((b) => b.id)).toEqual(["r3"]);
  });
  it("flags a sale of more than was held as an exception, without inventing a match", () => {
    const bad = inv({
      id: "x",
      txs: [tx("x1", "BUY", "2026-01-01", 10, 1), tx("x2", "SELL", "2026-02-01", 50, 1)],
      rows: [row("x1", { seq: 0, totalValue: 10, unitsAfter: 10 }), row("x2", { seq: 1, totalValue: 50, unitsAfter: -40, shortfall: true, poolQuantityBefore: 10, poolCostBefore: 10, costOfSold: 50, realisedGainLoss: 0 })],
    });
    const g = groupBySecurity([bad], buildTransactionLines([bad]))[0]!;
    expect(g.needsReview).toBe(true);
    expect(matchSale(g.allLines[1]!, g.allLines)).toMatchObject({ shortfall: true, poolQuantity: 10 });
  });
});

describe("what each security's heading shows", () => {
  it("shows units, average cost, cost basis, market value and unrealised P&L from the remaining cost basis and current price", () => {
    const m = groupMetricsOf(tst);
    expect(m.units).toBe(60);
    expect(m.avgCost).toBe(10);
    expect(m.costBase).toBe(600);
    expect(m.marketValue).toBe(720);
    expect(m.unrealised).toBe(120);
    expect(m.unrealisedPercent).toBeCloseTo(20, 5);
  });
  it("shows 0 units, no unrealised position and the realised result for a fully sold security", () => {
    const m = groupMetricsOf(xyz);
    expect(m.units).toBe(0);
    expect(m.closed).toBe(true);
    expect(m.unrealised).toBeNull();
    expect(m.realised).toBe(-50);
  });
  it("shows no unrealised figure when there is no market price — never a made-up one", () => {
    const m = groupMetricsOf(inv({ id: "n", marketPrice: null, txs: [tx("n1", "BUY", "2026-01-01", 60, 10)] }));
    expect(m.marketPrice).toBeNull();
    expect(m.marketValue).toBeNull();
    expect(m.unrealised).toBeNull();
    expect(m.priceBasis).toBe("none");
  });
});

describe("broker accounts", () => {
  it("are labelled Broker — Account (login e-mail), and accounts at one broker stay distinct", () => {
    expect(brokerLabel(accounts[0]!)).toBe("CommSec — Joint (joint@example.com)");
    expect(brokerLabel(accounts[0]!)).not.toBe(brokerLabel(accounts[1]!));
  });
  it("a sale defaults to the account the holding was last bought through; older holdings have none", () => {
    const h = inv({ id: "h", txs: [tx("1", "BUY", "2026-01-01", 10, 1, 0, "acc1"), tx("2", "BUY", "2026-02-01", 10, 1, 0, "acc2"), tx("3", "SELL", "2026-03-01", 5, 1, 0, "acc1")] });
    expect(holdingBrokerAccountId(h)).toBe("acc2");
    expect(holdingBrokerAccountId(xyz)).toBeNull();
  });
});

const render = (ui: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{ui}</MemoryRouter>);
const table = (o: { investments?: Investment[] } = {}) => {
  const investments = o.investments ?? [tst, xyz];
  return render(<TransactionsTable investments={investments} lines={buildTransactionLines(investments)} accounts={accounts} onSell={() => {}} onEdit={() => {}} />);
};

describe("the one grouped, editable table", () => {
  const html = table();
  it("is a single table: no separate 'Aus Equities' table, and one 'All transactions' heading", () => {
    expect(html).not.toContain("Aus Equities");
    expect(html.match(/All transactions/g)).toHaveLength(1);
  });
  it("groups under a heading per security with its status and transaction count", () => {
    expect(html).toContain("TST");
    expect(html).toContain("XYZ");
    expect(html).toContain("Open · 60 units");
    expect(html).toContain("Position closed · 0 units");
    expect(html).toContain("2 transactions");
  });
  it("has an Edit action for every transaction", () => {
    for (const label of ["Edit buy of TST on 5 Jan 2026", "Edit sell of TST on 1 Mar 2026", "Edit buy of XYZ on 1 Feb 2026", "Edit sell of XYZ on 1 Apr 2026"]) expect(html).toContain(`aria-label="${label}"`);
  });
  it("no longer shows the sale details panel under each sale", () => {
    expect(html).not.toContain('data-testid="sale-match"');
    expect(html).not.toContain("Purchases this sale draws on");
    expect(html).not.toContain("Average-cost method");
    expect(html).not.toContain("Show how each sale was calculated");
  });
  it("keeps the security metric values but not a visible header row of labels", () => {
    expect(html).not.toMatch(/<dt class="text-\[11px\]/);
    expect(html).toContain("Available units");
    expect(html).toMatch(/<dt class="sr-only">Available units<\/dt>/);
  });
  it("shows realised profit green and realised loss red", () => {
    expect(html).toContain("+$182");
    expect(html).toContain("-$50");
    expect(html).toMatch(/data-tone="profit"/);
    expect(html).toMatch(/data-tone="loss"/);
  });
  it("offers Sell for a security with units, and not for a closed position", () => {
    const button = html.match(/<button[^>]*aria-label="Sell TST"[^>]*>/)![0];
    expect(button).not.toContain('disabled=""');
    expect(html).not.toContain('aria-label="Sell XYZ"');
  });
  it("disables Sell when a holding can't be sold", () => {
    const stuck = inv({ id: "s", ticker: "STK", sellable: { canSell: false, availableQuantity: 0, reason: "No units left to sell." }, txs: [tx("s1", "BUY", "2026-01-01", 10, 1)] });
    expect(table({ investments: [stuck] }).match(/<button[^>]*aria-label="Sell STK"[^>]*>/)![0]).toContain('disabled=""');
  });
  it("shows 'Price unavailable' rather than a value when a holding has no price", () => {
    expect(table({ investments: [inv({ id: "n", marketPrice: null, txs: [tx("n1", "BUY", "2026-01-01", 60, 10)] })] })).toContain("Price unavailable");
  });
  it("shows the broker account on trades and 'Not recorded' on older ones", () => {
    expect(html).toContain("CommSec — Joint");
    expect(html).toContain("Not recorded");
  });
  it("marks a sale that needs review", () => {
    const bad = inv({ id: "x", ticker: "BAD", txs: [tx("x1", "BUY", "2026-01-01", 10, 1), tx("x2", "SELL", "2026-02-01", 50, 1)], rows: [row("x1", { seq: 0, totalValue: 10, unitsAfter: 10 }), row("x2", { seq: 1, totalValue: 50, shortfall: true, poolQuantityBefore: 10 })] });
    const out = table({ investments: [bad] });
    expect(out).toContain("Needs review");
  });
  it("has a helpful empty state", () => {
    expect(table({ investments: [] })).toContain("No shares or ETFs yet");
  });
  it("tells buys and sells apart without green or red", () => {
    for (const t of ["BUY", "SELL"] as const) {
      const badge = renderToStaticMarkup(<TypeBadge type={t} />);
      expect(badge).not.toContain("eucalyptus");
      expect(badge).not.toContain("brick");
    }
  });
  it("shows a neutral dash for a purchase's realised P&L", () => {
    const buy = renderToStaticMarkup(<RealisedCell line={{ type: "BUY", realisedGainLoss: null, currency: "AUD" }} />);
    expect(buy).toContain("—");
    expect(buy).not.toContain("eucalyptus");
  });
});

describe("editing a transaction", () => {
  const ok = { investmentId: "a", date: "2026-03-01", quantity: "40", price: "15", brokerage: "10" };
  it("accepts a valid correction", () => {
    expect(validateTransactionEdit(ok)).toEqual({});
  });
  it.each([
    [{ ...ok, quantity: "0" }, "quantity", "greater than zero"],
    [{ ...ok, quantity: "-5" }, "quantity", "greater than zero"],
    [{ ...ok, quantity: "" }, "quantity", "number of units"],
    [{ ...ok, quantity: "abc" }, "quantity", "number of units"],
    [{ ...ok, price: "0" }, "price", "greater than zero"],
    [{ ...ok, price: "" }, "price", "price per unit"],
    [{ ...ok, brokerage: "-1" }, "brokerage", "can't be negative"],
    [{ ...ok, brokerage: "x" }, "brokerage", "as a number"],
    [{ ...ok, date: "" }, "date", "valid date"],
    [{ ...ok, date: "2026-13-45" }, "date", "valid date"],
    [{ ...ok, investmentId: "" }, "security", "choose a security"],
  ])("rejects bad input %#", (input, field, text) => {
    expect((validateTransactionEdit(input) as Record<string, string>)[field]).toContain(text);
  });
  it("treats an empty brokerage as zero", () => {
    expect(validateTransactionEdit({ ...ok, brokerage: "" })).toEqual({});
  });

  const line = lines.find((l) => l.id === "t2")!;
  const dialog = render(<EditTransactionDialog line={line} securities={[{ id: "a", label: "TST — Test Co", currency: "AUD" }, { id: "b", label: "XYZ — Xyz Ltd", currency: "AUD" }]} onSaved={() => {}} onDeleted={() => {}} onClose={() => {}} />);
  it("opens pre-filled with every editable field, and Save/Cancel", () => {
    for (const id of ["et-security", "et-date", "et-type", "et-qty", "et-price", "et-fees", "et-broker"]) expect(dialog).toContain(`id="${id}"`);
    expect(dialog).toContain('value="2026-03-01"');
    expect(dialog).toContain('value="40"');
    expect(dialog).toContain('value="15"');
    expect(dialog).toContain("Cancel");
    expect(dialog).toContain("Save changes");
  });
  it("offers Delete transaction, and only asks to confirm after it is clicked (nothing is deleted from the form itself)", () => {
    expect(dialog).toContain("Delete transaction");
    expect(dialog).not.toContain("Yes, delete it");
    expect(dialog.match(/<button[^>]*>\s*Delete transaction\s*<\/button>/)![0]).toContain('type="button"');
  });
  it("starts with Save disabled until something is changed (no accidental no-op saves)", () => {
    expect(dialog.match(/<button[^>]*type="submit"[^>]*>/)![0]).toContain('disabled=""');
  });
  it("previews the recalculated total: net proceeds for a sale", () => {
    expect(dialog).toContain("Net proceeds (after brokerage)");
    expect(dialog).toContain("$590");
  });
});
