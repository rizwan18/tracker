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

/** Currency amount using the security's own currency code (falls back to plain AUD formatting if none is given). */
export function formatCurrencyIn(amount: number, currencyCode?: string | null): string {
  if (!currencyCode) return formatCurrency(amount);
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: currencyCode, maximumFractionDigits: 2 }).format(amount);
  } catch {
    // Unrecognised/unsupported currency code from a provider — show the code alongside a plain number instead of throwing.
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

/** e.g. "25 Sep 2026, 4:10 pm AEST" — for a provider-supplied price timestamp. */
export function formatDateTime(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** 51824753556 → "51 824 753 556" (anything that isn't 11 digits is returned unchanged). */
export function formatAbn(abn: string | null | undefined): string {
  const d = (abn ?? "").replace(/\s+/g, "");
  return /^\d{11}$/.test(d) ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : abn ?? "";
}

/**
 * A calendar date such as "1 Jul 2026", read in UTC. Dates like the start and end of a financial year
 * are stored as UTC instants; reading them in a browser timezone east of UTC would push the end of
 * the year (30 June, 23:59 UTC) onto 1 July.
 */
export function formatDateUtc(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
