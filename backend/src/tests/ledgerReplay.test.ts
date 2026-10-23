import { describe, it, expect } from "vitest";
import { computeHoldingSummary, replayLedger, sellabilityOf, compareLedger, type LedgerTx } from "../services/holdings";

const day = (n: number) => new Date(Date.UTC(2025, 0, 1 + n));
const buy = (n: number, quantity: number, pricePerUnit: number, brokerage = 0, extra: Partial<LedgerTx> = {}): LedgerTx => ({ type: "BUY", date: day(n), quantity, pricePerUnit, brokerage, ...extra });
const sell = (n: number, quantity: number, pricePerUnit: number, brokerage = 0, extra: Partial<LedgerTx> = {}): LedgerTx => ({ type: "SELL", date: day(n), quantity, pricePerUnit, brokerage, ...extra });

/** The calculation exactly as it was written inline (in four places) before the shared replay — the reference for equivalence. */
function legacy(txs: LedgerTx[]) {
  let qty = 0, cost = 0, gain = 0, loss = 0;
  const sales: number[] = [];
  for (const tx of [...txs].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    if (tx.type === "BUY") {
      qty += tx.quantity;
      cost += tx.quantity * tx.pricePerUnit + tx.brokerage;
    } else {
      const avg = qty > 0 ? cost / qty : 0;
      const costOfSold = avg * tx.quantity;
      const g = tx.quantity * tx.pricePerUnit - tx.brokerage - costOfSold;
      sales.push(g);
      if (g >= 0) gain += g; else loss += -g;
      qty -= tx.quantity;
      cost -= costOfSold;
    }
  }
  return { qty, cost, gain, loss, sales };
}

// Small deterministic PRNG so a failure is reproducible.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe("replayLedger reproduces the previous (legacy) calculation for existing data", () => {
  it("matches on 500 random ledgers of buys and sells on distinct days", () => {
    const rand = rng(42);
    for (let run = 0; run < 500; run++) {
      const txs: LedgerTx[] = [];
      let held = 0;
      const steps = 1 + Math.floor(rand() * 8);
      for (let i = 0; i < steps; i++) {
        const price = Math.round(rand() * 20000) / 100 + 0.01;
        const fee = Math.round(rand() * 2500) / 100;
        if (held <= 0 || rand() < 0.55) {
          const q = Math.round(rand() * 500 * 100) / 100 + 0.01;
          txs.push(buy(i, q, price, fee));
          held += q;
        } else {
          const q = Math.round(rand() * held * 100) / 100;
          if (q <= 0) continue;
          txs.push(sell(i, q, price, fee));
          held -= q;
        }
      }
      const want = legacy(txs);
      const got = replayLedger(txs);
      expect(got.quantity).toBeCloseTo(want.qty, 6);
      expect(got.costBase).toBeCloseTo(want.cost, 6);
      expect(got.sales.map((s) => s.gainLoss).length).toBe(want.sales.length);
      got.sales.forEach((s, i) => expect(s.gainLoss).toBeCloseTo(want.sales[i]!, 6));
      const summary = computeHoldingSummary(txs, null, null);
      expect(summary.realisedGain).toBeCloseTo(want.gain, 6);
      expect(summary.realisedLoss).toBeCloseTo(want.loss, 6);
    }
  });

  it("is independent of the order the database returns rows in", () => {
    const txs = [buy(0, 100, 10), buy(5, 50, 12), sell(9, 70, 15, 5), sell(12, 30, 11)];
    const a = replayLedger(txs);
    const b = replayLedger([...txs].reverse());
    expect(b.costBase).toBe(a.costBase);
    expect(b.quantity).toBe(a.quantity);
  });

  it("on the same day a buy is applied before a sell, whatever order the rows arrive in", () => {
    const txs = [sell(3, 10, 12), buy(3, 10, 10)];
    expect(replayLedger(txs).sales[0]!.costOfSold).toBe(100);
    expect([...txs].sort(compareLedger).map((t) => t.type)).toEqual(["BUY", "SELL"]);
  });
});

