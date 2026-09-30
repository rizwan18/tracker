import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { HolidaySummary } from "../api/types";
import { Button, Card, EmptyState, SectionHeading } from "../components/ui";
import { Modal } from "../components/Modal";
import { HolidayPlanForm } from "../components/HolidayForms";
import { daysUntil, formatCurrency, formatDate } from "../lib/format";
import { nightsAway, relativeDays, STATUS_BADGE, STATUS_LABELS } from "../lib/holidays";

/** Personal Finance → Holidays: every trip you're saving for, with its budget and what's still to pay. */
export default function HolidaysPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<HolidaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api
      .get<HolidaySummary[]>("/holidays")
      .then((rows) => {
        setPlans(rows);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "We couldn't load your holidays."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const current = plans.filter((p) => p.status !== "COMPLETED" && p.status !== "CANCELLED");
  const past = plans.filter((p) => p.status === "COMPLETED" || p.status === "CANCELLED");

  return (
    <div className="space-y-8">
      <SectionHeading
        title="Holidays"
        subtitle="Plan the trip, the budget and the timeline in one place."
        action={<Button onClick={() => setAdding(true)}>+ New holiday</Button>}
      />

      {error && <p className="text-[var(--color-brick)]">{error}</p>}

      {loading ? (
        <p className="text-[var(--color-ink-soft)]">Loading…</p>
      ) : plans.length === 0 && !error ? (
        <EmptyState
          title="No holidays yet"
          description="Add a trip to track what it will cost, what you've already paid, and the dates you need to book, pay and get organised by."
          action={<Button onClick={() => setAdding(true)}>Plan a holiday</Button>}
        />
      ) : (
        <>
          <PlanGrid plans={current} />
          {past.length > 0 && (
            <section>
              <h3 className="font-display text-lg font-semibold mb-2">Past and cancelled</h3>
              <PlanGrid plans={past} muted />
            </section>
          )}
        </>
      )}

      {adding && (
        <Modal title="New holiday" onClose={() => setAdding(false)}>
          <HolidayPlanForm onCancel={() => setAdding(false)} onSaved={(plan) => navigate(`/holidays/${plan.id}`)} />
        </Modal>
      )}
    </div>
  );
}

function PlanGrid({ plans, muted = false }: { plans: HolidaySummary[]; muted?: boolean }) {
  if (plans.length === 0) return null;
  return (
    <div className={`grid gap-4 md:grid-cols-2 ${muted ? "opacity-80" : ""}`}>
      {plans.map((p) => (
        <PlanCard key={p.id} plan={p} />
      ))}
    </div>
  );
}

function PlanCard({ plan }: { plan: HolidaySummary }) {
  const { totals } = plan;
  const nights = nightsAway(plan.startDate, plan.endDate);
  const over = totals.budgetRemaining != null && totals.budgetRemaining < 0;
  // How much of the budget the expected cost uses (capped so the bar never spills out).
  const used = plan.budget ? Math.min(100, (totals.projected / plan.budget) * 100) : 0;
  const paidShare = plan.budget ? Math.min(100, (totals.paid / plan.budget) * 100) : 0;
  const upcoming = plan.startDate && plan.status !== "COMPLETED" && plan.status !== "CANCELLED" ? daysUntil(plan.startDate) : null;

  return (
    <Link to={`/holidays/${plan.id}`} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-sky)] rounded-2xl">
      <Card className="h-full hover:border-[var(--color-eucalyptus)] transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold truncate">✈️ {plan.name}</h3>
            <p className="text-sm text-[var(--color-ink-soft)] truncate">{plan.destination || "Destination to be decided"}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[plan.status]}`}>{STATUS_LABELS[plan.status]}</span>
        </div>

        <p className="text-sm mt-3">
          {plan.startDate ? (
            <>
              {formatDate(plan.startDate)}
              {plan.endDate ? ` – ${formatDate(plan.endDate)}` : ""}
              {nights != null ? ` · ${nights} night${nights === 1 ? "" : "s"}` : ""}
              {upcoming != null && upcoming >= 0 ? <span className="text-[var(--color-eucalyptus-dark)] font-medium"> · departs {relativeDays(upcoming)}</span> : null}
            </>
          ) : (
            <span className="text-[var(--color-ink-soft)]">Dates not set yet</span>
          )}
        </p>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-[var(--color-ink-soft)]">Expected cost</span>
            <span className={`font-semibold ${over ? "text-[var(--color-brick)]" : ""}`}>
              {formatCurrency(totals.projected)}
              {plan.budget != null && <span className="font-normal text-[var(--color-ink-soft)]"> of {formatCurrency(plan.budget)}</span>}
            </span>
          </div>
          {plan.budget != null && (
            <div className="mt-2 h-2 rounded-full bg-[var(--color-paper-dim)] overflow-hidden relative" role="img" aria-label={`${Math.round(used)}% of budget expected to be used, ${Math.round(paidShare)}% already paid`}>
              <div className={`absolute inset-y-0 left-0 ${over ? "bg-[var(--color-brick-tint)]" : "bg-[var(--color-eucalyptus-tint)]"}`} style={{ width: `${used}%` }} />
              <div className="absolute inset-y-0 left-0 bg-[var(--color-eucalyptus)]" style={{ width: `${paidShare}%` }} />
            </div>
          )}
          <p className="text-xs text-[var(--color-ink-soft)] mt-2">
            {formatCurrency(totals.paid)} paid · {formatCurrency(totals.outstanding)} still to pay
            {over && totals.budgetRemaining != null ? ` · ${formatCurrency(Math.abs(totals.budgetRemaining))} over budget` : ""}
            {plan.openMilestones > 0 ? ` · ${plan.openMilestones} to-do${plan.openMilestones === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      </Card>
    </Link>
  );
}
