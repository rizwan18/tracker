/**
 * Holiday planner arithmetic and timeline. Pure functions (no database) so they can be unit
 * tested on their own. Money is AUD dollars as plain numbers, matching Bill and Transaction,
 * so every sum is rounded to cents at the end to keep floating-point noise out of the totals.
 */

export interface HolidayExpenseInput {
  id: string;
  category: string;
  description: string;
  estimatedAmount: number;
  actualAmount: number | null;
  dueDate: Date | null;
  paidDate: Date | null;
}

export interface HolidayMilestoneInput {
  id: string;
  title: string;
  type: string;
  date: Date;
  done: boolean;
  notes?: string | null;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** What an expense costs: the real amount once it's known, otherwise the estimate. */
export function expenseCost(e: Pick<HolidayExpenseInput, "estimatedAmount" | "actualAmount">): number {
  return e.actualAmount ?? e.estimatedAmount;
}

export interface HolidayTotals {
  /** Sum of the original estimates. */
  estimated: number;
  /** Expected final cost: real amounts where known, estimates for the rest. */
  projected: number;
  paid: number;
  outstanding: number;
  budget: number | null;
  /** Budget minus projected cost; negative means over budget. Null when there's no budget. */
  budgetRemaining: number | null;
  perPerson: number;
  expenseCount: number;
  paidCount: number;
}

export function computeHolidayTotals(expenses: HolidayExpenseInput[], budget: number | null, travellers: number): HolidayTotals {
  const estimated = expenses.reduce((s, e) => s + e.estimatedAmount, 0);
  const paid = expenses.filter((e) => e.paidDate).reduce((s, e) => s + expenseCost(e), 0);
  const outstanding = expenses.filter((e) => !e.paidDate).reduce((s, e) => s + expenseCost(e), 0);
  const projected = paid + outstanding;
  return {
    estimated: round2(estimated),
    projected: round2(projected),
    paid: round2(paid),
    outstanding: round2(outstanding),
    budget,
    budgetRemaining: budget == null ? null : round2(budget - projected),
    perPerson: round2(projected / Math.max(1, travellers)),
    expenseCount: expenses.length,
    paidCount: expenses.filter((e) => e.paidDate).length,
  };
}

export interface CategoryBreakdown {
  category: string;
  estimated: number;
  projected: number;
  paid: number;
}

/** Spend by category, biggest first. Categories with no expenses are left out. */
export function breakdownByCategory(expenses: HolidayExpenseInput[]): CategoryBreakdown[] {
  const map = new Map<string, CategoryBreakdown>();
  for (const e of expenses) {
    const row = map.get(e.category) ?? { category: e.category, estimated: 0, projected: 0, paid: 0 };
    row.estimated += e.estimatedAmount;
    row.projected += expenseCost(e);
    if (e.paidDate) row.paid += expenseCost(e);
    map.set(e.category, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, estimated: round2(r.estimated), projected: round2(r.projected), paid: round2(r.paid) }))
    .sort((a, b) => b.projected - a.projected);
}

export interface SavingsPlan {
  daysLeft: number;
  perMonth: number;
  perFortnight: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight (UTC) at the start of the given moment's day — dates are stored as UTC midnight. */
export function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * How much to put aside to cover what's still unpaid by departure. Null when there's nothing left to
 * pay, no departure date, or the trip has already started (nothing left to save towards).
 */
export function savingsPlan(outstanding: number, startDate: Date | null, today: Date = new Date()): SavingsPlan | null {
  if (outstanding <= 0 || !startDate) return null;
  const daysLeft = Math.round((startOfDayUtc(startDate).getTime() - startOfDayUtc(today).getTime()) / MS_PER_DAY);
  if (daysLeft <= 0) return null;
  const months = Math.max(1, Math.ceil(daysLeft / 30.4375));
  const fortnights = Math.max(1, Math.ceil(daysLeft / 14));
  return { daysLeft, perMonth: round2(outstanding / months), perFortnight: round2(outstanding / fortnights) };
}

export type TimelineKind = "TRIP_START" | "TRIP_END" | "MILESTONE" | "PAYMENT_DUE";

export interface TimelineItem {
  key: string;
  kind: TimelineKind;
  date: string;
  title: string;
  /** Category (payments) or milestone type. */
  tag: string | null;
  detail: string | null;
  amount: number | null;
  done: boolean;
  /** Not done and the date has passed. */
  overdue: boolean;
  /** id of the milestone / expense behind this row, so the page can act on it. */
  refId: string | null;
}

const KIND_RANK: Record<TimelineKind, number> = { PAYMENT_DUE: 0, MILESTONE: 1, TRIP_START: 2, TRIP_END: 3 };

/**
 * One date-ordered list of everything that happens around the plan: milestones, payment due dates
 * (for expenses that have one) and the trip's own departure and return.
 */
export function buildTimeline(
  plan: { name: string; startDate: Date | null; endDate: Date | null },
  expenses: HolidayExpenseInput[],
  milestones: HolidayMilestoneInput[],
  today: Date = new Date()
): TimelineItem[] {
  const todayStart = startOfDayUtc(today).getTime();
  const items: TimelineItem[] = [];

  for (const m of milestones) {
    items.push({
      key: `m-${m.id}`, kind: "MILESTONE", date: m.date.toISOString(), title: m.title, tag: m.type, detail: m.notes ?? null, amount: null,
      done: m.done, overdue: !m.done && m.date.getTime() < todayStart, refId: m.id,
    });
  }
  for (const e of expenses) {
    if (!e.dueDate) continue;
    const done = !!e.paidDate;
    items.push({
      key: `e-${e.id}`, kind: "PAYMENT_DUE", date: e.dueDate.toISOString(), title: e.description, tag: e.category, detail: null, amount: round2(expenseCost(e)),
      done, overdue: !done && e.dueDate.getTime() < todayStart, refId: e.id,
    });
  }
  if (plan.startDate) {
    items.push({
      key: "trip-start", kind: "TRIP_START", date: plan.startDate.toISOString(), title: `Depart for ${plan.name}`, tag: null, detail: null, amount: null,
      done: plan.startDate.getTime() < todayStart, overdue: false, refId: null,
    });
  }
  if (plan.endDate) {
    items.push({
      key: "trip-end", kind: "TRIP_END", date: plan.endDate.toISOString(), title: "Return home", tag: null, detail: null, amount: null,
      done: plan.endDate.getTime() < todayStart, overdue: false, refId: null,
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.title.localeCompare(b.title));
}
