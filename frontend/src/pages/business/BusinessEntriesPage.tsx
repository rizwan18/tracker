import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { BusinessEntry } from "../../api/businessTypes";
import { useFinancialYear } from "../../context/FinancialYearContext";
import { useBusinessBasics } from "../../hooks/useBusiness";
import { Button, Card, EmptyState, SectionHeading, StatTile } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { BusinessEntryForm, MarkPaidForm } from "../../components/business/BusinessEntryForm";
import { defaultEntryDate, formatDate } from "../../lib/format";
import { formatCents } from "../../lib/money";

type Filter = "ALL" | "UNPAID" | "PAID";

/** Sales (kind INCOME) or expenses (kind EXPENSE) for the selected financial year. */
export default function BusinessEntriesPage({ kind }: { kind: "INCOME" | "EXPENSE" }) {
  const isSale = kind === "INCOME";
  const { financialYearId } = useFinancialYear();
  const { profile, accounts, loading: basicsLoading, error: basicsError } = useBusinessBasics();
  const [items, setItems] = useState<BusinessEntry[]>([]);
  const [totals, setTotals] = useState({ incomeCents: 0, expenseCents: 0, unpaidIncomeCents: 0, unpaidExpenseCents: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BusinessEntry | "new" | null>(null);
  const [paying, setPaying] = useState<BusinessEntry | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ kind, financialYear: financialYearId });
      if (filter !== "ALL") params.set("status", filter);
      const res = await api.get<{ items: BusinessEntry[]; totals: typeof totals }>(`/business/entries?${params.toString()}`);
      setItems(res.items);
      setTotals(res.totals);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load this list.");
    }
  }, [kind, financialYearId, filter]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function remove(e: BusinessEntry) {
    if (!confirm(`Delete “${e.description}”? This can't be undone.`)) return;
    await api.delete(`/business/entries/${e.id}`);
    load();
  }

  async function unpay(e: BusinessEntry) {
    if (!confirm("Mark this as not paid?")) return;
    await api.post(`/business/entries/${e.id}/unpay`);
    load();
  }

  if (basicsLoading) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;
  if (basicsError || !profile) return <p className="text-[var(--color-brick)]">{basicsError ?? "We couldn't load your business."}</p>;

  const today = new Date().toISOString().slice(0, 10);
  const total = isSale ? totals.incomeCents : totals.expenseCents;
  const unpaid = isSale ? totals.unpaidIncomeCents : totals.unpaidExpenseCents;

  return (
    <div className="space-y-6">
      <SectionHeading
        title={isSale ? "Sales" : "Expenses"}
        subtitle={`${profile.businessName} · ${financialYearId} financial year`}
        action={<Button onClick={() => setEditing("new")}>{isSale ? "+ New sale" : "+ New expense"}</Button>}
      />

      <div className="grid grid-cols-2 gap-3">
        <StatTile label={isSale ? "Sales (before GST)" : "Expenses (before GST)"} value={formatCents(total)} tone={isSale ? "positive" : "negative"} />
        <StatTile label={isSale ? "Waiting to be paid" : "Bills still to pay"} value={formatCents(unpaid)} tone="neutral" help={isSale ? "Invoices customers haven't paid yet (including GST)." : "Bills you haven't paid yet (including GST)."} />
      </div>

      <div className="flex rounded-xl border border-[var(--color-line)] p-1 w-fit" role="group" aria-label="Filter">
        {(["ALL", "UNPAID", "PAID"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === f ? "bg-[var(--color-eucalyptus)] text-white" : "text-[var(--color-ink-soft)]"}`}
          >
            {f === "ALL" ? "All" : f === "UNPAID" ? "Not paid" : "Paid"}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}

      {loading ? (
        <p className="text-[var(--color-ink-soft)]">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title={filter === "ALL" ? (isSale ? "No sales recorded yet" : "No expenses recorded yet") : "Nothing matches this filter"}
          description={isSale ? "Record a sale or send an invoice, and it appears in your income statement, GST report and balance sheet." : "Record what the business spends and it appears in your income statement, GST report and balance sheet."}
          action={<Button onClick={() => setEditing("new")}>{isSale ? "+ New sale" : "+ New expense"}</Button>}
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-[var(--color-line)]">
            {items.map((e) => {
              const overdue = e.status === "UNPAID" && e.dueDate && e.dueDate.slice(0, 10) < today;
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <div className="flex-1 min-w-[12rem]">
                    <p className="font-medium text-[var(--color-ink)]">{e.description}</p>
                    <p className="text-xs text-[var(--color-ink-soft)]">
                      {formatDate(e.date)} · {e.account.name}
                      {e.contactName ? ` · ${e.contactName}` : ""}
                      {e.reference ? ` · #${e.reference}` : ""}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${
                      e.status === "PAID" ? "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]" : overdue ? "bg-[var(--color-brick-tint)] text-[var(--color-brick)]" : "bg-[var(--color-ochre-tint)] text-[#7a4d1a]"
                    }`}
                  >
                    {e.status === "PAID" ? (isSale ? "Received" : "Paid") : overdue ? `Overdue · was due ${formatDate(e.dueDate!)}` : e.dueDate ? `Due ${formatDate(e.dueDate)}` : "Not paid"}
                  </span>
                  <div className="text-right shrink-0 w-28">
                    <p className={`font-medium tabular-nums ${isSale ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{formatCents(e.totalCents)}</p>
                    {e.gstCents > 0 && <p className="text-xs text-[var(--color-ink-soft)]">incl. GST {formatCents(e.gstCents)}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {e.status === "UNPAID" ? (
                      <button onClick={() => setPaying(e)} className="text-xs text-[var(--color-eucalyptus)] px-2 py-1 hover:underline">
                        Mark paid
                      </button>
                    ) : (
                      <button onClick={() => unpay(e)} className="text-xs text-[var(--color-ink-soft)] px-2 py-1 hover:underline">
                        Undo paid
                      </button>
                    )}
                    <button onClick={() => setEditing(e)} className="text-xs text-[var(--color-sky)] px-2 py-1 hover:underline">
                      Edit
                    </button>
                    <button onClick={() => remove(e)} className="text-xs text-[var(--color-brick)] px-2 py-1 hover:underline">
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <p className="text-xs text-[var(--color-ink-soft)]">
        See how these flow into your <Link to="/business/reports" className="text-[var(--color-sky)] hover:underline">reports</Link>. This is a bookkeeping tool, not tax advice — check GST and deductions with your accountant or the ATO.
      </p>

      {editing && (
        <Modal title={editing === "new" ? (isSale ? "New sale" : "New expense") : "Edit"} onClose={() => setEditing(null)}>
          <BusinessEntryForm
            kind={kind}
            initial={editing === "new" ? undefined : editing}
            profile={profile}
            accounts={accounts}
            defaultDate={defaultEntryDate(financialYearId)}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}

      {paying && (
        <Modal title={paying.kind === "INCOME" ? "Record payment received" : "Record payment made"} onClose={() => setPaying(null)}>
          <MarkPaidForm
            entry={paying}
            accounts={accounts}
            defaultDate={defaultEntryDate(financialYearId)}
            onCancel={() => setPaying(null)}
            onSaved={() => {
              setPaying(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
