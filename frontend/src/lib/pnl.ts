import type { Investment } from "../api/types";
import { formatCurrencySigned } from "./format";
import { formatUsd, isStock, marketOf } from "./holdings";

/**
 * Realised / unrealised profit and loss for the Shares and ETFs screen.
 *
 * Nothing here re-derives cost base or realised gains: both come from each holding's `summary`, which the
 * backend builds from the app's single average-cost ledger replay (replayLedger in services/holdings.ts).
 * The only thing worked out on this side is the unrealised figure's market value, using the same price
 * rules as the holdings table (resolveMarketPosition below is used by both, so they cannot drift apart).
 */

export type Currency = "AUD" | "USD";

/** Wall St equities are held and shown in US$; everything else on this screen is A$. No conversion is applied anywhere. */
export const currencyOfStock = (inv: Pick<Investment, "market">): Currency => (marketOf(inv) === "WALL_ST" ? "USD" : "AUD");

/** A price only counts if it is a real, positive number — 0, NaN or null never silently becomes a $0 valuation. */
const isValidPrice = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export interface MarketPosition {
  /** Units held: the recorded holding's units, else what the buy/sell history says; null when nothing is held. */
  units: number | null;
  marketPrice: number | null;
  marketPriceAsAt: string | null;
  /** live = last successful provider refresh; recorded = last recorded valuation price; none = no usable price. */
  priceBasis: "live" | "recorded" | "none";
  marketValue: number | null;
}

/** The holdings table's market price / value rules, in one place. */
export function resolveMarketPosition(inv: Investment): MarketPosition {
  const h = inv.holding ?? null;
  // Available units come from the buy/sell history whenever there is one (never from a hand-kept units field alone);
  // only a holding with no trades at all falls back to its recorded valuation's units.
  const fromHistory = inv.summary.costBaseKnown !== false;
  const units = fromHistory ? (inv.summary.quantity > 0 ? inv.summary.quantity : null) : h ? h.units : null;
  let marketPrice: number | null = null;
  let marketPriceAsAt: string | null = null;
  let priceBasis: MarketPosition["priceBasis"] = "none";
  if (isValidPrice(inv.marketPrice)) {
    marketPrice = inv.marketPrice;
    marketPriceAsAt = inv.marketPriceUpdatedAt;
    priceBasis = "live";
  } else if (h && isValidPrice(h.marketPrice)) {
    marketPrice = h.marketPrice;
    marketPriceAsAt = h.asAt;
    priceBasis = "recorded";
  }
  const marketValue = marketPrice !== null && units !== null ? marketPrice * units : null;
  return { units, marketPrice, marketPriceAsAt, priceBasis, marketValue };
}

export interface PnlBucket {
  /** Net profit (+) or loss (−). */
  amount: number;
  /** What the percentage is measured against: cost of the units sold (realised) or cost still held (unrealised). */
  costBase: number;
  /** Holdings contributing to this bucket. */
  holdings: number;
}

export interface PnlSummary {
  realised: Record<Currency, PnlBucket>;
  unrealised: Record<Currency, PnlBucket>;
  /** Open holdings left out of unrealised because no valid price exists yet. */
  awaitingPrice: number;
  /** Open holdings left out of unrealised because they have no buy/sell history, so no cost base. */
  noCostBase: number;
  /** Holdings included in unrealised that are valued on a recorded price rather than a refreshed one. */
  recordedPriceOnly: number;
}

const emptyBucket = (): PnlBucket => ({ amount: 0, costBase: 0, holdings: 0 });

/** Shares, ETFs and LICs only: the securities that have market prices and a Sell action. */
export function summarisePnl(investments: Investment[]): PnlSummary {
  const out: PnlSummary = {
    realised: { AUD: emptyBucket(), USD: emptyBucket() },
    unrealised: { AUD: emptyBucket(), USD: emptyBucket() },
    awaitingPrice: 0,
    noCostBase: 0,
    recordedPriceOnly: 0,
  };

  for (const inv of investments.filter(isStock)) {
    const currency = currencyOfStock(inv);

    // Realised: every sale ever recorded, open or fully-sold holdings alike. Taken as-is from the ledger replay.
    if (inv.investmentTransactions.some((t) => t.type === "SELL")) {
      const r = out.realised[currency];
      r.amount += inv.summary.realisedGain - inv.summary.realisedLoss;
      r.costBase += inv.summary.realisedCostBase ?? 0;
      r.holdings += 1;
    }

    // Unrealised: only what is still held. A closed holding's gains are already realised and never counted again.
    if (inv.summary.closed) continue;
    const pos = resolveMarketPosition(inv);
    if (pos.units === null || pos.units <= 0) continue;
    if (inv.summary.costBaseKnown === false) {
      out.noCostBase += 1;
      continue;
    }
    if (pos.marketValue === null) {
      out.awaitingPrice += 1;
      continue;
    }
    const u = out.unrealised[currency];
    u.amount += pos.marketValue - inv.summary.costBase;
    u.costBase += inv.summary.costBase;
    u.holdings += 1;
    if (pos.priceBasis === "recorded") out.recordedPriceOnly += 1;
  }
  return out;
}

const roundCents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type Tone = "positive" | "negative" | "neutral";

/** Sign of the amount as it will be displayed (to the cent), so float dust never shows as "-$0.00". */
export const toneOf = (amount: number): Tone => {
  const r = roundCents(amount);
  return r > 0 ? "positive" : r < 0 ? "negative" : "neutral";
};

/** Percentage return, or null when there is no meaningful (positive) cost to measure against. */
export function returnPercent(bucket: PnlBucket): number | null {
  if (!(bucket.costBase > 0)) return null;
  return (roundCents(bucket.amount) / bucket.costBase) * 100;
}

export function formatPnl(amount: number, currency: Currency): string {
  const r = roundCents(amount);
  if (currency === "AUD") return r === 0 ? formatCurrencySigned(0).replace("+", "") : formatCurrencySigned(r);
  return r === 0 ? formatUsd(0) : `${r < 0 ? "-" : "+"}${formatUsd(Math.abs(r))}`;
}

export const formatReturn = (pct: number): string => (Math.abs(pct) < 0.005 ? "0.00%" : `${pct > 0 ? "+" : "-"}${Math.abs(pct).toFixed(2)}%`);
