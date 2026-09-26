/**
 * Refreshes persisted market prices (Investment.marketPrice) for a household's shares/ETFs.
 *
 * Called from routes/investments.ts's POST /investments/refresh-market-prices, which the
 * frontend fires once after the Shares and ETFs page has already rendered from the database
 * (see InvestmentsPage.tsx) — so a slow or failed provider call never blocks the initial page
 * display. This function itself never throws: a failure for one ticker is logged and left
 * untouched, and never prevents other tickers from being refreshed.
 */
import { prisma } from "../lib/prisma";
import { STOCK_TYPES } from "../lib/constants";
import { getLatestPrice, MarketDataError, toProviderTicker } from "../lib/marketData";
import { isMarketOpen, toMarket } from "../lib/marketHours";

// Per-holding floor between provider calls. Persisted on the row itself (marketPriceUpdatedAt)
// rather than an in-memory cache, so it holds even across serverless instances/cold starts —
// this is what stops a user repeatedly refreshing the page from generating uncontrolled
// provider traffic, on top of never calling the provider at all outside trading hours.
const MIN_REFRESH_INTERVAL_MS = 60 * 1000;

interface RefreshCandidate {
  id: string;
  ticker: string | null;
  market: string | null;
  marketPriceUpdatedAt: Date | null;
}

export async function refreshMarketPrices(householdId: string): Promise<void> {
  const now = new Date();
  const candidates: RefreshCandidate[] = await prisma.investment.findMany({
    where: { householdId, type: { in: [...STOCK_TYPES] }, ticker: { not: null } },
    select: { id: true, ticker: true, market: true, marketPriceUpdatedAt: true },
  });

  const due = candidates.filter((inv) => {
    if (!inv.ticker) return false;
    if (!isMarketOpen(toMarket(inv.market), now)) return false; // closed market: never call the provider
    if (inv.marketPriceUpdatedAt && now.getTime() - inv.marketPriceUpdatedAt.getTime() < MIN_REFRESH_INTERVAL_MS) return false; // throttled
    return true;
  });
  if (due.length === 0) return;

  // Dedupe by provider ticker: two holdings of the same security share one provider call.
  const byProviderTicker = new Map<string, string[]>(); // providerTicker -> investment ids
  for (const inv of due) {
    const providerTicker = toProviderTicker(inv.ticker!, toMarket(inv.market));
    const ids = byProviderTicker.get(providerTicker) ?? [];
    ids.push(inv.id);
    byProviderTicker.set(providerTicker, ids);
  }

  // allSettled: one bad/rate-limited ticker must not stop the others from updating.
  await Promise.allSettled(
    [...byProviderTicker.entries()].map(async ([providerTicker, investmentIds]) => {
      try {
        const price = await getLatestPrice(providerTicker);
        await prisma.investment.updateMany({
          where: { id: { in: investmentIds } },
          data: {
            marketPrice: price.price,
            marketPriceUpdatedAt: new Date(),
            marketPriceProviderTimestamp: price.timestamp ? new Date(price.timestamp) : null,
          },
        });
      } catch (err) {
        // Leave the existing stored price/timestamp exactly as they were.
        const detail = err instanceof MarketDataError ? `${err.code} - ${err.message}` : err;
        console.error(`[market-price-refresh] ${providerTicker}:`, detail);
      }
    })
  );
}
