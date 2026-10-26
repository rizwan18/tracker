import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { BrokerAccount, Investment } from "../api/types";
import { HoldingsTable } from "../components/HoldingsTable";
import { RealisedCell, TransactionsTable, TypeBadge } from "../components/TransactionsTable";
import { brokerLabel, holdingBrokerAccountId } from "../lib/brokers";
import { DEFAULT_SORT, NO_BROKER, NO_FILTERS, buildTransactionLines, filterLines, sortLines, type TransactionLine } from "../lib/transactions";

type Tx = Investment["investmentTransactions"][number];
const tx = (id: string, type: "BUY" | "SELL", date: string, quantity: number, pricePerUnit: number, brokerage = 0, brokerAccountId: string | null = null): Tx =>
  ({ id, type, date: `${date}T00:00:00.000Z`, createdAt: `${date}T01:00:00.000Z`, quantity, pricePerUnit, brokerage, notes: null, brokerAccountId }) as Tx;

function inv(o: Partial<Investment> & { id: string; txs: Tx[]; rows?: Investment["transactionRows"] }): Investment {
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

// TST: bought 100 @ $10 (+$20), sold 40 @ $15 (−$10) → profit. XYZ: bought 50 @ $4, sold all 50 @ $3 → loss.
const tst = inv({
  id: "a",
  txs: [tx("t1", "BUY", "2026-01-05", 100, 10, 20, "acc1"), tx("t2", "SELL", "2026-03-01", 40, 15, 10, "acc1")],
  rows: [
    { id: "t1", totalValue: 1020, unitsAfter: 100, realisedGainLoss: null },
    { id: "t2", totalValue: 590, unitsAfter: 60, realisedGainLoss: 182 },
  ],
});
const xyz = inv({
  id: "b",
  name: "Xyz Ltd",
  ticker: "XYZ",
  txs: [tx("t3", "BUY", "2026-02-01", 50, 4), tx("t4", "SELL", "2026-04-01", 50, 3)],
  rows: [
    { id: "t3", totalValue: 200, unitsAfter: 50, realisedGainLoss: null },
    { id: "t4", totalValue: 150, unitsAfter: 0, realisedGainLoss: -50 },
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

describe("building the unified list", () => {
  it("puts buys and sells of every security in one list with the server's totals, units after and realised P&L", () => {
    expect(lines).toHaveLength(4);
    const sell = lines.find((l) => l.id === "t2")!;
    expect(sell).toMatchObject({ type: "SELL", totalValue: 590, unitsAfter: 60, realisedGainLoss: 182, ticker: "TST" });
    const buy = lines.find((l) => l.id === "t1")!;
    expect(buy).toMatchObject({ type: "BUY", totalValue: 1020, unitsAfter: 100, realisedGainLoss: null });
  });
  it("ignores crypto and other non-share investments", () => {
    expect(buildTransactionLines([inv({ id: "c", type: "CRYPTO", txs: [tx("c1", "BUY", "2026-01-01", 1, 1)] })])).toHaveLength(0);
  });
  it("still works when the server sent no derived rows (falls back to price × units ± brokerage)", () => {
    const l = buildTransactionLines([inv({ id: "z", txs: [tx("z1", "BUY", "2026-01-01", 10, 2, 5), tx("z2", "SELL", "2026-02-01", 5, 3, 5)] })]);
    expect(l.find((x) => x.id === "z1")!.totalValue).toBe(25);
    expect(l.find((x) => x.id === "z2")!.totalValue).toBe(10);
    expect(l.find((x) => x.id === "z2")!.unitsAfter).toBeNull();
  });
  it("uses US$ for Wall St holdings", () => {
    const us = buildTransactionLines([inv({ id: "u", market: "WALL_ST", currency: "USD", txs: [tx("u1", "BUY", "2026-01-01", 1, 1)] })]);
    expect(us[0]!.currency).toBe("USD");
  });
});

describe("sorting and filtering", () => {
  it("is latest first by default", () => {
    expect(sortLines(lines, DEFAULT_SORT).map((l) => l.id)).toEqual(["t4", "t2", "t3", "t1"]);
  });
  it("shows a sale ahead of a purchase made the same day (it happened later in the day's ledger)", () => {
    const same = [...lines, ...buildTransactionLines([inv({ id: "d", ticker: "DDD", txs: [tx("d1", "BUY", "2026-04-01", 5, 1), tx("d2", "SELL", "2026-04-01", 1, 1)] })])];
    const ids = sortLines(same, DEFAULT_SORT).map((l) => l.id);
    expect(ids.indexOf("d2")).toBeLessThan(ids.indexOf("d1"));
  });
  it("can be sorted oldest first", () => {
    expect(sortLines(lines, { key: "date", dir: "asc" }).map((l) => l.id)).toEqual(["t1", "t3", "t2", "t4"]);
  });
  it("sorts by realised P&L with purchases always last", () => {
    expect(sortLines(lines, { key: "realised", dir: "desc" }).map((l) => l.id).slice(0, 2)).toEqual(["t2", "t4"]);
    expect(sortLines(lines, { key: "realised", dir: "asc" }).map((l) => l.id).slice(0, 2)).toEqual(["t4", "t2"]);
  });
  it("filters by security, type and date range", () => {
    expect(filterLines(lines, { ...NO_FILTERS, investmentId: "b" }).map((l) => l.id).sort()).toEqual(["t3", "t4"]);
    expect(filterLines(lines, { ...NO_FILTERS, type: "SELL" }).map((l) => l.id).sort()).toEqual(["t2", "t4"]);
    expect(filterLines(lines, { ...NO_FILTERS, from: "2026-02-01", to: "2026-03-01" }).map((l) => l.id).sort()).toEqual(["t2", "t3"]);
  });
  it("keeps transactions of different broker accounts separate, and finds those with none", () => {
    const mixed: TransactionLine[] = lines.map((l) => (l.id === "t3" ? { ...l, brokerAccountId: "acc2" } : l));
    expect(filterLines(mixed, { ...NO_FILTERS, brokerAccountId: "acc1" }).map((l) => l.id).sort()).toEqual(["t1", "t2"]);
    expect(filterLines(mixed, { ...NO_FILTERS, brokerAccountId: "acc2" }).map((l) => l.id)).toEqual(["t3"]);
    expect(filterLines(mixed, { ...NO_FILTERS, brokerAccountId: NO_BROKER }).map((l) => l.id)).toEqual(["t4"]);
  });
});

describe("broker accounts", () => {
  it("are labelled Broker — Account (login e-mail)", () => {
    expect(brokerLabel(accounts[0]!)).toBe("CommSec — Joint (joint@example.com)");
  });
  it("two accounts at the same broker are distinct", () => {
    expect(brokerLabel(accounts[0]!)).not.toBe(brokerLabel(accounts[1]!));
  });
  it("a sale defaults to the account the holding was last bought through", () => {
    const h = inv({ id: "h", txs: [tx("1", "BUY", "2026-01-01", 10, 1, 0, "acc1"), tx("2", "BUY", "2026-02-01", 10, 1, 0, "acc2"), tx("3", "SELL", "2026-03-01", 5, 1, 0, "acc1")] });
    expect(holdingBrokerAccountId(h)).toBe("acc2");
  });
  it("is null for an older holding with no account recorded, and the transaction still works", () => {
    expect(holdingBrokerAccountId(xyz)).toBeNull();
    expect(lines.filter((l) => l.investmentId === "b").every((l) => l.brokerAccountId === null)).toBe(true);
  });
  it("trades keep their account by id, so editing the account's details changes the label but not the link", () => {
    const edited = accounts.map((a) => (a.id === "acc1" ? { ...a, accountName: "Renamed", loginEmail: "new@example.com" } : a));
    const html = renderToStaticMarkup(<MemoryRouter><TransactionsTable lines={lines} accounts={edited} securities={[]} /></MemoryRouter>);
    expect(html).toContain("CommSec — Renamed");
    expect(html).not.toContain("CommSec — Joint");
    expect(lines.find((l) => l.id === "t1")!.brokerAccountId).toBe("acc1");
  });
});

const render = (ui: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{ui}</MemoryRouter>);

describe("TransactionsTable", () => {
  it("shows realised profit in green with a plus and realised loss in red with a minus", () => {
    const profit = renderToStaticMarkup(<RealisedCell line={{ type: "SELL", realisedGainLoss: 182, currency: "AUD" }} />);
    expect(profit).toContain("text-[var(--color-eucalyptus)]");
    expect(profit).toContain("+$182");
    const loss = renderToStaticMarkup(<RealisedCell line={{ type: "SELL", realisedGainLoss: -50, currency: "AUD" }} />);
    expect(loss).toContain("text-[var(--color-brick)]");
    expect(loss).toContain("-$50");
  });
  it("shows a neutral dash for a purchase, and neutral $0 for a break-even sale", () => {
    const buy = renderToStaticMarkup(<RealisedCell line={{ type: "BUY", realisedGainLoss: null, currency: "AUD" }} />);
    expect(buy).toContain("—");
    expect(buy).not.toContain("eucalyptus");
    expect(buy).not.toContain("brick");
    const flat = renderToStaticMarkup(<RealisedCell line={{ type: "SELL", realisedGainLoss: 0, currency: "AUD" }} />);
    expect(flat).not.toContain("eucalyptus");
    expect(flat).not.toContain("brick");
  });
  it("tells buys and sells apart without using green or red", () => {
    expect(renderToStaticMarkup(<TypeBadge type="BUY" />)).toContain("Buy");
    expect(renderToStaticMarkup(<TypeBadge type="SELL" />)).toContain("Sell");
    for (const t of ["BUY", "SELL"] as const) {
      const html = renderToStaticMarkup(<TypeBadge type={t} />);
      expect(html).not.toContain("eucalyptus");
      expect(html).not.toContain("brick");
    }
  });
  it("lists buys and sells together with every requested column and the broker account", () => {
    const html = render(<TransactionsTable lines={lines} accounts={accounts} securities={[{ id: "a", label: "TST" }]} />);
    for (const heading of ["Date", "Security", "Broker account", "Type", "Units", "Price", "Brokerage", "Total value", "Realised P&amp;L", "Units after"]) expect(html).toContain(heading);
    expect(html).toContain("CommSec — Joint");
    expect(html).toContain("Not recorded"); // XYZ's trades predate broker accounts
    expect(html).toContain("4 transactions");
  });
  it("explains the totals: cost incl. brokerage for buys, net proceeds for sells", () => {
    const html = render(<TransactionsTable lines={lines} accounts={accounts} securities={[]} />);
    expect(html).toContain("Total cost, including brokerage");
    expect(html).toContain("Net proceeds, after brokerage");
  });
  it("has a helpful empty state", () => {
    expect(render(<TransactionsTable lines={[]} accounts={[]} securities={[]} />)).toContain("No buy or sell transactions yet");
  });
});

describe("HoldingsTable — available units and the Sell button", () => {
  const html = render(<HoldingsTable market="ASX" holdings={[tst, xyz]} onSell={() => {}} accounts={accounts} />);

  it("labels the units column 'Available units' and shows the units still held", () => {
    expect(html).toContain("Available units");
    expect(html).toContain(">60<");
  });
  it("shows 0 available units for a fully sold security, marks the position closed and keeps its realised result visible", () => {
    expect(html).toContain(">0<");
    expect(html).toContain("Position closed");
    expect(html).toContain("-$50"); // realised loss, in red
  });
  it("offers an enabled Sell button for a holding with units, and none for a closed position", () => {
    const button = html.match(/<button[^>]*aria-label="Sell TST"[^>]*>/)![0];
    expect(button).not.toContain('disabled=""');
    expect(html).not.toContain('aria-label="Sell XYZ"');
  });
  it("disables Sell for a holding that can't be sold", () => {
    const stuck = inv({ id: "s", ticker: "STK", sellable: { canSell: false, availableQuantity: 0, reason: "No units left to sell." }, txs: [tx("s1", "BUY", "2026-01-01", 10, 1)] });
    const button = render(<HoldingsTable market="ASX" holdings={[stuck]} onSell={() => {}} />).match(/<button[^>]*aria-label="Sell STK"[^>]*>/)![0];
    expect(button).toContain('disabled=""');
  });
  it("shows no unrealised figure for the closed position, and the open one is green with its percentage", () => {
    expect(html).toContain("+$120"); // 60 × $12 − $600
    expect(html).toContain("+20.00%");
  });
  it("shows the broker account under a holding that has one", () => {
    expect(html).toContain("CommSec — Joint");
  });
});