describe("sales recorded with the Sell action are frozen", () => {
  const recorded = (n: number, q: number, price: number, fees: number, costCents: number): LedgerTx => {
    const gross = Math.round(q * price * 100);
    const net = gross - Math.round(fees * 100);
    return sell(n, q, price, fees, { grossProceedsCents: gross, netProceedsCents: net, costBaseCents: costCents, gainLossCents: net - costCents });
  };

  it("uses the stored figures, not a recalculation", () => {
    // The stored allocation ($400) deliberately differs from what average cost would now give ($500) to prove it is used as-is.
    const r = replayLedger([buy(0, 100, 10), recorded(5, 50, 12, 0, 40000)]);
    expect(r.sales[0]!.costOfSold).toBe(400);
    expect(r.sales[0]!.gainLoss).toBe(200);
    expect(r.costBase).toBe(600); // 1000 − 400 stays with the 50 units still held
  });

  it("a recorded sale's gain/loss does not change when a purchase is later edited", () => {
    const sale = recorded(5, 50, 12, 10, 50000);
    const before = replayLedger([buy(0, 100, 10), sale]).sales[0]!.gainLoss;
    const after = replayLedger([buy(0, 100, 25), sale]).sales[0]!.gainLoss; // purchase price edited
    expect(after).toBe(before);
    expect(before).toBe(90); // 600 − 10 fees − 500 cost
  });

  it("realised figures do not move with market prices (they depend only on the recorded sale)", () => {
    const txs = [buy(0, 100, 10), recorded(5, 40, 14, 10, 40000)];
    const at = (marketValueAud: number) => computeHoldingSummary(txs, null, { asAt: day(9), units: 60, marketPrice: 1, marketValue: marketValueAud, marketValueAud, currency: "AUD", source: "MANUAL" });
    const low = at(300);
    const high = at(9000);
    expect(low.realisedGain).toBe(high.realisedGain);
    expect(low.realisedGain).toBe(150); // 560 − 10 − 400
    expect(low.unrealisedGainLoss).not.toBe(high.unrealisedGainLoss); // unrealised, by contrast, does move — and is kept separate
  });
});

describe("computeHoldingSummary after sales", () => {
  it("partial sale: units fall, remaining cost base is preserved pro rata, realised is separate from unrealised", () => {
    const s = computeHoldingSummary([buy(0, 200, 10), sell(5, 50, 15, 0)], null, null);
    expect(s.quantity).toBe(150);
    expect(s.costBase).toBe(1500);
    expect(s.realisedGain).toBe(250);
    expect(s.closed).toBe(false);
  });

  it("full sale: holding is closed, zero units, zero cost base, zero value — history retained", () => {
    const s = computeHoldingSummary([buy(0, 100, 10), sell(5, 100, 15, 10)], 12345 /* stale manual override */, null);
    expect(s.closed).toBe(true);
    expect(s.quantity).toBe(0);
    expect(s.costBase).toBe(0);
    expect(s.currentValue).toBe(0);
    expect(s.unrealisedGainLoss).toBe(0);
    expect(s.realisedGain).toBe(490);
  });

  it("a holding with no sales is never 'closed', even at zero units", () => {
    expect(computeHoldingSummary([buy(0, 0, 10)], null, null).closed).toBe(false);
    expect(computeHoldingSummary([], null, null).closed).toBe(false);
  });
});

describe("sellabilityOf", () => {
  it("offers the lesser of the ledger quantity and the recorded unit count", () => {
    const txs = [buy(0, 100, 10)];
    expect(sellabilityOf({ type: "SHARE", txs, valuation: null })).toMatchObject({ canSell: true, availableQuantity: 100 });
    expect(sellabilityOf({ type: "SHARE", txs, valuation: { units: 80 } }).availableQuantity).toBe(80);
    expect(sellabilityOf({ type: "ETF", txs, valuation: { units: 500 } }).availableQuantity).toBe(100);
  });
  it("explains why not: wrong type, no purchase history, nothing left", () => {
    expect(sellabilityOf({ type: "CRYPTO", txs: [buy(0, 1, 1)], valuation: null }).reason).toMatch(/shares, ETFs and LICs/);
    expect(sellabilityOf({ type: "SHARE", txs: [], valuation: { units: 10 } }).reason).toMatch(/no purchase history/);
    expect(sellabilityOf({ type: "SHARE", txs: [buy(0, 10, 1), sell(1, 10, 1)], valuation: null })).toMatchObject({ canSell: false, reason: "No units left to sell." });
  });
});
