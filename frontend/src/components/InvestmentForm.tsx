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
 * (Symbol, Name, market, Units, Purchase Price, Purchase Date, Brokerage fees); everything else keeps the simple form.
 * When units + purchase price are given, this also records the initial buy (see handleSubmit) so
 * brokerage fees are incorporated into cost base the same way any other buy/sell transaction is.
 */
export function InvestmentForm({ onSaved, onCancel, defaultType = "SHARE" }: { onSaved: () => void; onCancel: () => void; defaultType?: string }) {
  const [type, setType] = useState(defaultType);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [market, setMarket] = useState<"ASX" | "WALL_ST">("ASX");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [asAt, setAsAt] = useState(toInputDate(new Date()));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isStock = STOCK_TYPES.includes(type);
  const isUs = isStock && market === "WALL_ST";
  const currency = isUs ? "USD" : "AUD";

  // Purchase Value = units × price, in the market's own currency (US$ for Wall St, A$ for ASX). No conversion.
  const purchaseValue = useMemo(() => {
    const u = num(units);
    const p = num(price);
    if (u === null || p === null || Number.isNaN(u) || Number.isNaN(p)) return null;
    return Math.round(u * p * 100) / 100;
  }, [units, price]);

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
      const b = num(brokerage);
      if (b !== null && Number.isNaN(b)) return setError("Please enter brokerage fees as a number.");
      if (b !== null && b < 0) return setError("Brokerage fees can't be negative.");
      if (u !== null || p !== null) {
        if (u === null || p === null || Number.isNaN(u) || Number.isNaN(p) || u < 0 || p < 0) return setError("Please enter the units and the purchase price as numbers.");
        body.valuation = { asAt, units: u, marketPrice: p };
        // Only a genuine purchase (units and price both greater than zero) can become a buy
        // transaction — otherwise brokerage would have nothing to attach its cost base to.
        if (u > 0 && p > 0) {
          body.initialTransaction = { date: asAt, quantity: u, pricePerUnit: p, brokerage: b ?? 0 };
        } else if (b !== null && b > 0) {
          return setError("Please enter units and a purchase price greater than zero to record brokerage fees.");
        }
      } else if (b !== null && b > 0) {
        return setError("Please enter units and a purchase price to record brokerage fees.");
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
            <Field label="Purchase Date" htmlFor="inv-asat" hint="The date you acquired this investment.">
              <input id="inv-asat" type="date" className={inputClass} value={asAt} onChange={(e) => setAsAt(e.target.value)} />
            </Field>
            <Field label={isUs ? "Brokerage fees (US$)" : "Brokerage fees"} htmlFor="inv-brokerage" hint="Optional — included in your cost base.">
              <input id="inv-brokerage" inputMode="decimal" className={inputClass} value={brokerage} onChange={(e) => setBrokerage(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
          {purchaseValue !== null && (
            <p className="text-sm bg-[var(--color-paper-dim)] rounded-lg px-3 py-2" aria-live="polite">
              Purchase Value: <span className="font-medium">{isUs ? formatUsd(purchaseValue) : formatMoney(purchaseValue)}</span>
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
