import type { Investment } from "../api/types";
import { formatMoney } from "./format";
import { formatUsd, isStock, marketOf } from "./holdings";
import { currencyOfStock, type Currency } from "./pnl";

/** One row of the unified Shares & ETFs transactions table (buys and sells together). */
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
}

/**
 * Every buy and sell of every share/ETF/LIC (open or fully sold) as flat rows. Totals, units-after and realised P&L come
 * from the server's ledger replay, so this table cannot disagree with the holdings, the P&L cards or the capital gains report.
 */
export function buildTransactionLines(investments: Investment[]): TransactionLine[] {
  const lines: TransactionLine[] = [];
  for (const inv of investments.filter(isStock)) {
    const derived = new Map((inv.transactionRows ?? []).map((r) => [r.id, r]));
    for (const t of inv.investmentTransactions) {
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
      });
    }
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

export function filterLines(lines: TransactionLine[], f: TransactionFilters): TransactionLine[] {
  return lines.filter((l) => {
    if (f.investmentId && l.investmentId !== f.investmentId) return false;
    if (f.brokerAccountId === NO_BROKER ? l.brokerAccountId !== null : f.brokerAccountId && l.brokerAccountId !== f.brokerAccountId) return false;
    if (f.type && l.type !== f.type) return false;
    const day = l.date.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
}

export type SortKey = "date" | "security" | "type" | "total" | "realised";
export type SortDir = "asc" | "desc";
export interface TransactionSort {
  key: SortKey;
  dir: SortDir;
}
/** Latest first by default. */
export const DEFAULT_SORT: TransactionSort = { key: "date", dir: "desc" };

/** Oldest → newest in the order the ledger is replayed: by day, buys before sells on the same day, then when recorded. */
function chronological(a: TransactionLine, b: TransactionLine): number {
  const day = a.date.slice(0, 10).localeCompare(b.date.slice(0, 10));
  if (day !== 0) return day;
  const kind = (a.type === "BUY" ? 0 : 1) - (b.type === "BUY" ? 0 : 1);
  if (kind !== 0) return kind;
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);
}

export function sortLines(lines: TransactionLine[], sort: TransactionSort): TransactionLine[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const label = (l: TransactionLine) => (l.ticker ?? l.name).toLowerCase();
  return [...lines].sort((a, b) => {
    let c = 0;
    if (sort.key === "date") return sign * chronological(a, b);
    if (sort.key === "security") c = label(a).localeCompare(label(b));
    else if (sort.key === "type") c = a.type.localeCompare(b.type);
    else if (sort.key === "total") c = a.totalValue - b.totalValue;
    else {
      // Purchases have no realised figure: they always sort after the sales, whichever way round.
      if (a.realisedGainLoss === null || b.realisedGainLoss === null) return a.realisedGainLoss === b.realisedGainLoss ? -chronological(a, b) : a.realisedGainLoss === null ? 1 : -1;
      c = a.realisedGainLoss - b.realisedGainLoss;
    }
    return c !== 0 ? sign * c : -chronological(a, b);
  });
}

export const formatLineMoney = (n: number, currency: Currency): string => (currency === "USD" ? formatUsd(n) : formatMoney(n));
export { marketOf };
