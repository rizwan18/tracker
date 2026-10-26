import { describe, it, expect } from "vitest";
import type { Investment } from "../api/types";
import { formatPnl, formatReturn, resolveMarketPosition, returnPercent, summarisePnl, toneOf } from "../lib/pnl";

type Over = Partial<Omit<Investment, "summary">> & { summary?: Partial<Investment["summary"]>; sells?: number };

/** A share holding as GET /investments returns it. `summary` mirrors the backend's average-cost replay. */
function stock(o: Over = {}): Investment {
  const { summary, sells = 0, ...rest } = o;
  return {
    id: "x",
    name: "Test Co",
    ticker: "TST",
    type: "SHARE",
    notes: null,
    currentValueOverride: null,
    market: "ASX",
    currency: "AUD",
    marketPrice: null,
    marketPriceUpdatedAt: null,
    investmentTransactions: Array.from({ length: sells }, (_, i) => ({ id: `s${i}`, type: "SELL" })) as unknown as Investment["investmentTransactions"],
    dividends: [],
    totalDividends: 0,
    holding: null,
    summary: { quantity: 0, costBase: 0, costBaseKnown: true, currentValue: 0, unrealisedGainLoss: 0, realisedGain: 0, realisedLoss: 0, realisedCostBase: 0, closed: false, ...summary },
    ...rest,
  } as Investment;
}

describe("unrealised P&L", () => {
  it("is a profit when the live price is above the cost base (brokerage included in the cost)", () => {
    // 100 units, cost base $1,020 (incl. $20 brokerage), live price $12 → value $1,200 → +$180 (17.65%).
    const pnl = summarisePnl([stock({ marketPrice: 12, summary: { quantity: 100, costBase: 1020 } })]);
    expect(pnl.unrealised.AUD.amount).toBeCloseTo(180, 5);
    expect(returnPercent(pnl.unrealised.AUD)).toBeCloseTo(17.647, 2);
    expect(toneOf(pnl.unrealised.AUD.amount)).toBe("positive");
  });

  it("is a loss when the live price is below the cost base", () => {
    const pnl = summarisePnl([stock({ marketPrice: 8, summary: { quantity: 100, costBase: 1020 } })]);
    expect(pnl.unrealised.AUD.amount).toBeCloseTo(-220, 5);
    expect(toneOf(pnl.unrealised.AUD.amount)).toBe("negative");
    expect(formatPnl(pnl.unrealised.AUD.amount, "AUD")).toBe("-$220");
  });

  it("uses the units and cost left after a partial sale (multiple buys, then a sale)", () => {
    // Bought 100 @ $10 and 50 @ $12 (+$15) = cost $1,615 for 150 units ($10.7667 each). Sold 60 → 90 left, cost $969.
    const pnl = summarisePnl([stock({ marketPrice: 11, sells: 1, summary: { quantity: 90, costBase: 969 } })]);
    expect(pnl.unrealised.AUD.amount).toBeCloseTo(90 * 11 - 969, 5); // +21
    expect(pnl.unrealised.AUD.costBase).toBe(969);
  });

  it("shows nothing for a fully sold holding, so its gain is never counted twice", () => {
    const closed = stock({ marketPrice: 50, sells: 1, summary: { quantity: 0, costBase: 0, closed: true, realisedGain: 490, realisedCostBase: 1000 } });
    const pnl = summarisePnl([closed]);
    expect(pnl.unrealised.AUD.holdings).toBe(0);
    expect(pnl.unrealised.AUD.amount).toBe(0);
    expect(pnl.realised.AUD.amount).toBe(490);
  });

  it("does not treat a missing price as $0: the holding is left out and counted as awaiting a price", () => {
    const pnl = summarisePnl([stock({ summary: { quantity: 100, costBase: 1000 } })]);
    expect(pnl.awaitingPrice).toBe(1);
    expect(pnl.unrealised.AUD.holdings).toBe(0);
    expect(pnl.unrealised.AUD.amount).toBe(0); // not −$1,000
  });

  it("rejects a zero or invalid price the same way", () => {
    expect(summarisePnl([stock({ marketPrice: 0, summary: { quantity: 10, costBase: 100 } })]).awaitingPrice).toBe(1);
    expect(summarisePnl([stock({ marketPrice: NaN, summary: { quantity: 10, costBase: 100 } })]).awaitingPrice).toBe(1);
  });

  it("falls back to the last recorded valuation price, and says it is not a refreshed price", () => {
    const h = { asAt: "2026-06-30", units: 100, marketPrice: 11, marketValue: 1100, marketValueAud: 1100, currency: "AUD", source: "MANUAL", weightingPercent: 0, currentMarketPrice: null, currentMarketValue: null, unrealisedGainLoss: null } as Investment["holding"];
    const inv = stock({ holding: h, summary: { quantity: 100, costBase: 1000 } });
    expect(resolveMarketPosition(inv).priceBasis).toBe("recorded");
    const pnl = summarisePnl([inv]);
    expect(pnl.unrealised.AUD.amount).toBeCloseTo(100, 5);
    expect(pnl.recordedPriceOnly).toBe(1);
  });

  it("prefers a live price over a recorded one", () => {
    const h = { asAt: "2026-06-30", units: 100, marketPrice: 11 } as Investment["holding"];
    const pos = resolveMarketPosition(stock({ holding: h, marketPrice: 13, marketPriceUpdatedAt: "2026-10-26T01:00:00Z", summary: { quantity: 100, costBase: 1000 } }));
    expect(pos.priceBasis).toBe("live");
    expect(pos.marketValue).toBe(1300);
  });

  it("leaves out a holding with no buy history (no cost to compare against)", () => {
    // No trades at all: only a recorded holding (e.g. a broker statement) says there are 100 units, so there's nothing to measure a gain against.
    const h = { asAt: "2026-06-30", units: 100, marketPrice: 11 } as Investment["holding"];
    const pnl = summarisePnl([stock({ marketPrice: 12, holding: h, summary: { quantity: 0, costBase: 0, costBaseKnown: false } })]);
    expect(pnl.noCostBase).toBe(1);
    expect(pnl.unrealised.AUD.holdings).toBe(0);
  });

  it("ignores a position with zero units", () => {
    const pnl = summarisePnl([stock({ marketPrice: 12, summary: { quantity: 0, costBase: 0 } })]);
    expect(pnl.unrealised.AUD.holdings).toBe(0);
    expect(pnl.awaitingPrice).toBe(0);
  });
});

