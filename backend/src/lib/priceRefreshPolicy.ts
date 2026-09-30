/**
 * When a stored market price is due for a refresh from the market-data provider.
 *
 * - Exchange open:   at most once a minute per holding (keeps the price live without letting
 *                    repeated page loads generate uncontrolled provider traffic).
 * - Exchange closed: at most once every 24 hours, so evenings, weekends and other closed
 *                    periods still get a price saved (the provider returns the last close)
 *                    without polling for a price that can't change.
 *
 * Both limits are measured from Investment.marketPriceUpdatedAt, which is persisted on the
 * row, so they hold across serverless instances and cold starts.
 */
import { isMarketOpen, type Market } from "./marketHours";

export const OPEN_MARKET_REFRESH_INTERVAL_MS = 60 * 1000;
export const CLOSED_MARKET_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isPriceRefreshDue(market: Market, lastUpdatedAt: Date | null, now: Date = new Date()): boolean {
  if (!lastUpdatedAt) return true; // never had a price: fetch it, whatever the hour
  const interval = isMarketOpen(market, now) ? OPEN_MARKET_REFRESH_INTERVAL_MS : CLOSED_MARKET_REFRESH_INTERVAL_MS;
  return now.getTime() - lastUpdatedAt.getTime() >= interval;
}
