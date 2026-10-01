/**
 * BAS reporting periods. A BAS is lodged monthly or quarterly. The ATO quarters follow the
 * Australian financial year (1 July – 30 June):
 *   Q1  Jul–Sep    Q2  Oct–Dec    Q3  Jan–Mar    Q4  Apr–Jun
 * Ranges are inclusive and in UTC, matching how entry dates are stored: `from` is midnight at the
 * start of the first day and `to` is the last millisecond of the last day, so an entry dated on
 * the final day of a period is included.
 */

export interface BasPeriod {
  from: Date;
  to: Date;
  label: string;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The inclusive range for calendar month `month` (0–11) of `year`. */
function monthSpan(year: number, month: number, months = 1): { from: Date; to: Date } {
  return { from: new Date(Date.UTC(year, month, 1)), to: new Date(Date.UTC(year, month + months, 0, 23, 59, 59, 999)) };
}

/** A calendar month, given as "YYYY-MM". Null when it isn't valid. */
export function basMonthPeriod(month: string): BasPeriod | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const index = Number(m[2]) - 1;
  if (index < 0 || index > 11) return null;
  return { ...monthSpan(year, index), label: `${MONTH_NAMES[index]} ${year}` };
}

/** Quarter 1–4 of the financial year "YYYY-YY" (e.g. "2026-27"). Null when either is invalid. */
export function basQuarterPeriod(financialYear: string, quarter: number): BasPeriod | null {
  const fy = /^(\d{4})-(\d{2})$/.exec(financialYear);
  if (!fy || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) return null;
  const startYear = Number(fy[1]);
  if (fy[2] !== String((startYear + 1) % 100).padStart(2, "0")) return null;
  // Q1/Q2 fall in the first calendar year of the financial year, Q3/Q4 in the next.
  const firstMonth = [6, 9, 0, 3][quarter - 1]!;
  const year = quarter <= 2 ? startYear : startYear + 1;
  const first = MONTH_NAMES[firstMonth];
  const last = MONTH_NAMES[firstMonth + 2];
  return { ...monthSpan(year, firstMonth, 3), label: `Q${quarter} FY${startYear}–${String(startYear + 1).slice(2)} (${first}–${last} ${year})` };
}

/**
 * Reads `?period=month&month=2026-09` or `?period=quarter&financialYear=2026-27&quarter=1` from a
 * request. Returns null when no month/quarter was asked for (the caller then uses the usual custom
 * `from`/`to`) and also when one was asked for but is malformed — so a caller that wants to refuse
 * a malformed period, rather than guess, checks `query.period` itself (the GST route does).
 */
export function resolveBasPeriod(query: Record<string, unknown>): BasPeriod | null {
  if (query.period === "month" && typeof query.month === "string") return basMonthPeriod(query.month);
  if (query.period === "quarter" && typeof query.financialYear === "string") return basQuarterPeriod(query.financialYear, Number(query.quarter));
  return null;
}