describe("available units come from the transaction history", () => {
  it("uses the units from the buy/sell history, not a hand-kept units field that disagrees", () => {
    const h = { asAt: "2026-06-30", units: 500, marketPrice: 11 } as Investment["holding"];
    const pos = resolveMarketPosition(stock({ holding: h, marketPrice: 12, summary: { quantity: 60, costBase: 600 } }));
    expect(pos.units).toBe(60);
    expect(pos.marketValue).toBe(720);
  });
  it("shows no active position (no units, no value) once the history nets to zero", () => {
    const pos = resolveMarketPosition(stock({ marketPrice: 12, sells: 1, summary: { quantity: 0, costBase: 0, closed: true } }));
    expect(pos.units).toBeNull();
    expect(pos.marketValue).toBeNull();
  });
  it("a security bought again after being fully sold has its new units and a fresh cost base", () => {
    const pnl = summarisePnl([stock({ marketPrice: 35, sells: 1, summary: { quantity: 20, costBase: 600, closed: false, realisedGain: 20, realisedCostBase: 100 } })]);
    expect(pnl.unrealised.AUD.amount).toBe(100); // 20 × $35 − $600, none of the earlier realised gain
    expect(pnl.realised.AUD.amount).toBe(20);
  });
});

describe("realised P&L", () => {
  it("reports a profitable sale as gain on the cost of the units sold, not on proceeds", () => {
    // Sold 40 @ $15 from cost $10.20/unit: proceeds $600, cost $408, gain $192 → 47.06% on cost sold.
    const pnl = summarisePnl([stock({ marketPrice: 15, sells: 1, summary: { quantity: 60, costBase: 612, realisedGain: 192, realisedCostBase: 408 } })]);
    expect(pnl.realised.AUD.amount).toBe(192);
    expect(returnPercent(pnl.realised.AUD)).toBeCloseTo(47.059, 2);
  });

  it("reports a loss-making sale as negative", () => {
    const pnl = summarisePnl([stock({ sells: 1, summary: { closed: true, realisedLoss: 100, realisedCostBase: 1000 } })]);
    expect(pnl.realised.AUD.amount).toBe(-100);
    expect(returnPercent(pnl.realised.AUD)).toBeCloseTo(-10, 5);
    expect(formatPnl(pnl.realised.AUD.amount, "AUD")).toBe("-$100");
  });

  it("nets gains and losses across several holdings", () => {
    const a = stock({ id: "a", sells: 1, summary: { closed: true, realisedGain: 500, realisedCostBase: 1000 } });
    const b = stock({ id: "b", sells: 2, summary: { realisedGain: 100, realisedLoss: 350, realisedCostBase: 2000, quantity: 5, costBase: 50 }, marketPrice: 10 });
    const pnl = summarisePnl([a, b]);
    expect(pnl.realised.AUD.amount).toBe(250);
    expect(pnl.realised.AUD.costBase).toBe(3000);
    expect(pnl.realised.AUD.holdings).toBe(2);
  });

  it("is zero, with no percentage, when nothing has been sold (no divide by zero)", () => {
    const pnl = summarisePnl([stock({ marketPrice: 12, summary: { quantity: 100, costBase: 1000 } })]);
    expect(pnl.realised.AUD.amount).toBe(0);
    expect(returnPercent(pnl.realised.AUD)).toBeNull();
    expect(toneOf(0)).toBe("neutral");
  });

  it("does not count a realised gain again as unrealised (same holding, partly sold)", () => {
    const inv = stock({ marketPrice: 12, sells: 1, summary: { quantity: 60, costBase: 600, realisedGain: 200, realisedCostBase: 400 } });
    const pnl = summarisePnl([inv]);
    expect(pnl.realised.AUD.amount).toBe(200);
    expect(pnl.unrealised.AUD.amount).toBeCloseTo(60 * 12 - 600, 5); // +120: only the units still held
  });
});

