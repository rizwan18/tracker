/**
 * Reading and writing the values of the human-friendly CSV: Australian dates (day/month/year), plain money,
 * readable words for types and frequencies. Everything here is pure, so it can be tested without a database.
 */

// ------------------------------------------------------------------ dates

const pad = (n: number) => String(n).padStart(2, "0");

/** 5 October 2026 → "05/10/2026" (day/month/year — never month first). Dates are stored at UTC midnight. */
export function formatDate(d: Date): string {
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function validDate(y: number, m: number, d: number): Date | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/**
 * Accepts what people really type or what Excel saves: 5/10/2026, 05-10-2026, 5.10.26, 5 Oct 2026, 5-Oct-2026,
 * and the year-first 2026-10-05 (also with a time on the end). A number-only date is always day/month/year,
 * so 10/25/2026 is refused instead of being guessed at.
 */
export function parseDate(raw: string): Date | null {
  const s = raw.trim();
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/.exec(s);
  if (m) return validDate(m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[ \-]([A-Za-z]{3,9})[ \-,]+(\d{4}|\d{2})$/.exec(s);
  if (m) {
    const month = MONTH_NAMES.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    return validDate(m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]), month, Number(m[1]));
  }
  return null;
}

/** "2026-10-05" — used to compare dates and to find duplicates. */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

// ------------------------------------------------------------------ money

/**
 * "85.40", "$4,500.00", "4500", "(85.40)" → whole cents (negative for a minus sign or brackets).
 * Returns null for anything that isn't an amount, including more than two decimals and a comma used as the
 * decimal point (1,5), rather than guessing.
 */
export function parseMoney(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(?:AUD|A\$)\s*/i, "").replace(/^(-?)\s*\$\s*/, "$1");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/^\$\s*/, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

/** 8540 → "85.40": a plain number with two decimals — no $ sign or thousands separators, so Excel treats it as a number. */
export const formatMoney = (cents: number): string => (cents / 100).toFixed(2);

// ------------------------------------------------------------------ words

/** Lower-case letters and digits only, so "Paid From", "paid_from" and "PAID FROM " all match. */
export const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Collapses spaces and case — for comparing descriptions when looking for duplicates. */
export const looseText = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

export type Direction = "INCOME" | "EXPENSE";
const INCOME_WORDS = new Set(["income", "sale", "sales", "revenue", "receipt", "credit", "in"]);
const EXPENSE_WORDS = new Set(["expense", "expenses", "bill", "cost", "purchase", "payment", "spend", "spending", "debit", "out"]);

export function parseDirection(raw: string): Direction | null {
  const w = normalise(raw);
  if (INCOME_WORDS.has(w)) return "INCOME";
  if (EXPENSE_WORDS.has(w)) return "EXPENSE";
  return null;
}
export const directionLabel = (d: string): string => (d === "INCOME" ? "Income" : "Expense");

const FREQUENCIES: Array<{ value: string; label: string; words: string[] }> = [
  { value: "WEEKLY", label: "Weekly", words: ["weekly", "week", "everyweek"] },
  { value: "FORTNIGHTLY", label: "Fortnightly", words: ["fortnightly", "fortnight", "biweekly", "everyfortnight"] },
  { value: "MONTHLY", label: "Monthly", words: ["monthly", "month", "everymonth"] },
  { value: "QUARTERLY", label: "Quarterly", words: ["quarterly", "quarter"] },
  { value: "HALF_YEARLY", label: "Half-yearly", words: ["halfyearly", "biannual", "sixmonthly", "semiannual", "every6months"] },
  { value: "ANNUALLY", label: "Yearly", words: ["yearly", "annually", "annual", "year", "everyyear"] },
  { value: "CUSTOM", label: "Custom", words: ["custom", "other"] },
];
export const FREQUENCY_LABELS = FREQUENCIES.map((f) => f.label);

/** Blank / No → not repeating (null); a frequency word → its stored value; anything else → "unknown". */
export function parseRepeats(raw: string): { repeats: false } | { repeats: true; frequency: string } | "unknown" {
  const w = normalise(raw);
  if (w === "" || ["no", "none", "never", "doesnotrepeat", "once", "onceoff", "oneoff", "false"].includes(w)) return { repeats: false };
  const f = FREQUENCIES.find((x) => x.words.includes(w));
  return f ? { repeats: true, frequency: f.value } : "unknown";
}
export const frequencyLabel = (value: string | null | undefined): string => FREQUENCIES.find((f) => f.value === value)?.label ?? "";

// ------------------------------------------------------------------ "did you mean"

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length]!;
}

/** The closest few names to what was typed — to turn "Grocries" into a helpful “Did you mean Groceries?”. */
export function closestNames(typed: string, options: string[], max = 3): string[] {
  const t = normalise(typed);
  if (t === "") return [];
  return options
    .map((o) => ({ o, n: normalise(o) }))
    .map(({ o, n }) => ({ o, score: n.includes(t) || t.includes(n) ? 0 : distance(t, n) }))
    .filter(({ o, score }) => score <= Math.max(2, Math.floor(normalise(o).length / 4)))
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map(({ o }) => o);
}

/** `Category "Grocries" could not be found. Did you mean Groceries?` */
export function notFoundMessage(column: string, typed: string, options: string[]): string {
  const near = closestNames(typed, options);
  const hint = near.length > 0 ? ` Did you mean ${near.join(" or ")}?` : options.length > 0 && options.length <= 12 ? ` Your ${column.toLowerCase()} names are: ${options.join(", ")}.` : "";
  return `${column} “${typed}” could not be found.${hint}`;
}
