export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
}

export function formatCurrencySigned(amount: number): string {
  const formatted = formatCurrency(Math.abs(amount));
  return amount < 0 ? `-${formatted}` : `+${formatted}`;
}

export function formatDate(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatDateShort(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short" }).format(date);
}

export function toInputDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return date.toISOString().slice(0, 10);
}

export function daysUntil(dateInput: string | Date): number {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** Always two decimals — used where columns of dollar amounts need to line up (e.g. the rental schedule). */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

/** First and last day of an Australian financial year id like "2026-27" (as yyyy-mm-dd). */
export function financialYearBounds(financialYearId: string): { start: string; end: string } {
  const startYear = Number(financialYearId.slice(0, 4));
  return { start: `${startYear}-07-01`, end: `${startYear + 1}-06-30` };
}

/**
 * A sensible default date for a new entry: today if it falls inside the chosen
 * financial year, otherwise the last day of that year — so the entry lands in
 * the year the person is looking at instead of silently moving to another one.
 */
export function defaultEntryDate(financialYearId: string): string {
  const today = toInputDate(new Date());
  const { start, end } = financialYearBounds(financialYearId);
  return today >= start && today <= end ? today : end;
}

/** 51824753556 → "51 824 753 556" (anything that isn't 11 digits is returned unchanged). */
export function formatAbn(abn: string | null | undefined): string {
  const d = (abn ?? "").replace(/\s+/g, "");
  return /^\d{11}$/.test(d) ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : abn ?? "";
}
