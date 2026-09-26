import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Investment } from "../api/types";
import { Button, Field, inputClass } from "./ui";
import { formatUsd } from "../lib/holdings";
import { formatMoney, toInputDate } from "../lib/format";

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));

/**
 * Record how many units you hold, what you paid, and when — the same information "Add an investment"
 * collects for shares. Brokerage is kept in sync with this holding's single opening BUY transaction
 * on the backend (see PUT /investments/:id/valuation), so it flows into cost base and unrealised
 * gain/loss like any other purchase — unless the investment already has more than one transaction
 * of its own, in which case the backend leaves that trade history alone.
 */
export function HoldingValuationForm({ investment, onSaved, onCancel }: { investment: Investment; onSaved: () => void; onCancel: () => void }) {
  const isUs = investment.currency === "USD";
  const h = investment.holding;
  const [asAt, setAsAt] = useState(toInputDate(new Date()));
  const [units, setUnits] = useState(h ? String(h.units) : "");
  const [price, setPrice] = useState(h ? String(h.marketPrice) : "");
  const [brokerage, setBrokerage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const u = num(units);
  const p = num(price);
  const b = num(brokerage);
  const own = u !== null && p !== null && !Number.isNaN(u) && !Number.isNaN(p) ? Math.round((u * p + (b !== null && !Number.isNaN(b) ? b : 0)) * 100) / 100 : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (u === null || p === null || Number.isNaN(u) || Number.isNaN(p) || u < 0 || p < 0) return setError("Please enter the units and the purchase price as numbers.");
    if (b !== null && Number.isNaN(b)) return setError("Please enter brokerage fees as a number.");
    if (b !== null && b < 0) return setError("Brokerage fees can't be negative.");
    if (b !== null && b > 0 && (u === 0 || p === 0)) return setError("Please enter units and a purchase price greater than zero to record brokerage fees.");
    setSaving(true);
    try {
      await api.put(`/investments/${investment.id}/valuation`, { asAt, units: u, marketPrice: p, brokerage: b ?? 0 });
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Units" htmlFor="hv-units">
          <input id="hv-units" inputMode="decimal" className={inputClass} value={units} onChange={(e) => setUnits(e.target.value)} />
        </Field>
        <Field label={isUs ? "Purchase Price (US$)" : "Purchase Price"} htmlFor="hv-price">
          <input id="hv-price" inputMode="decimal" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Purchase Date" htmlFor="hv-asat" hint="The date you acquired this investment.">
          <input id="hv-asat" type="date" className={inputClass} value={asAt} onChange={(e) => setAsAt(e.target.value)} />
        </Field>
        <Field label={isUs ? "Brokerage fees (US$)" : "Brokerage fees"} htmlFor="hv-brokerage" hint="Optional — included in your cost base.">
          <input id="hv-brokerage" inputMode="decimal" className={inputClass} value={brokerage} onChange={(e) => setBrokerage(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      {own !== null && (
        <p className="text-sm bg-[var(--color-paper-dim)] rounded-lg px-3 py-2" aria-live="polite">
          Purchase Value: <span className="font-medium">{isUs ? formatUsd(own) : formatMoney(own)}</span>
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
