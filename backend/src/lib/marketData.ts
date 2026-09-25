/**
 * marketData.ts
 *
 * Isolates the external market-data provider behind a small, stable
 * interface — getLatestPrice(ticker) — so the provider can be swapped
 * without touching routes/marketData.ts or any other caller.
 *
 * ---------------------------------------------------------------------------
 * PROVIDER: Yahoo Finance "chart" endpoint (unofficial, free, no API key)
 * ---------------------------------------------------------------------------
 * Endpoint:  https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}
 * - Free, no signup or API key required.
 * - Supports ASX tickers using the ".AX" suffix (e.g. BHP.AX, CBA.AX, CSL.AX)
 *   as well as US tickers (AAPL, MSFT) and many other exchanges — a good fit
 *   for this app's investments, which already store a free-text `ticker`.
 * - Unofficial/undocumented: Yahoo can change or rate-limit it without
 *   notice, which is why the call is isolated here and results are cached
 *   briefly (see routes/marketData.ts) to reduce duplicate requests.
 * - Called server-side only: the endpoint sends no CORS headers, so it can't
 *   be called directly from the frontend, and keeping it server-side also
 *   means no credentials are ever exposed to the browser.
 *
 * To switch to a paid/registered provider (Alpha Vantage, Twelve Data,
 * IEX Cloud, Finnhub, ...) that needs an API key:
 *   1. Add the key as an environment variable (see backend/.env.example) —
 *      never hard-code it or commit it.
 *   2. Write a new fetchFromX(ticker) function below.
 *   3. Point PROVIDER at your new function.
 * routes/marketData.ts does not need to change.
 */

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const FETCH_TIMEOUT_MS = 8000;

export type ProviderErrorCode =
  | "INVALID_TICKER"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "INVALID_RESPONSE"
  | "NO_PRICE";

export class MarketDataError extends Error {
  code: ProviderErrorCode;
  constructor(message: string, code: ProviderErrorCode) {
    super(message);
    this.name = "MarketDataError";
    this.code = code;
  }
}

export interface LatestPrice {
  ticker: string;
  price: number;
  currency: string | null;
  exchange: string | null;
  timestamp: string | null; // ISO 8601, provider-supplied
  previousClose: number | null;
  marketState: string | null;
  isStale: boolean; // true when the market isn't in regular session
}

/** Letters, numbers, dot, hyphen, caret only, reasonable length. */
export function isPlausibleTicker(ticker: string): boolean {
  return /^[A-Z0-9][A-Z0-9.\-^]{0,14}$/.test(ticker);
}

export function normaliseTicker(raw: string | undefined | null): string {
  return String(raw ?? "").trim().toUpperCase();
}

interface YahooChartMeta {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  currency?: string;
  fullExchangeName?: string;
  exchangeName?: string;
  chartPreviousClose?: number;
  marketState?: string;
}

interface YahooChartResponse {
  chart?: {
    result?: { meta?: YahooChartMeta }[];
    error?: unknown;
  };
}

async function fetchFromYahoo(ticker: string): Promise<LatestPrice> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${YAHOO_CHART_URL}${encodeURIComponent(ticker)}?interval=1d&range=1d`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RevenueExpenseTracker/1.0)",
        Accept: "application/json",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MarketDataError("Market data provider timed out.", "TIMEOUT");
    }
    throw new MarketDataError("Market data provider is unavailable.", "UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) throw new MarketDataError("Market data provider rate limit exceeded.", "RATE_LIMIT");
  if (response.status === 404) throw new MarketDataError("Security not found.", "NOT_FOUND");
  if (!response.ok) {
    throw new MarketDataError(`Market data provider returned an unexpected status (${response.status}).`, "UNAVAILABLE");
  }

  let data: YahooChartResponse;
  try {
    data = (await response.json()) as YahooChartResponse;
  } catch {
    throw new MarketDataError("Market data provider returned an invalid response.", "INVALID_RESPONSE");
  }

  if (data.chart?.error) {
    // Yahoo returns a chart.error object for unknown tickers instead of HTTP 404.
    throw new MarketDataError("Security not found.", "NOT_FOUND");
  }

  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) {
    throw new MarketDataError("Market data provider returned an invalid response.", "INVALID_RESPONSE");
  }

  const price = meta.regularMarketPrice;
  if (price === undefined || price === null || Number.isNaN(Number(price))) {
    throw new MarketDataError("No price is currently available for this security.", "NO_PRICE");
  }

  const timestamp = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;
  const marketState = meta.marketState ?? null;

  return {
    ticker: meta.symbol || ticker,
    price: Number(price),
    currency: meta.currency ?? null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    timestamp,
    previousClose: meta.chartPreviousClose !== undefined ? Number(meta.chartPreviousClose) : null,
    marketState,
    isStale: marketState ? marketState !== "REGULAR" : false,
  };
}

// Active provider — swap this to change data source without touching callers.
const PROVIDER = fetchFromYahoo;

/**
 * Get the latest price for a ticker (e.g. "BHP.AX", "AAPL").
 * @throws {MarketDataError}
 */
export async function getLatestPrice(rawTicker: string | undefined | null): Promise<LatestPrice> {
  const ticker = normaliseTicker(rawTicker);
  if (!ticker) throw new MarketDataError("Security code is required.", "INVALID_TICKER");
  if (!isPlausibleTicker(ticker)) throw new MarketDataError("Security code contains invalid characters.", "INVALID_TICKER");
  return PROVIDER(ticker);
}
