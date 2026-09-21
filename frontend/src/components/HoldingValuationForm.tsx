import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Investment } from "../api/types";
import { Button, Field, inputClass } from "./ui";
import { formatUsd } from "../lib/holdings";
import { formatMoney, toInputDate } from "../lib/format";

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));

/** Record how many units you hold and their price on a date — the values shown in the holdings table. */
export function HoldingValuationForm({ investment, onSaved, onCancel }: { investment: Investment; onSaved: () => void; onCancel: () => void }) {
  const isUs = investment.currency === "USD";
  const h = investment.holding;
  const [asAt, setAsAt] = useState(toInputDate(new Date()));
  const [units, setUnits] = useState(h ? String(h.units) : "");
  const [price, setPrice] = useState(h ? String(h.marketPrice) : "");
  const [fxRate, setFxRate] = useState(h && isUs && h.marketValue > 0 ? String(Math.round((h.marketValueAud / h.marketValue) * 10000) / 10000) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const u = num(units);
  const p = num(price);
  const own = u !== null && p !== null && !Number.isNaN(u) && !Number.isNaN(p) ? Math.round(u * p * 100) / 100 : null;
  const rate = num(fxRate);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (u === null || p === null || Number.isNaN(u) || Number.isNaN(p) || u < 0 || p < 0) return setError("Please enter the units and the market price as numbers.");
    if (isUs && (!rate || rate <= 0)) return setError("Please enter the exchange rate (A$ per US$).");
    setSaving(true);
    try {
      await api.put(`/investments/${investment.id}/valuation`, { asAt, units: u, marketPrice: p, ...(isUs ? { fxRate: rate } : {}) });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save this. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{error}</p>}
      <Field label="As at" htmlFor="hv-asat">
        <input id="hv-asat" type="date" className={inputClass} value={asAt} onChange={(e) => setAsAt(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Units" htmlFor="hv-units">
          <input id="hv-units" inputMode="decimal" className={inputClass} value={units} onChange={(e) => setUnits(e.target.value)} />
        </Field>
        <Field label={isUs ? "Mkt. Price (US$)" : "Mkt. Price"} htmlFor="hv-price">
          <input id="hv-price" inputMode="decimal" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      {isUs && (
        <Field label="Exchange rate (A$ per US$)" htmlFor="hv-fx">
          <input id="hv-fx" inputMode="decimal" className={inputClass} value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
        </Field>
      )}
      {own !== null && (
        <p className="text-sm bg-[var(--color-paper-dim)] rounded-lg px-3 py-2" aria-live="polite">
          Mkt. Value: <span className="font-medium">{isUs ? formatUsd(own) : formatMoney(own)}</span>
          {isUs && rate && rate > 0 && (
            <>
              {" "}
              · <span className="font-medium">{formatMoney(Math.round(own * rate * 100) / 100)}</span>
            </>
          )}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save holding"}
        </Button>
      </div>
    </form>
  );
}
