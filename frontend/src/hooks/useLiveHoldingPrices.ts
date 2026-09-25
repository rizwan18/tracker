import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Investment, LatestPrice } from "../api/types";
import { isStock, marketOf, toProviderTicker } from "../lib/holdings";

/**
 * Fetches the latest market price for each Aus/Wall St stock or ETF holding, using the
 * same GET /api/market-data/price endpoint as the Check Security Price page. Runs fresh
 * whenever the investments list changes (e.g. on every Investments page load), rather
 * than being cached in the browser — the backend already applies its own short-lived
 * cache per ticker.
 *
 * Returns a map of investment id -> latest price. A holding with no ticker, or whose
 * provider lookup fails (not found, rate-limited, provider down, ...), is simply
 * missing from the map — the table falls back to "—" for that row rather than
 * showing a per-row error or blocking the other holdings.
 */
export function useLiveHoldingPrices(investments: Investment[]): Record<string, LatestPrice> {
  const [prices, setPrices] = useState<Record<string, LatestPrice>>({});

  useEffect(() => {
    const stocks = investments.filter(isStock).filter((inv): inv is Investment & { ticker: string } => !!inv.ticker);
    setPrices({}); // clear out prices from a previous holdings list while fresh ones load
    if (stocks.length === 0) return;

    let cancelled = false;
    // Dedupe: holdings that resolve to the same provider ticker share one request.
    const requests = new Map<string, Promise<LatestPrice>>();

    for (const inv of stocks) {
      const providerTicker = toProviderTicker(inv.ticker, marketOf(inv));
      let req = requests.get(providerTicker);
      if (!req) {
        req = api.get<LatestPrice>(`/market-data/price?ticker=${encodeURIComponent(providerTicker)}`);
        requests.set(providerTicker, req);
      }
      req
        .then((price) => {
          if (!cancelled) setPrices((prev) => ({ ...prev, [inv.id]: price }));
        })
        .catch(() => {
          /* leave this holding out of the map — the table shows "—" for a missing live price */
        });
    }

    return () => {
      cancelled = true;
    };
  }, [investments]);

  return prices;
}
