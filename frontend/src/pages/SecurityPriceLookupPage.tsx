import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { LatestPrice } from "../api/types";
import { Button, Card, Field, SectionHeading, Alert, inputClass } from "../components/ui";
import { formatCurrencyIn, formatDateTime } from "../lib/format";

const MAX_TICKER_LENGTH = 15;
// Matches the backend's own check (backend/src/lib/marketData.ts) so obviously
// invalid input is caught before a request is even sent.
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.\-^]{0,14}$/;

/** Client-side validation only — the backend re-validates everything itself. */
function validateTicker(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Please enter a security code.";
  if (value.length > MAX_TICKER_LENGTH) return "Security code is too long.";
  if (!TICKER_PATTERN.test(value.toUpperCase())) return "Security code contains invalid characters.";
  return null;
}

export default function SecurityPriceLookupPage() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LatestPrice | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return; // guard against duplicate submits

    const validationError = validateTicker(ticker);
    if (validationError) {
      setError(validationError);
      setResult(null);
      return;
    }

    const normalised = ticker.trim().toUpperCase();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await api.get<LatestPrice>(`/market-data/price?ticker=${encodeURIComponent(normalised)}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Market data is temporarily unavailable. Please try again later.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Security Price Lookup"
        subtitle="Look up the latest available market price for a share, ETF or other listed security."
        action={
          <Link to="/investments">
            <Button variant="secondary">Back to Investments</Button>
          </Link>
        }
      />

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="Security Code" htmlFor="security-code" hint="e.g. BHP.AX, CBA.AX, CSL.AX, AAPL, MSFT">
            <input
              id="security-code"
              className={inputClass}
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="BHP.AX"
              maxLength={MAX_TICKER_LENGTH}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "security-code-error" : undefined}
            />
          </Field>

          {error && (
            <p id="security-code-error" role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={loading}>
              {loading ? "Getting price…" : "Get Latest Price"}
            </Button>
          </div>
        </form>
      </Card>

      {loading && <p aria-live="polite" className="text-[var(--color-ink-soft)]">Fetching the latest price…</p>}

      {result && !loading && (
        <Card>
          <h3 className="font-display text-lg font-semibold mb-4">Security Price</h3>

          <div className="space-y-4">
            <div>
              <p className="text-sm text-[var(--color-ink-soft)]">Security</p>
              <p className="font-medium text-[var(--color-ink)]">{result.ticker}</p>
            </div>

            {result.price !== undefined && result.price !== null && (
              <div>
                <p className="text-sm text-[var(--color-ink-soft)]">Latest Available Price</p>
                <p className="font-display text-2xl font-semibold text-[var(--color-ink)]">{formatCurrencyIn(result.price, result.currency)}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {result.currency && (
                <div>
                  <p className="text-sm text-[var(--color-ink-soft)]">Currency</p>
                  <p className="text-[var(--color-ink)]">{result.currency}</p>
                </div>
              )}
              {result.exchange && (
                <div>
                  <p className="text-sm text-[var(--color-ink-soft)]">Market</p>
                  <p className="text-[var(--color-ink)]">{result.exchange}</p>
                </div>
              )}
              {result.timestamp && (
                <div>
                  <p className="text-sm text-[var(--color-ink-soft)]">Last Updated</p>
                  <p className="text-[var(--color-ink)]">{formatDateTime(result.timestamp)}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-[var(--color-ink-soft)]">Data Source</p>
                <p className="text-[var(--color-ink)]">Yahoo Finance{result.cached ? " (cached)" : ""}</p>
              </div>
            </div>

            {result.isStale && (
              <Alert
                severity="info"
                message="The market is currently closed — this is the latest available price, not a live price."
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
