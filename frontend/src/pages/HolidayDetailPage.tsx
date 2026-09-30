import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { HolidayDetail, HolidayExpense, HolidayMilestone, HolidayTimelineItem } from "../api/types";
import { Alert, Button, Card, EmptyState, SectionHeading, StatTile, TabPanel, Tabs } from "../components/ui";
import { Modal } from "../components/Modal";
import { HolidayExpenseForm, HolidayMilestoneForm, HolidayPlanForm } from "../components/HolidayForms";
import { daysUntil, formatCurrency, formatDate, toInputDate } from "../lib/format";
import { EXPENSE_CATEGORY_ICONS, EXPENSE_CATEGORY_LABELS, MILESTONE_TYPE_LABELS, nightsAway, relativeDays, STATUS_BADGE, STATUS_LABELS } from "../lib/holidays";

type TabId = "timeline" | "expenses" | "budget";

export default function HolidayDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<HolidayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("timeline");
  const [editingPlan, setEditingPlan] = useState(false);
  // undefined = closed, null = adding, object = editing
  const [expenseModal, setExpenseModal] = useState<HolidayExpense | null | undefined>(undefined);
  const [milestoneModal, setMilestoneModal] = useState<HolidayMilestone | null | undefined>(undefined);

  const load = useCallback(() => {
    api
      .get<HolidayDetail>(`/holidays/${id}`)
      .then((p) => {
        setPlan(p);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "We couldn't load this holiday."));
  }, [id]);

  useEffect(load, [load]);

  /** Runs a change that returns the updated plan, and shows the result. */
  async function act(fn: () => Promise<HolidayDetail>) {
    try {
      setPlan(await fn());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (error && !plan) {
    return (
      <div className="space-y-3">
        <p className="text-[var(--color-brick)]">{error}</p>
        <Link to="/holidays" className="text-[var(--color-sky)] hover:underline">← Back to holidays</Link>
      </div>
    );
  }
  if (!plan) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;

  const p = plan;
  const { totals } = p;
  const over = totals.budgetRemaining != null && totals.budgetRemaining < 0;
  const nights = nightsAway(p.startDate, p.endDate);
  const departsIn = p.startDate ? daysUntil(p.startDate) : null;

  function toggleMilestone(m: HolidayMilestone) {
    return act(() => api.put<HolidayDetail>(`/holidays/${p.id}/milestones/${m.id}`, { title: m.title, type: m.type, date: toInputDate(m.date), done: !m.done, notes: m.notes }));
  }
  function togglePaid(e: HolidayExpense) {
    return act(() =>
      api.put<HolidayDetail>(`/holidays/${p.id}/expenses/${e.id}`, {
        category: e.category, description: e.description, estimatedAmount: e.estimatedAmount, actualAmount: e.actualAmount,
        dueDate: e.dueDate ? toInputDate(e.dueDate) : null, paidDate: e.paidDate ? null : toInputDate(new Date()), notes: e.notes,
      })
    );
  }
  function deleteExpense(e: HolidayExpense) {
    if (!confirm(`Remove “${e.description}”?`)) return;
    return act(() => api.delete<HolidayDetail>(`/holidays/${p.id}/expenses/${e.id}`));
  }
  function deleteMilestone(m: HolidayMilestone) {
    if (!confirm(`Remove “${m.title}” from the timeline?`)) return;
    return act(() => api.delete<HolidayDetail>(`/holidays/${p.id}/milestones/${m.id}`));
  }
  async function deletePlan() {
    if (!confirm(`Delete “${p.name}” and all of its expenses and timeline items? This can't be undone.`)) return;
    try {
      await api.delete(`/holidays/${p.id}`);
      navigate("/holidays");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't delete that. Please try again.");
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/holidays" className="text-sm text-[var(--color-sky)] hover:underline">← All holidays</Link>

      <SectionHeading
        title={
          <span className="flex items-center gap-3 flex-wrap">
            ✈️ {p.name}
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[p.status]}`}>{STATUS_LABELS[p.status]}</span>
          </span>
        }
        subtitle={[
          p.destination,
          p.startDate ? `${formatDate(p.startDate)}${p.endDate ? ` – ${formatDate(p.endDate)}` : ""}` : "Dates not set yet",
          nights != null ? `${nights} night${nights === 1 ? "" : "s"}` : null,
          `${p.travellers} traveller${p.travellers === 1 ? "" : "s"}`,
        ].filter(Boolean).join(" · ")}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditingPlan(true)}>Edit</Button>
            <Button variant="danger" size="sm" onClick={deletePlan}>Delete</Button>
          </div>
        }
      />

      {error && <p className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{error}</p>}

      {departsIn != null && departsIn >= 0 && p.status !== "COMPLETED" && p.status !== "CANCELLED" && (
        <Alert severity="info" message={`Departing ${relativeDays(departsIn)}.`} />
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Expected cost" value={formatCurrency(totals.projected)} tone={over ? "negative" : "neutral"} help={p.budget != null ? `Budget ${formatCurrency(p.budget)}` : "No budget set"} />
        <StatTile label="Paid so far" value={formatCurrency(totals.paid)} tone="positive" help={`${totals.paidCount} of ${totals.expenseCount} expenses`} />
        <StatTile label="Still to pay" value={formatCurrency(totals.outstanding)} tone={totals.outstanding > 0 ? "accent" : "neutral"} />
        {totals.budgetRemaining != null ? (
          <StatTile label={over ? "Over budget by" : "Left in budget"} value={formatCurrency(Math.abs(totals.budgetRemaining))} tone={over ? "negative" : "positive"} />
        ) : (
          <StatTile label="Per person" value={formatCurrency(totals.perPerson)} help={`${p.travellers} traveller${p.travellers === 1 ? "" : "s"}`} />
        )}
      </div>

      {over && totals.budgetRemaining != null && (
        <Alert severity="warning" message={`Your expected costs are ${formatCurrency(Math.abs(totals.budgetRemaining))} over your ${formatCurrency(p.budget ?? 0)} budget. You can trim an expense or raise the budget.`} />
      )}
      {p.savings && (
        <Alert
          severity="info"
          message={`To have the remaining ${formatCurrency(totals.outstanding)} covered by departure, set aside about ${formatCurrency(p.savings.perMonth)} a month (${formatCurrency(p.savings.perFortnight)} a fortnight) over the next ${p.savings.daysLeft} days.`}
        />
      )}

      <div>
        <Tabs<TabId>
          tabs={[
            { id: "timeline", label: "Timeline" },
            { id: "expenses", label: `Expenses (${totals.expenseCount})` },
            { id: "budget", label: "Budget breakdown" },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "timeline" && (
          <TabPanel id="timeline">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-ink-soft)]">Everything to do and pay before you go, in date order. Add a payment date to an expense and it appears here too.</p>
              <Button size="sm" onClick={() => setMilestoneModal(null)}>+ Add to timeline</Button>
            </div>
            <Timeline
              items={p.timeline}
              onToggle={(item) => {
                if (item.kind === "MILESTONE") {
                  const m = p.milestones.find((x) => x.id === item.refId);
                  if (m) toggleMilestone(m);
                } else if (item.kind === "PAYMENT_DUE") {
                  const e = p.expenses.find((x) => x.id === item.refId);
                  if (e) togglePaid(e);
                }
              }}
              onEdit={(item) => {
                if (item.kind === "MILESTONE") setMilestoneModal(p.milestones.find((x) => x.id === item.refId) ?? undefined);
                else if (item.kind === "PAYMENT_DUE") setExpenseModal(p.expenses.find((x) => x.id === item.refId) ?? undefined);
              }}
              onDelete={(item) => {
                if (item.kind === "MILESTONE") {
                  const m = p.milestones.find((x) => x.id === item.refId);
                  if (m) deleteMilestone(m);
                }
              }}
            />
          </TabPanel>
        )}

        {tab === "expenses" && (
          <TabPanel id="expenses">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-ink-soft)]">Enter an estimate now, then the actual cost once you have a quote or invoice.</p>
              <Button size="sm" onClick={() => setExpenseModal(null)}>+ Add expense</Button>
            </div>
            {p.expenses.length === 0 ? (
              <EmptyState title="No expenses yet" description="Flights, accommodation, tours, spending money — add what you expect to pay for." action={<Button onClick={() => setExpenseModal(null)}>Add expense</Button>} />
            ) : (
              <Card className="p-0 overflow-hidden">
                <ul className="divide-y divide-[var(--color-line)]">
                  {p.expenses.map((e) => (
                    <li key={e.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          <span aria-hidden>{EXPENSE_CATEGORY_ICONS[e.category]}</span> {e.description}
                        </p>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {EXPENSE_CATEGORY_LABELS[e.category]}
                          {e.paidDate ? ` · paid ${formatDate(e.paidDate)}` : e.dueDate ? ` · pay by ${formatDate(e.dueDate)}` : ""}
                          {e.actualAmount != null && e.actualAmount !== e.estimatedAmount ? ` · estimated ${formatCurrency(e.estimatedAmount)}` : e.actualAmount == null ? " · estimate" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-medium">{formatCurrency(e.actualAmount ?? e.estimatedAmount)}</span>
                        <button onClick={() => togglePaid(e)} className={`text-xs font-medium hover:underline ${e.paidDate ? "text-[var(--color-ink-soft)]" : "text-[var(--color-eucalyptus)]"}`}>
                          {e.paidDate ? "Undo paid" : "Mark paid"}
                        </button>
                        <button onClick={() => setExpenseModal(e)} className="text-xs text-[var(--color-sky)] hover:underline">Edit</button>
                        <button onClick={() => deleteExpense(e)} className="text-xs text-[var(--color-brick)] hover:underline">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </TabPanel>
        )}

        {tab === "budget" && (
          <TabPanel id="budget">
            {p.byCategory.length === 0 ? (
              <EmptyState title="Nothing to break down yet" description="Add some expenses and you'll see where the money is going." />
            ) : (
              <Card>
                <ul className="space-y-4">
                  {p.byCategory.map((c) => {
                    const share = totals.projected > 0 ? (c.projected / totals.projected) * 100 : 0;
                    return (
                      <li key={c.category}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="font-medium">
                            <span aria-hidden>{EXPENSE_CATEGORY_ICONS[c.category]}</span> {EXPENSE_CATEGORY_LABELS[c.category]}
                          </span>
                          <span>
                            {formatCurrency(c.projected)} <span className="text-[var(--color-ink-soft)]">· {Math.round(share)}%</span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 rounded-full bg-[var(--color-paper-dim)] overflow-hidden relative">
                          <div className="absolute inset-y-0 left-0 bg-[var(--color-eucalyptus-tint)]" style={{ width: `${share}%` }} />
                          <div className="absolute inset-y-0 left-0 bg-[var(--color-eucalyptus)]" style={{ width: `${c.projected > 0 ? (c.paid / c.projected) * share : 0}%` }} />
                        </div>
                        <p className="text-xs text-[var(--color-ink-soft)] mt-1">
                          {formatCurrency(c.paid)} paid · {formatCurrency(c.projected - c.paid)} to pay
                          {c.estimated !== c.projected ? ` · originally estimated ${formatCurrency(c.estimated)}` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-[var(--color-line)] mt-5 pt-4 text-sm flex flex-wrap justify-between gap-2">
                  <span>Originally estimated: <strong>{formatCurrency(totals.estimated)}</strong></span>
                  <span>Expected now: <strong>{formatCurrency(totals.projected)}</strong></span>
                  <span>Per person: <strong>{formatCurrency(totals.perPerson)}</strong></span>
                </div>
              </Card>
            )}
          </TabPanel>
        )}
      </div>

      {p.notes && (
        <Card>
          <h3 className="font-display font-semibold mb-1">Notes</h3>
          <p className="text-sm whitespace-pre-wrap text-[var(--color-ink-soft)]">{p.notes}</p>
        </Card>
      )}

      {editingPlan && (
        <Modal title="Edit holiday" onClose={() => setEditingPlan(false)}>
          <HolidayPlanForm initial={p} onCancel={() => setEditingPlan(false)} onSaved={(saved) => { setPlan(saved); setEditingPlan(false); }} />
        </Modal>
      )}
      {expenseModal !== undefined && (
        <Modal title={expenseModal ? "Edit expense" : "Add an expense"} onClose={() => setExpenseModal(undefined)}>
          <HolidayExpenseForm planId={p.id} initial={expenseModal ?? undefined} onCancel={() => setExpenseModal(undefined)} onSaved={(saved) => { setPlan(saved); setExpenseModal(undefined); }} />
        </Modal>
      )}
      {milestoneModal !== undefined && (
        <Modal title={milestoneModal ? "Edit timeline item" : "Add to timeline"} onClose={() => setMilestoneModal(undefined)}>
          <HolidayMilestoneForm planId={p.id} initial={milestoneModal ?? undefined} onCancel={() => setMilestoneModal(undefined)} onSaved={(saved) => { setPlan(saved); setMilestoneModal(undefined); }} />
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function monthKey(iso: string) {
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

function Timeline({
  items, onToggle, onEdit, onDelete,
}: {
  items: HolidayTimelineItem[];
  onToggle: (item: HolidayTimelineItem) => void;
  onEdit: (item: HolidayTimelineItem) => void;
  onDelete: (item: HolidayTimelineItem) => void;
}) {
  if (items.length === 0) {
    return <EmptyState title="Your timeline is empty" description="Set departure and return dates, add things to do (book flights, renew passport), and give expenses a pay-by date. They'll all line up here." />;
  }

  const groups: Array<{ month: string; items: HolidayTimelineItem[] }> = [];
  for (const item of items) {
    const month = monthKey(item.date);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.month}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)] mb-2">{g.month}</h3>
          <ol className="relative border-l-2 border-[var(--color-line)] ml-3 space-y-3">
            {g.items.map((item) => (
              <TimelineRow key={item.key} item={item} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function TimelineRow({ item, onToggle, onEdit, onDelete }: { item: HolidayTimelineItem; onToggle: (i: HolidayTimelineItem) => void; onEdit: (i: HolidayTimelineItem) => void; onDelete: (i: HolidayTimelineItem) => void }) {
  const isTrip = item.kind === "TRIP_START" || item.kind === "TRIP_END";
  const actionable = item.kind === "MILESTONE" || item.kind === "PAYMENT_DUE";
  const tagLabel =
    item.kind === "PAYMENT_DUE" && item.tag
      ? `Payment · ${EXPENSE_CATEGORY_LABELS[item.tag as keyof typeof EXPENSE_CATEGORY_LABELS] ?? item.tag}`
      : item.kind === "MILESTONE" && item.tag
        ? MILESTONE_TYPE_LABELS[item.tag as keyof typeof MILESTONE_TYPE_LABELS] ?? item.tag
        : null;

  return (
    <li className="pl-6 relative">
      <span
        aria-hidden
        className={`absolute -left-[9px] top-3 h-4 w-4 rounded-full border-2 ${
          item.overdue ? "bg-[var(--color-brick)] border-[var(--color-brick)]" : item.done ? "bg-[var(--color-eucalyptus)] border-[var(--color-eucalyptus)]" : "bg-white border-[var(--color-ink-soft)]"
        }`}
      />
      <div className={`rounded-xl border px-4 py-3 flex items-start justify-between gap-3 ${isTrip ? "bg-[var(--color-eucalyptus-tint)] border-transparent" : item.overdue ? "bg-[var(--color-brick-tint)] border-transparent" : "bg-white border-[var(--color-line)]"}`}>
        <div className="flex items-start gap-3 min-w-0">
          {actionable && (
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => onToggle(item)}
              aria-label={item.kind === "PAYMENT_DUE" ? `Mark “${item.title}” as paid` : `Mark “${item.title}” as done`}
              className="mt-1 w-4 h-4 accent-[var(--color-eucalyptus)] shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className={`font-medium ${item.done && actionable ? "line-through text-[var(--color-ink-soft)]" : ""}`}>
              {item.kind === "TRIP_START" && <span aria-hidden>✈️ </span>}
              {item.kind === "TRIP_END" && <span aria-hidden>🏠 </span>}
              {item.title}
            </p>
            <p className="text-xs text-[var(--color-ink-soft)]">
              {formatDate(item.date)}
              {tagLabel ? ` · ${tagLabel}` : ""}
              {item.kind === "PAYMENT_DUE" && item.done ? " · paid" : ""}
              {item.overdue ? <span className="text-[var(--color-brick)] font-medium"> · overdue</span> : ""}
            </p>
            {item.detail && <p className="text-xs text-[var(--color-ink-soft)] mt-1 whitespace-pre-wrap">{item.detail}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {item.amount != null && <span className="font-medium">{formatCurrency(item.amount)}</span>}
          {actionable && <button onClick={() => onEdit(item)} className="text-xs text-[var(--color-sky)] hover:underline">Edit</button>}
          {item.kind === "MILESTONE" && <button onClick={() => onDelete(item)} className="text-xs text-[var(--color-brick)] hover:underline">Delete</button>}
        </div>
      </div>
    </li>
  );
}
