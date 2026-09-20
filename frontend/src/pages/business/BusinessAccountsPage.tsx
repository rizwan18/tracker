import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { LedgerAccount, LedgerGroup, LedgerType } from "../../api/businessTypes";
import { useBusinessBasics } from "../../hooks/useBusiness";
import { Button, Card, Field, SectionHeading, inputClass } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { formatCents } from "../../lib/money";

const TYPE_ORDER: Array<{ type: LedgerType; label: string; help: string }> = [
  { type: "ASSET", label: "Assets", help: "What the business owns: bank accounts, money owed to you, equipment, vehicles." },
  { type: "LIABILITY", label: "Liabilities", help: "What the business owes: bills, GST, loans, credit cards." },
  { type: "EQUITY", label: "Equity", help: "The owners' stake: money put in, profits kept, drawings taken out." },
  { type: "INCOME", label: "Income", help: "Categories for money the business earns." },
  { type: "EXPENSE", label: "Expenses", help: "Categories for money the business spends." },
];

const GROUPS: Record<LedgerType, Array<{ value: LedgerGroup; label: string }>> = {
  ASSET: [{ value: "CURRENT_ASSET", label: "Current asset (cash, stock, money owed to you)" }, { value: "NON_CURRENT_ASSET", label: "Fixed asset (equipment, vehicles)" }],
  LIABILITY: [{ value: "CURRENT_LIABILITY", label: "Current liability (due within a year)" }, { value: "NON_CURRENT_LIABILITY", label: "Long-term liability" }],
  EQUITY: [{ value: "EQUITY", label: "Equity" }],
  INCOME: [{ value: "REVENUE", label: "Revenue (sales and services)" }, { value: "OTHER_INCOME", label: "Other income" }],
  EXPENSE: [{ value: "COST_OF_SALES", label: "Cost of sales (direct costs)" }, { value: "OPERATING_EXPENSE", label: "Operating expense" }],
};

function AddAccountForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [type, setType] = useState<LedgerType>("EXPENSE");
  const [group, setGroup] = useState<LedgerGroup>("OPERATING_EXPENSE");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isBank, setIsBank] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function chooseType(t: LedgerType) {
    setType(t);
    setGroup(GROUPS[t][0]!.value);
    if (t !== "ASSET" && t !== "LIABILITY") setIsBank(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim() || !name.trim()) return setError("Please enter a code and a name.");
    setSaving(true);
    try {
      await api.post("/business/accounts", { code: code.trim(), name: name.trim(), type, group, isBank });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't add this account. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{error}</p>}
      <Field label="Type" htmlFor="ac-type">
        <select id="ac-type" className={inputClass} value={type} onChange={(e) => chooseType(e.target.value as LedgerType)}>
          {TYPE_ORDER.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Group" htmlFor="ac-group">
        <select id="ac-group" className={inputClass} value={group} onChange={(e) => setGroup(e.target.value as LedgerGroup)}>
          {GROUPS[type].map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Code" htmlFor="ac-code" hint="e.g. 6200">
          <input id="ac-code" className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Name" htmlFor="ac-name">
            <input id="ac-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pest control" />
          </Field>
        </div>
      </div>
      {(type === "ASSET" || type === "LIABILITY") && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isBank} onChange={(e) => setIsBank(e.target.checked)} className="w-4 h-4 accent-[var(--color-eucalyptus)]" />
          This is a bank, cash or credit card account (sales and expenses can be paid to/from it)
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Adding…" : "Add account"}</Button>
      </div>
    </form>
  );
}

/** The chart of accounts: every category the books use, with its balance. */
export default function BusinessAccountsPage() {
  const { accounts, loading, error, reload } = useBusinessBasics();
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That didn't work. Please try again.");
    }
  }

  const rename = (a: LedgerAccount) => {
    const name = window.prompt("New name for this account", a.name);
    if (name && name.trim() && name.trim() !== a.name) run(() => api.patch(`/business/accounts/${a.id}`, { name: name.trim() }));
  };
  const remove = (a: LedgerAccount) => {
    if (confirm(`Delete “${a.name}”?`)) run(() => api.delete(`/business/accounts/${a.id}`));
  };

  if (loading) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;
  if (error) return <p role="alert" className="text-[var(--color-brick)]">{error}</p>;

  return (
    <div className="space-y-6">
      <SectionHeading title="Accounts" subtitle="Your chart of accounts — the categories your books use. Balances are as at today." action={<Button onClick={() => setAdding(true)}>+ Add account</Button>} />
      {actionError && <p role="alert" className="text-sm text-[var(--color-brick)]">{actionError}</p>}

      {TYPE_ORDER.map(({ type, label, help }) => {
        const rows = accounts.filter((a) => a.type === type);
        return (
          <section key={type}>
            <h3 className="font-display font-semibold">{label}</h3>
            <p className="text-sm text-[var(--color-ink-soft)] mb-2">{help}</p>
            <Card className="p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]">
                {rows.map((a) => (
                  <li key={a.id} className={`flex items-center gap-3 px-5 py-2.5 ${a.isActive ? "" : "opacity-60"}`}>
                    <span className="w-14 text-sm text-[var(--color-ink-soft)] tabular-nums">{a.code}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {a.name}
                        {a.isBank && <span className="ml-2 text-[11px] rounded-full px-2 py-0.5 bg-[var(--color-sky-tint)] text-[#264a5c]">bank / card</span>}
                        {a.isSystem && <span className="ml-2 text-[11px] rounded-full px-2 py-0.5 bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]">used by the app</span>}
                        {!a.isActive && <span className="ml-2 text-[11px] text-[var(--color-ink-soft)]">switched off</span>}
                      </p>
                    </div>
                    <span className="tabular-nums text-sm font-medium w-28 text-right">{a.type === "INCOME" || a.type === "EXPENSE" ? "" : formatCents(a.balanceCents)}</span>
                    <div className="flex gap-1 w-40 justify-end">
                      <button onClick={() => rename(a)} className="text-xs text-[var(--color-sky)] px-2 py-1 hover:underline">Rename</button>
                      {!a.isSystem && (
                        <button onClick={() => run(() => api.patch(`/business/accounts/${a.id}`, { isActive: !a.isActive }))} className="text-xs text-[var(--color-ink-soft)] px-2 py-1 hover:underline">
                          {a.isActive ? "Switch off" : "Switch on"}
                        </button>
                      )}
                      {!a.isSystem && !a.hasActivity && (
                        <button onClick={() => remove(a)} className="text-xs text-[var(--color-brick)] px-2 py-1 hover:underline">Delete</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        );
      })}

      {adding && (
        <Modal title="Add an account" onClose={() => setAdding(false)}>
          <AddAccountForm
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
