import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { Button, Field, inputClass } from "./ui";
import { STOCK_TYPES, MARKET_TITLES, formatUsd } from "../lib/holdings";
import { formatMoney, toInputDate } from "../lib/format";

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "SHARE", label: "Share" },
  { value: "ETF", label: "ETF" },
  { value: "LIC", label: "LIC" },
  { value: "MANAGED_FUND", label: "Managed fund" },
  { value: "BOND", label: "Bond" },
  { value: "TERM_DEPOSIT", label: "Term deposit" },
  { value: "CRYPTO", label: "Cryptocurrency" },
  { value: "P2P", label: "Peer-to-peer investment" },
  { value: "PRIVATE", label: "Private investment" },
  { value: "COLLECTIBLE", label: "Collectible" },
  { value: "OTHER", label: "Other" },
];

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));

/**
 * Add an investment. Shares, ETFs and LICs are entered the way a Stake report lists them
 * (Symbol, Name, market, Units, Purchase Price, Purchase Value, plus read-only Market Price / Value); everything else keeps the simple form.
 */
export function InvestmentForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [type, setType] = useState("SHARE");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [market, setMarket] = useState<"ASX" | "WALL_ST">("ASX");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [asAt, setAsAt] = useState(toInputDate(new Date()));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isStock = STOCK_TYPES.includes(type);
  const isUs = isStock && market === "WALL_ST";
  const currency = isUs ? "USD" : "AUD";

  // Purchase Value = units × price (in the market's own currency), shown as A$ too for Wall St.
  const value = useMemo(() => {
    const u = num(units);
    const p = num(price);
    if (u === null || p === null || Number.isNaN(u) || Number.isNaN(p)) return null;
    const own = Math.round(u * p * 100) / 100;
    const rate = num(fxRate);
    return { own, aud: isUs ? (rate && rate > 0 ? Math.round(own * rate * 100) / 100 : null) : own };
  }, [units, price, fxRate, isUs]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please name this investment.");
    const body: Record<string, unknown> = { name: name.trim(), ticker: ticker.trim() || null, type, notes: notes.trim() || null };
    if (isStock) {
      body.market = market;
      body.currency = currency;
      const u = num(units);
      const p = num(price);
      if (u !== null || p !== null) {
        if (u === null || p === null || Number.isNaN(u) || Number.isNaN(p) || u < 0 || p < 0) return setError("Please enter the units and the purchase price as numbers.");
        const rate = num(fxRate);
        if (isUs && (!rate || rate <= 0)) return setError("Please enter the exchange rate (A$ per US$) so the value can be shown in Australian dollars.");
        body.valuation = { asAt, units: u, marketPrice: p, ...(isUs ? { fxRate: rate } : {}) };
      }
    }
    setSaving(true);
    try {
      await api.post("/investments", body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save this investment. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <Field label="Type" htmlFor="inv-type">
        <select id="inv-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {isStock ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol" htmlFor="inv-ticker" hint="e.g. VAS or AAPL">
              <input id="inv-ticker" className={inputClass} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="VAS" autoComplete="off" />
            </Field>
            <Field label="Market" htmlFor="inv-market">
              <select id="inv-market" className={inputClass} value={market} onChange={(e) => setMarket(e.target.value as "ASX" | "WALL_ST")}>
                <option value="ASX">{MARKET_TITLES.ASX} (A$)</option>
                <option value="WALL_ST">{MARKET_TITLES.WALL_ST} (US$)</option>
              </select>
            </Field>
          </div>
          <Field label="Name" htmlFor="inv-name" hint="e.g. “Vanguard Australian Shares ETF”">
            <input id="inv-name" required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Units" htmlFor="inv-units">
              <input id="inv-units" inputMode="decimal" className={inputClass} value={units} onChange={(e) => setUnits(e.target.value)} placeholder="0" />
            </Field>
            <Field label={isUs ? "Purchase Price (US$)" : "Purchase Price"} htmlFor="inv-price">
              <input id="inv-price" inputMode="decimal" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={isUs ? "Market Price (US$)" : "Market Price"} htmlFor="inv-mkt-price" hint="Read-only">
              <input id="inv-mkt-price" className={inputClass} value="" placeholder="—" readOnly aria-readonly="true" tabIndex={-1} />
            </Field>
            <Field label={isUs ? "Market Value (US$)" : "Market Value"} htmlFor="inv-mkt-value" hint="Read-only">
              <input id="inv-mkt-value" className={inputClass} value="" placeholder="—" readOnly aria-readonly="true" tabIndex={-1} />
            </Field>
          </div>
          {isUs && (
            <Field label="Exchange rate (A$ per US$)" htmlFor="inv-fx" hint="e.g. 1.44 — used to show the value in Australian dollars.">
              <input id="inv-fx" inputMode="decimal" className={inputClass} value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="1.44" />
            </Field>
          )}
          <Field label="Price as at" htmlFor="inv-asat" hint="The date of the purchase price.">
            <input id="inv-asat" type="date" className={inputClass} value={asAt} onChange={(e) => setAsAt(e.target.value)} />
          </Field>
          {value && (
            <p className="text-sm bg-[var(--color-paper-dim)] rounded-lg px-3 py-2" aria-live="polite">
              Purchase Value: <span className="font-medium">{isUs ? formatUsd(value.own) : formatMoney(value.own)}</span>
              {isUs && value.aud !== null && (
                <>
                  {" "}
                  · <span className="font-medium">{formatMoney(value.aud)}</span>
                </>
              )}
            </p>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" htmlFor="inv-name" hint="e.g. “Term deposit — ANZ”">
            <input id="inv-name" required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Code (optional)" htmlFor="inv-ticker">
            <input id="inv-ticker" className={inputClass} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
          </Field>
        </div>
      )}

      <Field label="Notes (optional)" htmlFor="inv-notes">
        <textarea id="inv-notes" rows={2} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Add investment"}
        </Button>
      </div>
    </form>
  );
}
