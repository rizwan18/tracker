import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { LedgerAccount, ManualJournal } from "../../api/businessTypes";
import { useFinancialYear } from "../../context/FinancialYearContext";
import { useBusinessBasics } from "../../hooks/useBusiness";
import { Button, Card, EmptyState, Field, SectionHeading, inputClass } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { defaultEntryDate, formatDate } from "../../lib/format";
import { formatCents, toCents } from "../../lib/money";

interface Preset {
  label: string;
  description: string;
  debit: string; // account code, or "BANK"
  credit: string;
  help: string;
}

const PRESETS: Preset[] = [
  { label: "Owner puts money in", description: "Owner's contribution", debit: "BANK", credit: "3000", help: "Cash the owners or shareholders put into the business." },
  { label: "Owner takes money out", description: "Owner's drawings", debit: "3200", credit: "BANK", help: "Drawings or dividends paid to the owners." },
  { label: "Opening bank balance", description: "Opening balance", debit: "BANK", credit: "3100", help: "Money already in the bank when you start using this app." },
  { label: "Loan received", description: "Loan received", debit: "BANK", credit: "2500", help: "Money borrowed and paid into the bank." },
  { label: "Loan repayment", description: "Loan repayment", debit: "2500", credit: "BANK", help: "Principal repaid on a loan (interest is an expense)." },
  { label: "Depreciation", description: "Depreciation of equipment", debit: "6040", credit: "1510", help: "Writing down the value of equipment over time." },
];

interface LineDraft {
  accountId: string;
  debit: string;
  credit: string;
}

function JournalForm({ accounts, defaultDate, onSaved, onCancel }: { accounts: LedgerAccount[]; defaultDate: string; onSaved: () => void; onCancel: () => void }) {
  // Receivables/payables are driven by sales and bills, so they aren't offered here.
  const usable = accounts.filter((a) => a.isActive && !(a.isSystem && (a.code === "1100" || a.code === "2000")));
  const byCode = (code: string) => (code === "BANK" ? usable.find((a) => a.isBank && a.type === "ASSET") : usable.find((a) => a.code === code));

  const [advanced, setAdvanced] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState("");
  const [debitId, setDebitId] = useState("");
  const [creditId, setCreditId] = useState("");
  const [amount, setAmount] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function applyPreset(p: Preset) {
    setDescription(p.description);
    setDebitId(byCode(p.debit)?.id ?? "");
    setCreditId(byCode(p.credit)?.id ?? "");
    setAdvanced(false);
  }

  const sums = lines.reduce(
    (t, l) => ({ debit: t.debit + (toCents(l.debit) ?? 0), credit: t.credit + (toCents(l.credit) ?? 0) }),
    { debit: 0, credit: 0 }
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim()) return setError("Please describe the entry.");
    let payloadLines: Array<{ accountId: string; debitCents: number; creditCents: number }>;
    if (advanced) {
      payloadLines = lines
        .filter((l) => l.accountId || l.debit || l.credit)
        .map((l) => ({ accountId: l.accountId, debitCents: toCents(l.debit) ?? 0, creditCents: toCents(l.credit) ?? 0 }));
      if (payloadLines.some((l) => !l.accountId)) return setError("Choose an account for every line.");
      if (sums.debit !== sums.credit) return setError(`The entry doesn't balance — debits ${formatCents(sums.debit)} vs credits ${formatCents(sums.credit)}.`);
    } else {
      const cents = toCents(amount);
      if (!debitId || !creditId) return setError("Choose both accounts.");
      if (debitId === creditId) return setError("Choose two different accounts.");
      if (!cents || cents <= 0) return setError("Enter an amount greater than zero.");
      payloadLines = [
        { accountId: debitId, debitCents: cents, creditCents: 0 },
        { accountId: creditId, debitCents: 0, creditCents: cents },
      ];
    }
    setSaving(true);
    try {
      await api.post("/business/journals", { date, description: description.trim(), lines: payloadLines });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save this entry. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const options = (
    <>
      <option value="">Choose…</option>
      {(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const).map((t) => (
        <optgroup key={t} label={t[0] + t.slice(1).toLowerCase() + (t === "INCOME" || t === "EXPENSE" ? "" : "s")}>
          {usable.filter((a) => a.type === t).map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <p className="text-sm font-medium mb-1">Start from a common entry</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" title={p.help} onClick={() => applyPreset(p)} className="rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--color-paper-dim)] hover:brightness-95">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="jf-date">
          <input id="jf-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="jf-desc">
          <input id="jf-desc" className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>

      {!advanced ? (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Debit (where the value goes to)" htmlFor="jf-debit">
              <select id="jf-debit" className={inputClass} value={debitId} onChange={(e) => setDebitId(e.target.value)}>{options}</select>
            </Field>
            <Field label="Credit (where the value comes from)" htmlFor="jf-credit">
              <select id="jf-credit" className={inputClass} value={creditId} onChange={(e) => setCreditId(e.target.value)}>{options}</select>
            </Field>
          </div>
          <Field label="Amount" htmlFor="jf-amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-soft)]">$</span>
              <input id="jf-amount" inputMode="decimal" className={`${inputClass} pl-7`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          </Field>
        </div>
      ) : (
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_6rem] gap-2">
              <select aria-label={`Line ${i + 1} account`} className={inputClass} value={l.accountId} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>{options}</select>
              <input aria-label={`Line ${i + 1} debit`} inputMode="decimal" placeholder="Debit" className={inputClass} value={l.debit} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, debit: e.target.value } : x)))} />
              <input aria-label={`Line ${i + 1} credit`} inputMode="decimal" placeholder="Credit" className={inputClass} value={l.credit} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, credit: e.target.value } : x)))} />
            </div>
          ))}
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={() => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "" }])} className="text-[var(--color-sky)] hover:underline">+ Add a line</button>
            <span className={sums.debit === sums.credit && sums.debit > 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-ink-soft)]"} aria-live="polite">
              Debits {formatCents(sums.debit)} · Credits {formatCents(sums.credit)}
            </span>
          </div>
        </div>
      )}

      <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs text-[var(--color-ink-soft)] underline">
        {advanced ? "Use the simple two-account form" : "Use several lines (advanced)"}
      </button>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save entry"}</Button>
      </div>
    </form>
  );
}

