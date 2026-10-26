import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { Button, Field, inputClass } from "./ui";
import { Modal } from "./Modal";
import { BrokerAccountSelect } from "./BrokerAccountSelect";
import { formatLineMoney, validateTransactionEdit, type TransactionEditErrors as Errors, type TransactionLine } from "../lib/transactions";
import type { Currency } from "../lib/pnl";

export interface EditableSecurity {
  id: string;
  label: string;
  currency: Currency;
}

/**
 * Correct any field of a recorded transaction: security, date, type, units, price, brokerage and broker account.
 * Saved to the database, where holdings, cost base and gains are recomputed. If saving fails, everything the person typed is
 * kept and the reason is shown; the Save button is disabled while a save is in flight so it can't be submitted twice.
 */
export function EditTransactionDialog({ line, securities, onSaved, onClose }: { line: TransactionLine; securities: EditableSecurity[]; onSaved: () => void; onClose: () => void }) {
  const [investmentId, setInvestmentId] = useState(line.investmentId);
  const [date, setDate] = useState(line.date.slice(0, 10));
  const [type, setType] = useState<"BUY" | "SELL">(line.type);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [price, setPrice] = useState(String(line.pricePerUnit));
  const [brokerage, setBrokerage] = useState(String(line.brokerage));
  const [brokerAccountId, setBrokerAccountId] = useState(line.brokerAccountId ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currency = securities.find((s) => s.id === investmentId)?.currency ?? line.currency;
  const q = Number(quantity);
  const p = Number(price);
  const b = brokerage.trim() === "" ? 0 : Number(brokerage);
  const total = Number.isFinite(q) && Number.isFinite(p) && Number.isFinite(b) && q > 0 && p > 0 ? (type === "BUY" ? q * p + b : q * p - b) : null;
  const changed =
    investmentId !== line.investmentId ||
    date !== line.date.slice(0, 10) ||
    type !== line.type ||
    q !== line.quantity ||
    p !== line.pricePerUnit ||
    b !== line.brokerage ||
    (brokerAccountId || null) !== line.brokerAccountId;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = validateTransactionEdit({ investmentId, date, quantity, price, brokerage });
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await api.put(`/investments/transactions/${line.id}`, { investmentId, type, date, quantity: q, pricePerUnit: p, brokerage: b, brokerAccountId: brokerAccountId || null });
      onSaved();
    } catch (err) {
      // Keep everything the person typed; just say what went wrong.
      setServerError(err instanceof ApiError ? err.message : "We couldn't save this change. Nothing was changed — please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const err = (m?: string) =>
    m ? (
      <p role="alert" className="text-xs text-[var(--color-brick)] mt-1">
        {m}
      </p>
    ) : null;

  return (
    <Modal title="Edit transaction" onClose={saving ? () => undefined : onClose}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <Field label="Security" htmlFor="et-security">
          <select id="et-security" className={inputClass} value={investmentId} onChange={(e) => setInvestmentId(e.target.value)}>
            {securities.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {err(errors.security)}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="et-date">
            <input id="et-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            {err(errors.date)}
          </Field>
          <Field label="Type" htmlFor="et-type">
            <select id="et-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as "BUY" | "SELL")}>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </Field>
          <Field label="Units" htmlFor="et-qty">
            <input id="et-qty" inputMode="decimal" className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            {err(errors.quantity)}
          </Field>
          <Field label="Price per unit" htmlFor="et-price">
            <input id="et-price" inputMode="decimal" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
            {err(errors.price)}
          </Field>
          <Field label={type === "BUY" ? "Brokerage" : "Brokerage and fees"} htmlFor="et-fees">
            <input id="et-fees" inputMode="decimal" className={inputClass} value={brokerage} onChange={(e) => setBrokerage(e.target.value)} />
            {err(errors.brokerage)}
          </Field>
        </div>
        <Field label="Broker account" htmlFor="et-broker">
          <BrokerAccountSelect id="et-broker" value={brokerAccountId} onChange={setBrokerAccountId} />
        </Field>

        <p className="text-sm bg-[var(--color-paper-dim)] rounded-lg px-3 py-2" aria-live="polite">
          {total === null ? (
            "Enter units and a price to see the total."
          ) : (
            <>
              {type === "BUY" ? "Total cost (including brokerage): " : "Net proceeds (after brokerage): "}
              <strong className="tabular-nums">{formatLineMoney(total, currency)}</strong>
            </>
          )}
        </p>
        <p className="text-xs text-[var(--color-ink-soft)]">Saving recalculates the holding, its cost base and the realised and unrealised profit or loss. A change that would leave a security with fewer units than were sold is refused.</p>

        {serverError && (
          <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">
            {serverError}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !changed}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