describe("aggregation", () => {
  it("returns zeros for an empty portfolio", () => {
    const pnl = summarisePnl([]);
    expect(pnl.realised.AUD.amount).toBe(0);
    expect(pnl.unrealised.USD.amount).toBe(0);
    expect(pnl.awaitingPrice + pnl.noCostBase + pnl.recordedPriceOnly).toBe(0);
  });

  it("keeps A$ and US$ holdings apart instead of adding them together", () => {
    const asx = stock({ id: "a", marketPrice: 12, summary: { quantity: 100, costBase: 1000 } });
    const us = stock({ id: "u", market: "WALL_ST", currency: "USD", marketPrice: 200, summary: { quantity: 10, costBase: 1500 } });
    const pnl = summarisePnl([asx, us]);
    expect(pnl.unrealised.AUD.amount).toBe(200);
    expect(pnl.unrealised.USD.amount).toBe(500);
    expect(formatPnl(500, "USD")).toBe("+US$500.00");
  });

  it("sums several open holdings, and only counts shares/ETFs/LICs", () => {
    const a = stock({ id: "a", marketPrice: 12, summary: { quantity: 100, costBase: 1000 } });
    const b = stock({ id: "b", type: "ETF", marketPrice: 9, summary: { quantity: 100, costBase: 1000 } });
    const crypto = stock({ id: "c", type: "CRYPTO", marketPrice: 1, summary: { quantity: 1, costBase: 1000 } });
    const pnl = summarisePnl([a, b, crypto]);
    expect(pnl.unrealised.AUD.amount).toBe(100); // +200 − 100; crypto ignored
    expect(pnl.unrealised.AUD.costBase).toBe(2000);
  });

  it("agrees with the holdings table's per-row unrealised figure for the same data", () => {
    const inv = stock({ marketPrice: 12.345, summary: { quantity: 37, costBase: 410.5 } });
    const pos = resolveMarketPosition(inv);
    expect(summarisePnl([inv]).unrealised.AUD.amount).toBeCloseTo(pos.marketValue! - 410.5, 8);
  });
});

describe("formatting", () => {
  it("never shows float dust as a loss", () => {
    expect(toneOf(-0.0000001)).toBe("neutral");
    expect(formatPnl(-0.0000001, "AUD")).toBe("$0");
  });
  it("formats returns with an explicit sign", () => {
    expect(formatReturn(12.3456)).toBe("+12.35%");
    expect(formatReturn(-3)).toBe("-3.00%");
    expect(formatReturn(0)).toBe("0.00%");
  });
});