/** Adjustments that aren't sales or bills: owner money, loans, depreciation, opening balances… */
export default function BusinessJournalPage() {
  const { financialYearId } = useFinancialYear();
  const { accounts, loading: basicsLoading } = useBusinessBasics();
  const [items, setItems] = useState<ManualJournal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: ManualJournal[] }>(`/business/journals?financialYear=${financialYearId}`);
      setItems(res.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load these entries.");
    }
  }, [financialYearId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function remove(j: ManualJournal) {
    if (!confirm(`Delete “${j.description}”?`)) return;
    await api.delete(`/business/journals/${j.id}`);
    load();
  }

  if (loading || basicsLoading) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;

  return (
    <div className="space-y-6">
      <SectionHeading title="Journal" subtitle={`Adjustments that aren't sales or bills · ${financialYearId} financial year`} action={<Button onClick={() => setAdding(true)}>+ New entry</Button>} />
      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}

      {items.length === 0 ? (
        <EmptyState
          title="No journal entries yet"
          description="Use these for money the owners put in or take out, loans, depreciation and opening balances. Every entry has a debit and a credit of the same amount."
          action={<Button onClick={() => setAdding(true)}>+ New entry</Button>}
        />
      ) : (
        <div className="space-y-3">
          {items.map((j) => (
            <Card key={j.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{j.description}</p>
                  <p className="text-xs text-[var(--color-ink-soft)]">{formatDate(j.date)}{j.reference ? ` · ${j.reference}` : ""}</p>
                </div>
                <button onClick={() => remove(j)} className="text-xs text-[var(--color-brick)] px-2 py-1 hover:underline">Delete</button>
              </div>
              <table className="w-full text-sm mt-3">
                <thead className="text-left text-xs text-[var(--color-ink-soft)]">
                  <tr><th className="font-medium py-1">Account</th><th className="font-medium py-1 text-right">Debit</th><th className="font-medium py-1 text-right">Credit</th></tr>
                </thead>
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i} className="border-t border-[var(--color-line)]">
                      <td className="py-1.5">{l.accountCode} {l.accountName}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.debitCents ? formatCents(l.debitCents) : ""}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.creditCents ? formatCents(l.creditCents) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}

      {adding && (
        <Modal title="New journal entry" onClose={() => setAdding(false)}>
          <JournalForm
            accounts={accounts}
            defaultDate={defaultEntryDate(financialYearId)}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
