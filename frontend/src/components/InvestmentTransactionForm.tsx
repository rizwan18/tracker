import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { BrokerAccountSelect } from "./BrokerAccountSelect";
import { Button, Field, inputClass } from "./ui";
import { toInputDate } from "../lib/format";

export function InvestmentTransactionForm({ investmentId, onSaved, onCancel }: { investmentId: string; onSaved: () => void; onCancel: () => void }) {
  const [type, setType] = useState<"BUY" | "SELL">("BUY");
  const [date, setDate] = useState(toInputDate(new Date()));
  const [quantity, setQuantity] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [brokerage, setBrokerage] = useState("0");
  const [brokerAccountId, setBrokerAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!quantity || Number(quantity) <= 0) return setError("Please enter a quantity greater than zero.");
    if (!pricePerUnit || Number(pricePerUnit) <= 0) return setError("Please enter a price greater than zero.");
    setSaving(true);
    try {
      await api.post(`/investments/${investmentId}/transactions`, {
        type,
        date,
        quantity: Number(quantity),
        pricePerUnit: Number(pricePerUnit),
        brokerage: Number(brokerage || 0),
        brokerAccountId: brokerAccountId || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save this transaction. Please check the details and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{error}</p>}
      <div className="flex rounded-xl border border-[var(--color-line)] p-1">
        {(["BUY", "SELL"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium ${type === t ? "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]" : "text-[var(--color-ink-soft)]"}`}
          >
            {t === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <Field label="Date" htmlFor="itx-date">
        <input id="itx-date" type="date" required className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity" htmlFor="itx-qty">
          <input id="itx-qty" type="number" min="0" step="any" required className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Price per unit" htmlFor="itx-price">
          <input id="itx-price" type="number" min="0" step="0.0001" required className={inputClass} value={pricePerUnit} onChange={(e) => setPricePerUnit(e.target.value)} />
        </Field>
      </div>
      <Field label="Brokerage" htmlFor="itx-brokerage">
        <input id="itx-brokerage" type="number" min="0" step="0.01" className={inputClass} value={brokerage} onChange={(e) => setBrokerage(e.target.value)} />
      </Field>
      <Field label="Broker account" htmlFor="itx-broker">
        <BrokerAccountSelect id="itx-broker" value={brokerAccountId} onChange={setBrokerAccountId} />
      </Field>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : `Add ${type === "BUY" ? "buy" : "sell"}`}
        </Button>
      </div>
    </form>
  );
}
