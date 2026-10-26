import type { Investment } from "../api/types";
import { formatMoney } from "./format";
import { formatUsd, isStock } from "./holdings";
import { currencyOfStock, resolveMarketPosition, type Currency } from "./pnl";

/** One row of the Shares & ETFs transactions table (a buy or a sell of one security). */
export interface TransactionLine {
  id: string;
  investmentId: string;
  /** ISO timestamp; trades are whole UTC days. */
  date: string;
  createdAt: string | null;
  name: string;
  ticker: string | null;
  currency: Currency;
  type: "BUY" | "SELL";
  quantity: number;
  pricePerUnit: number;
  brokerage: number;
  /** BUY: total acquisition cost incl. brokerage. SELL: net proceeds after brokerage. */
  totalValue: number;
  /** Units held straight after this transaction (null only if the server didn't send it). */
  unitsAfter: number | null;
  /** SELL: profit (+) or loss (−). null for a BUY (not applicable). */
  realisedGainLoss: number | null;
  brokerAccountId: string | null;
  /** Replay order, holding period and the pool a sale draws on — from the server's single ledger replay. */
  seq: number;
  period: number;
  poolQuantityBefore: number | null;
  poolCostBefore: number | null;
  costOfSold: number | null;
  shortfall: boolean;
}

/**
 * Every buy and sell of every share/ETF/LIC as flat rows. Totals, units-after, realised P&L and the pool each sale draws on
 * come from the server's ledger replay, so this table cannot disagree with the holdings, the P&L cards or the capital gains
 * report. Each transaction appears exactly once, even if the server sent a duplicate.
 */
export function buildTransactionLines(investments: Investment[]): TransactionLine[] {
  const seen = new Set<string>();
  const lines: TransactionLine[] = [];
  for (const inv of investments.filter(isStock)) {
    const derived = new Map((inv.transactionRows ?? []).map((r) => [r.id, r]));
    inv.investmentTransactions.forEach((t, i) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      const d = derived.get(t.id);
      const gross = t.quantity * t.pricePerUnit;
      lines.push({
        id: t.id,
        investmentId: inv.id,
        date: t.date,
        createdAt: t.createdAt ?? null,
        name: inv.name,
        ticker: inv.ticker,
        currency: currencyOfStock(inv),
        type: t.type,
        quantity: t.quantity,
        pricePerUnit: t.pricePerUnit,
        brokerage: t.brokerage ?? 0,
        totalValue: d?.totalValue ?? (t.type === "BUY" ? gross + (t.brokerage ?? 0) : gross - (t.brokerage ?? 0)),
        unitsAfter: d?.unitsAfter ?? null,
        realisedGainLoss: t.type === "SELL" ? (d?.realisedGainLoss ?? null) : null,
        brokerAccountId: t.brokerAccountId ?? null,
        seq: d?.seq ?? i,
        period: d?.period ?? 1,
        poolQuantityBefore: d?.poolQuantityBefore ?? null,
        poolCostBefore: d?.poolCostBefore ?? null,
        costOfSold: d?.costOfSold ?? null,
        shortfall: d?.shortfall ?? false,
      });
    });
  }
  return lines;
}

export const NO_BROKER = "__none__";

export interface TransactionFilters {
  /** Investment id, or "" for all securities. */
  investmentId: string;
  /** Broker account id, NO_BROKER for trades with none recorded, or "" for all. */
  brokerAccountId: string;
  type: "" | "BUY" | "SELL";
  /** Inclusive YYYY-MM-DD bounds, or "". */
  from: string;
  to: string;
}
export const NO_FILTERS: TransactionFilters = { investmentId: "", brokerAccountId: "", type: "", from: "", to: "" };
export const hasActiveFilters = (f: TransactionFilters): boolean => Object.values(f).some((v) => v !== "");

export function matchesFilters(l: TransactionLine, f: TransactionFilters): boolean {
  if (f.investmentId && l.investmentId !== f.investmentId) return false;
  if (f.brokerAccountId === NO_BROKER ? l.brokerAccountId !== null : f.brokerAccountId && l.brokerAccountId !== f.brokerAccountId) return false;
  if (f.type && l.type !== f.type) return false;
  const day = l.date.slice(0, 10);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  return true;
}
export const filterLines = (lines: TransactionLine[], f: TransactionFilters): TransactionLine[] => lines.filter((l) => matchesFilters(l, f));

/** Oldest → newest in the server's replay order: by day, purchases before sales on the same day, then when recorded. */
export const byReplayOrder = (a: TransactionLine, b: TransactionLine): number => a.seq - b.seq;

/** Everything shown in a security's heading: where the holding stands now. All from the history + the latest valid price. */
export interface GroupMetrics {
  /** Units still held, from the buy/sell history (0 once fully sold). */
  units: number;
  closed: boolean;
  /** Average cost per unit and total cost of the units still held (incl. brokerage); null when there are no units or no buy history. */
  avgCost: number | null;
  costBase: number | null;
  marketPrice: number | null;
  marketPriceAsAt: string | null;
  priceBasis: "live" | "recorded" | "none";
  marketValue: number | null;
  /** Market value − remaining cost base. null when there's no price, no cost, or nothing held — never a made-up figure. */
  unrealised: number | null;
  unrealisedPercent: number | null;
  /** All realised profit (+) / loss (−) from sales of this security. */
  realised: number;
  hasSales: boolean;
}

