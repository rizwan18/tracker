import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { getLatestPrice, MarketDataError, type ProviderErrorCode, type LatestPrice } from "../lib/marketData";

const router = Router();
router.use(requireAuth);

// Soft in-memory cache to avoid duplicate/rapid-fire requests hitting the
// free market-data provider's rate limits. Per-process only (fine for a
// single Express instance; a multi-instance/serverless deployment would
// need a shared cache to get the same benefit, but correctness doesn't
// depend on it — it's a best-effort optimisation).
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map<string, { data: LatestPrice; expiresAt: number }>();

function getCached(ticker: string): LatestPrice | null {
  const entry = cache.get(ticker);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) cache.delete(ticker);
  return null;
}

function setCached(ticker: string, data: LatestPrice): void {
  cache.set(ticker, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

const ERROR_MAP: Record<ProviderErrorCode, { status: number; message: string }> = {
  INVALID_TICKER: { status: 400, message: "Please enter a valid security code." },
  NOT_FOUND: { status: 404, message: "Security not found. Please check the code and try again." },
  NO_PRICE: { status: 502, message: "No price is currently available for this security." },
  RATE_LIMIT: { status: 429, message: "Too many requests right now. Please try again shortly." },
  TIMEOUT: { status: 504, message: "The market data provider took too long to respond. Please try again." },
  UNAVAILABLE: { status: 502, message: "The market data provider is currently unavailable. Please try again shortly." },
  INVALID_RESPONSE: { status: 502, message: "Received an unexpected response from the market data provider." },
};

router.get(
  "/price",
  asyncHandler(async (req, res) => {
    const rawTicker = req.query.ticker;
    if (!rawTicker || typeof rawTicker !== "string" || !rawTicker.trim()) {
      throw new FriendlyError("A security code is required.", 400);
    }

    const ticker = rawTicker.trim().toUpperCase();

    const cached = getCached(ticker);
    if (cached) return res.json({ ...cached, cached: true });

    try {
      const result = await getLatestPrice(ticker);
      setCached(ticker, result);
      res.json(result);
    } catch (err) {
      if (err instanceof MarketDataError) {
        const mapped = ERROR_MAP[err.code] ?? { status: 502, message: "Unable to retrieve the latest price." };
        console.error(`[market-data] ${ticker}: ${err.code} - ${err.message}`);
        throw new FriendlyError(mapped.message, mapped.status);
      }
      throw err;
    }
  })
);

export default router;
