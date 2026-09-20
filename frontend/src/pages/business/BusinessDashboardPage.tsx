import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { BusinessSummary, MonthlyRow } from "../../api/businessTypes";
import { useFinancialYear } from "../../context/FinancialYearContext";
import { usePortfolio } from "../../context/PortfolioContext";
import { useBusinessBasics } from "../../hooks/useBusiness";
import { Button, Card, EmptyState, SectionHeading, StatTile } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { BusinessEntryForm } from "../../components/business/BusinessEntryForm";
import { defaultEntryDate, formatDate } from "../../lib/format";
import { formatCents } from "../../lib/money";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m;

/** Income vs expenses per month, drawn with plain elements (no chart library). */
function MonthlyBars({ months }: { months: MonthlyRow[] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.incomeCents, m.expensesCents]));
  return (
    <figure>
      <div className="flex items-end gap-1.5 h-40" role="img" aria-label={`Monthly income and expenses. ${months.map((m) => `${monthLabel(m.month)}: income ${formatCents(m.incomeCents)}, expenses ${formatCents(m.expensesCents)}`).join("; ")}`}>
        {months.map((m) => (
          <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="flex items-end gap-0.5 h-32 w-full justify-center">
              <div className="w-1/2 max-w-3 rounded-t bg-[var(--color-eucalyptus)]" style={{ height: `${(m.incomeCents / max) * 100}%` }} title={`${monthLabel(m.month)} income ${formatCents(m.incomeCents)}`} />
              <div className="w-1/2 max-w-3 rounded-t bg-[var(--color-brick)]" style={{ height: `${(m.expensesCents / max) * 100}%` }} title={`${monthLabel(m.month)} expenses ${formatCents(m.expensesCents)}`} />
            </div>
            <span className="text-[10px] text-[var(--color-ink-soft)]">{monthLabel(m.month)}</span>
          </div>
        ))}
      </div>
      <figcaption className="flex gap-4 text-xs text-[var(--color-ink-soft)] mt-2">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--color-eucalyptus)]" aria-hidden /> Income</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--color-brick)]" aria-hidden /> Expenses</span>
      </figcaption>
    </figure>
  );
}

/** The home screen of a Company Finance portfolio. */
export default function BusinessDashboardPage() {
  const { financialYearId } = useFinancialYear();
  const { active } = usePortfolio();
  const { profile, accounts, loading: basicsLoading } = useBusinessBasics();
  const [data, setData] = useState<BusinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<"INCOME" | "EXPENSE" | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<BusinessSummary>(`/business/summary?financialYear=${financialYearId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load your business summary.");
    }
  }, [financialYearId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading || basicsLoading) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;
  if (error || !data || !profile) return <p role="alert" className="text-[var(--color-brick)]">{error ?? "We couldn't load your business."}</p>;

  const detailsMissing = !profile.abn;

  return (
    <div className="space-y-6">
      <SectionHeading
        title={profile.businessName}
        subtitle={`${active?.name ?? "Company Finance"} · ${financialYearId} financial year${profile.abnFormatted ? ` · ABN ${profile.abnFormatted}` : ""}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCreating("EXPENSE")}>
              + Expense
            </Button>
            <Button onClick={() => setCreating("INCOME")}>+ Sale</Button>
          </div>
        }
      />

      {detailsMissing && (
        <p className="text-sm rounded-xl bg-[var(--color-sky-tint)] text-[#264a5c] px-4 py-3">
          Add your ABN and say whether you're registered for GST in{" "}
          <Link to="/settings" className="underline font-medium">
            Settings
          </Link>{" "}
          so your reports are set up correctly.
        </p>
      )}

      {!data.hasData ? (
        <EmptyState
          title="Let's get your books started"
          description="Record a sale or an expense and your income statement, balance sheet and GST report build themselves. Opening balances (money in the bank, loans, equipment) can be added under Journal."
          action={
            <div className="flex flex-wrap gap-2 justify-center">
              <Button onClick={() => setCreating("INCOME")}>+ Record a sale</Button>
              <Button variant="secondary" onClick={() => setCreating("EXPENSE")}>
                + Record an expense
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Income" value={formatCents(data.incomeCents)} tone="positive" help="Everything the business earned this financial year, before GST." />
            <StatTile label="Expenses" value={formatCents(data.expensesCents)} tone="negative" help="Costs this financial year, before GST." />
            <StatTile label="Net profit" value={formatCents(data.netProfitCents)} tone={data.netProfitCents >= 0 ? "positive" : "negative"} help="Income minus expenses." />
            <StatTile label="Cash at bank" value={formatCents(data.cashCents)} tone="neutral" help="Balance of your bank and cash accounts." />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile
              label="Owed to you"
              value={formatCents(data.receivablesCents)}
              tone="neutral"
              help={data.receivablesOverdueCents > 0 ? `${formatCents(data.receivablesOverdueCents)} of this is overdue.` : "Unpaid invoices from customers."}
            />
            <StatTile
              label="You owe"
              value={formatCents(data.payablesCents)}
              tone="neutral"
              help={data.payablesOverdueCents > 0 ? `${formatCents(data.payablesOverdueCents)} of this is overdue.` : "Bills you haven't paid yet."}
            />
            {data.gstRegistered && (
              <StatTile label={data.netGstCents >= 0 ? "GST to pay" : "GST refund"} value={formatCents(Math.abs(data.netGstCents))} tone="neutral" help="GST collected on sales minus GST paid on purchases, this financial year." />
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <h3 className="font-display font-semibold mb-3">Income and expenses by month</h3>
              <MonthlyBars months={data.months} />
            </Card>
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-semibold">Recent activity</h3>
                <Link to="/business/reports" className="text-sm text-[var(--color-sky)] hover:underline">
                  Reports
                </Link>
              </div>
              {data.recent.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-soft)]">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)]">
                  {data.recent.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{e.description}</p>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {formatDate(e.date)} · {e.kind === "INCOME" ? "Sale" : "Expense"}
                          {e.status === "UNPAID" ? " · not paid" : ""}
                        </p>
                      </div>
                      <span className={`tabular-nums font-medium ${e.kind === "INCOME" ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>
                        {e.kind === "INCOME" ? "" : "-"}
                        {formatCents(e.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      {creating && (
        <Modal title={creating === "INCOME" ? "New sale" : "New expense"} onClose={() => setCreating(null)}>
          <BusinessEntryForm
            kind={creating}
            profile={profile}
            accounts={accounts}
            defaultDate={defaultEntryDate(financialYearId)}
            onCancel={() => setCreating(null)}
            onSaved={() => {
              setCreating(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