export function groupMetricsOf(inv: Investment): GroupMetrics {
  const closed = inv.summary.closed === true;
  const pos = resolveMarketPosition(inv);
  const costKnown = inv.summary.costBaseKnown !== false;
  const units = closed ? 0 : (pos.units ?? 0);
  const costBase = !closed && costKnown && units > 0 ? inv.summary.costBase : null;
  const avgCost = costBase !== null && units > 0 ? costBase / units : null;
  const marketValue = !closed ? pos.marketValue : null;
  const unrealised = marketValue !== null && costBase !== null ? marketValue - costBase : null;
  return {
    units,
    closed,
    avgCost,
    costBase,
    marketPrice: closed ? null : pos.marketPrice,
    marketPriceAsAt: closed ? null : pos.marketPriceAsAt,
    priceBasis: closed ? "none" : pos.priceBasis,
    marketValue,
    unrealised,
    unrealisedPercent: unrealised !== null && costBase !== null && costBase > 0 ? (unrealised / costBase) * 100 : null,
    realised: inv.summary.realisedGain - inv.summary.realisedLoss,
    hasSales: inv.investmentTransactions.some((t) => t.type === "SELL"),
  };
}

export interface SecurityGroup {
  investment: Investment;
  id: string;
  label: string;
  currency: Currency;
  metrics: GroupMetrics;
  /** Every transaction of this security, in replay order. Matching always uses these, so a filter never changes a figure. */
  allLines: TransactionLine[];
  /** The transactions that pass the current filters. */
  lines: TransactionLine[];
  /** At least one sale needs review (sold more than was held). */
  needsReview: boolean;
}

/**
 * One group per share/ETF/LIC, holdings first (A–Z) then fully sold ones (A–Z). A security with no transactions yet still
 * gets its group, so a holding recorded only from a statement doesn't disappear from the screen.
 */
export function groupBySecurity(investments: Investment[], lines: TransactionLine[], filters: TransactionFilters = NO_FILTERS): SecurityGroup[] {
  const byInvestment = new Map<string, TransactionLine[]>();
  for (const l of lines) byInvestment.set(l.investmentId, [...(byInvestment.get(l.investmentId) ?? []), l]);
  const filtering = hasActiveFilters(filters);
  const groups = investments.filter(isStock).map((inv): SecurityGroup => {
    const allLines = (byInvestment.get(inv.id) ?? []).sort(byReplayOrder);
    return {
      investment: inv,
      id: inv.id,
      label: inv.ticker ? `${inv.ticker} — ${inv.name}` : inv.name,
      currency: currencyOfStock(inv),
      metrics: groupMetricsOf(inv),
      allLines,
      lines: allLines.filter((l) => matchesFilters(l, filters)),
      needsReview: allLines.some((l) => l.shortfall),
    };
  });
  return groups
    .filter((g) => !filtering || g.lines.length > 0)
    .sort((a, b) => Number(a.metrics.closed) - Number(b.metrics.closed) || a.label.localeCompare(b.label));
}

/** How a sale's figures were reached, for checking against the purchases. */
export interface SaleMatch {
  /** Purchases in the same holding period that happened before the sale (the pool it drew from). */
  buys: TransactionLine[];
  poolQuantity: number;
  poolCost: number;
  /** Average cost per unit of that pool. */
  avgCost: number | null;
  unitsSold: number;
  costOfSold: number | null;
  netProceeds: number;
  realised: number | null;
  shortfall: boolean;
}

/**
 * The cost-basis method is AVERAGE COST: a sale takes its cost from the pooled average of everything held at that moment,
 * not from one particular purchase. So the "match" for a sale is the set of purchases in its holding period that came before
 * it, the pool average they produce, and the cost that average gives for the units sold. No purchase is assigned to a sale
 * by guesswork.
 */
export function matchSale(sell: TransactionLine, groupLines: TransactionLine[]): SaleMatch {
  const buys = groupLines.filter((l) => l.type === "BUY" && l.period === sell.period && l.seq < sell.seq);
  const poolQuantity = sell.poolQuantityBefore ?? 0;
  const poolCost = sell.poolCostBefore ?? 0;
  return {
    buys,
    poolQuantity,
    poolCost,
    avgCost: poolQuantity > 0 ? poolCost / poolQuantity : null,
    unitsSold: sell.quantity,
    costOfSold: sell.costOfSold,
    netProceeds: sell.totalValue,
    realised: sell.realisedGainLoss,
    shortfall: sell.shortfall,
  };
}

export const formatLineMoney = (n: number, currency: Currency): string => (currency === "USD" ? formatUsd(n) : formatMoney(n));

export interface TransactionEditErrors {
  date?: string;
  quantity?: string;
  price?: string;
  brokerage?: string;
  security?: string;
}

/** Same rules the server enforces, so mistakes are caught before a round trip. The server still has the last word. */
export function validateTransactionEdit(v: { investmentId: string; date: string; quantity: string; price: string; brokerage: string }): TransactionEditErrors {
  const e: TransactionEditErrors = {};
  if (!v.investmentId) e.security = "Please choose a security.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(Date.parse(v.date))) e.date = "Please enter a valid date.";
  const q = Number(v.quantity);
  if (v.quantity.trim() === "" || !Number.isFinite(q)) e.quantity = "Please enter the number of units.";
  else if (q <= 0) e.quantity = "Units must be greater than zero.";
  const p = Number(v.price);
  if (v.price.trim() === "" || !Number.isFinite(p)) e.price = "Please enter the price per unit.";
  else if (p <= 0) e.price = "Price must be greater than zero.";
  const b = v.brokerage.trim() === "" ? 0 : Number(v.brokerage);
  if (!Number.isFinite(b)) e.brokerage = "Please enter the brokerage as a number.";
  else if (b < 0) e.brokerage = "Brokerage can't be negative.";
  return e;
}
