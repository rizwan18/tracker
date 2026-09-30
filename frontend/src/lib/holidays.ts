import type { HolidayExpenseCategory, HolidayMilestoneType, HolidayStatus } from "../api/types";

export const STATUS_LABELS: Record<HolidayStatus, string> = {
  IDEA: "Just an idea",
  PLANNING: "Planning",
  BOOKED: "Booked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STATUS_ORDER: HolidayStatus[] = ["IDEA", "PLANNING", "BOOKED", "COMPLETED", "CANCELLED"];

export const STATUS_BADGE: Record<HolidayStatus, string> = {
  IDEA: "bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]",
  PLANNING: "bg-[var(--color-sky-tint)] text-[#264a5c]",
  BOOKED: "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]",
  COMPLETED: "bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]",
  CANCELLED: "bg-[var(--color-brick-tint)] text-[var(--color-brick)]",
};

export const EXPENSE_CATEGORY_LABELS: Record<HolidayExpenseCategory, string> = {
  FLIGHTS: "Flights",
  ACCOMMODATION: "Accommodation",
  TRANSPORT: "Transport",
  FOOD: "Food & drink",
  ACTIVITIES: "Activities & tours",
  INSURANCE: "Travel insurance",
  VISAS: "Visas & fees",
  SHOPPING: "Shopping & souvenirs",
  SPENDING_MONEY: "Spending money",
  OTHER: "Other",
};

export const EXPENSE_CATEGORY_ICONS: Record<HolidayExpenseCategory, string> = {
  FLIGHTS: "✈️",
  ACCOMMODATION: "🏨",
  TRANSPORT: "🚆",
  FOOD: "🍽",
  ACTIVITIES: "🎟",
  INSURANCE: "🛡",
  VISAS: "🛂",
  SHOPPING: "🛍",
  SPENDING_MONEY: "💵",
  OTHER: "📌",
};

export const MILESTONE_TYPE_LABELS: Record<HolidayMilestoneType, string> = {
  BOOKING: "Booking",
  DOCUMENTS: "Passport / visa",
  INSURANCE: "Insurance",
  PACKING: "Packing & prep",
  OTHER: "Other",
};

/** e.g. "in 45 days", "tomorrow", "today", "3 days ago" — for a departure date. */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** Nights away, when both dates are known. */
export function nightsAway(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}
