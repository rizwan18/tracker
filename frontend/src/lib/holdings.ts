import type { Investment } from "../api/types";

export const STOCK_TYPES = ["SHARE", "ETF", "LIC"];
export const isStock = (inv: Pick<Investment, "type">) => STOCK_TYPES.includes(inv.type);

/** Which of the two tables a stock belongs in. Older records have no market and count as Australian. */
export const marketOf = (inv: Pick<Investment, "market">): "ASX" | "WALL_ST" => (inv.market === "WALL_ST" ? "WALL_ST" : "ASX");

export const MARKET_TITLES: Record<"ASX" | "WALL_ST", string> = { ASX: "Aus Equities", WALL_ST: "Wall St Equities" };

/** 417 → "417", 0.2 → "0.2", 1234.5678 → "1,234.5678" (up to four decimals, no padding). */
export function formatUnits(n: number): string {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 4 }).format(n);
}

/** Share prices: at least cents, up to four decimals ($2.20, $9.239). */
export function formatPrice(n: number, currency: "AUD" | "USD" = "AUD"): string {
  const digits = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
  return currency === "USD" ? `US$${digits}` : `$${digits}`;
}

export function formatUsd(n: number): string {
  return `US$${new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export const formatPercent = (n: number) => `${n.toFixed(2)}%`;
