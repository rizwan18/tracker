import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { BusinessEntry, BusinessProfile, LedgerAccount } from "../../api/businessTypes";
import { Button, Field, inputClass } from "../ui";
import { centsToInput, computeGst, formatCents, toCents, type GstMode } from "../../lib/money";
import { toInputDate } from "../../lib/format";

const GST_LABELS: Record<GstMode, string> = { INCLUSIVE: "Includes GST", EXCLUSIVE: "Plus GST", FREE: "No GST" };

function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Record a sale (income) or an expense. GST is worked out for you when the business
 * is registered. Choose "Not paid yet" for an invoice you've sent or a bill you owe.
 */
export function BusinessEntryForm({
  kind,
  initial,
  profile,
  accounts,
  defaultDate,
  onSaved,
  onCancel,
}: {
  kind: "INCOME" | "EXPENSE";
  initial?: BusinessEntry;
  profile: BusinessProfile;
  accounts: LedgerAccount[];
  defaultDate: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isSale = kind === "INCOME";
  const active = accounts.filter((a) => a.isActive);
  const categories = active.filter((a) => (isSale ? a.type === "INCOME" : a.type === "EXPENSE"));
  const assetCategories = isSale ? [] : active.filter((a) => a.type === "ASSET" && !a.isSystem && !a.isBank);
  const banks = active.filter((a) => a.isBank);

  const [date, setDate] = useState(initial ? toInputDate(initial.date) : defaultDate);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [contactName, setContactName] = useState(initial?.contactName ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [accountId, setAccountId] = useState(initial?.account.id ?? "");
  const [amount, setAmount] = useState(initial ? centsToInput(initial.gstMode === "EXCLUSIVE" ? initial.netCents : initial.totalCents) : "");
  const [gstMode, setGstMode] = useState<GstMode>(initial?.gstMode ?? "INCLUSIVE");
  const [status, setStatus] = useState<"PAID" | "UNPAID">(initial?.status ?? "PAID");
  const [paidDate, setPaidDate] = useState(initial?.paidDate ? toInputDate(initial.paidDate) : initial ? "" : defaultDate);
  const [bankAccountId, setBankAccountId] = useState(initial?.bankAccount?.id ?? banks.find((b) => b.type === "ASSET")?.id ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ? toInputDate(initial.dueDate) : addDays(defaultDate, 14));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cents = toCents(amount);
  const preview = useMemo(() => (cents && cents > 0 ? computeGst(cents, gstMode, profile.gstRegistered) : null), [cents, gstMode, profile.gstRegistered]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim()) return setError("Please describe it.");
    if (!accountId) return setError(isSale ? "Please choose an income category." : "Please choose an expense category.");
    if (!cents || cents <= 0) return setError("Please enter an amount greater than zero.");
    if (status === "PAID" && !bankAccountId) return setError("Please choose the bank account.");
    setSaving(true);
    try {
      const body = {
        kind,
        date,
        dueDate: status === "UNPAID" ? dueDate || null : null,
        description: description.trim(),
        contactName: contactName.trim() || null,
        reference: reference.trim() || null,
        accountId,
        amountCents: cents,
        gstMode: profile.gstRegistered ? gstMode : "FREE",
        status,
        paidDate: status === "PAID" ? paidDate || date : null,
        bankAccountId: status === "PAID" ? bankAccountId : null,
        notes: notes.trim() || null,
      };
      if (initial) await api.put(`/business/entries/${initial.id}`, body);
      else await api.post("/business/entries", body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save this. Please check the details and try again.");
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

      <div className="grid grid-cols-2 gap-3">
        <Field label={isSale ? "Invoice / sale date" : "Bill / expense date"} htmlFor="be-date">
          <input id="be-date" type="date" required className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={isSale ? "Invoice number" : "Bill / receipt number"} htmlFor="be-ref" hint="Optional.">
          <input id="be-ref" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <Field label="Description" htmlFor="be-desc">
        <input id="be-desc" className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={isSale ? "e.g. Website design — stage 1" : "e.g. Office rent — October"} />
      </Field>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={isSale ? "Customer" : "Supplier"} htmlFor="be-contact" hint="Optional.">
          <input id="be-contact" className={inputClass} value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </Field>
        <Field label="Category" htmlFor="be-account">
          <select id="be-account" className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            <optgroup label={isSale ? "Income" : "Expenses"}>
              {categories.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
            {assetCategories.length > 0 && (
              <optgroup label="Things you're buying to keep (assets)">
                {assetCategories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Amount" htmlFor="be-amount">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-soft)]">$</span>
            <input id="be-amount" inputMode="decimal" className={`${inputClass} pl-7`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
        </Field>
        {profile.gstRegistered && (
          <Field label="GST" htmlFor="be-gst">
            <select id="be-gst" className={inputClass} value={gstMode} onChange={(e) => setGstMode(e.target.value as GstMode)}>
              {(Object.keys(GST_LABELS) as GstMode[]).map((m) => (
                <option key={m} value={m}>
                  {GST_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {preview && profile.gstRegistered && (
        <p className="text-sm bg-[var(--color-paper-dim)] rounded-lg px-3 py-2" aria-live="polite">
          Before GST <span className="font-medium">{formatCents(preview.netCents)}</span> · GST <span className="font-medium">{formatCents(preview.gstCents)}</span> · Total{" "}
          <span className="font-medium">{formatCents(preview.totalCents)}</span>
        </p>
      )}
      {!profile.gstRegistered && <p className="text-xs text-[var(--color-ink-soft)]">Your business isn't set up as registered for GST, so no GST is added or claimed. You can change this in Settings.</p>}

      <fieldset>
        <legend className="block text-sm font-medium mb-1">{isSale ? "Has the customer paid?" : "Have you paid it?"}</legend>
        <div className="flex gap-2">
          {(["PAID", "UNPAID"] as const).map((s) => (
            <label key={s} className={`flex-1 cursor-pointer rounded-xl border-2 px-3 py-2 text-sm ${status === s ? "border-[var(--color-eucalyptus)] bg-[var(--color-eucalyptus-tint)]" : "border-[var(--color-line)]"}`}>
              <input type="radio" name="be-status" className="sr-only" checked={status === s} onChange={() => setStatus(s)} />
              {s === "PAID" ? (isSale ? "Yes — money received" : "Yes — already paid") : isSale ? "Not yet — invoice sent" : "Not yet — bill to pay"}
            </label>
          ))}
        </div>
      </fieldset>

      {status === "PAID" ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={isSale ? "Date received" : "Date paid"} htmlFor="be-paid">
            <input id="be-paid" type="date" className={inputClass} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
          <Field label={isSale ? "Paid into" : "Paid from"} htmlFor="be-bank">
            <select id="be-bank" className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">Choose…</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : (
        <Field label="Due date" htmlFor="be-due">
          <input id="be-due" type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      )}

      <Field label="Notes" htmlFor="be-notes" hint="Optional.">
        <textarea id="be-notes" rows={2} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : isSale ? "Save sale" : "Save expense"}
        </Button>
      </div>
    </form>
  );
}

/** Marks an invoice or bill as paid. */
export function MarkPaidForm({ entry, accounts, defaultDate, onSaved, onCancel }: { entry: BusinessEntry; accounts: LedgerAccount[]; defaultDate: string; onSaved: () => void; onCancel: () => void }) {
  const banks = accounts.filter((a) => a.isActive && a.isBank);
  const [paidDate, setPaidDate] = useState(defaultDate);
  const [bankAccountId, setBankAccountId] = useState(banks.find((b) => b.type === "ASSET")?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isSale = entry.kind === "INCOME";

  async function save() {
    if (!bankAccountId) return setError("Please choose the bank account.");
    setSaving(true);
    try {
      await api.post(`/business/entries/${entry.id}/pay`, { paidDate, bankAccountId });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't record this payment. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-ink-soft)]">
        {entry.description} — <span className="font-medium text-[var(--color-ink)]">{formatCents(entry.totalCents)}</span>
      </p>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-brick)]">
          {error}
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={isSale ? "Date received" : "Date paid"} htmlFor="mp-date">
          <input id="mp-date" type="date" className={inputClass} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </Field>
        <Field label={isSale ? "Paid into" : "Paid from"} htmlFor="mp-bank">
          <select id="mp-bank" className={inputClass} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Mark as paid"}
        </Button>
      </div>
    </div>
  );
}
