import type { SaleOutcome } from "../api/types";
import { formatMoney } from "./format";
import { formatUsd } from "./holdings";

/** Whole cents → "$1,234.50" (or "US$1,234.50" for a Wall St holding). Negatives read "-$1,234.50". */
export function formatCentsIn(cents: number, currency: "AUD" | "USD" | undefined): string {
  const dollars = cents / 100;
  const abs = currency === "USD" ? formatUsd(Math.abs(dollars)) : formatMoney(Math.abs(dollars));
  return cents < 0 ? `-${abs}` : abs;
}

/** Like formatCentsIn, with an explicit + for gains. */
export function formatCentsSigned(cents: number, currency: "AUD" | "USD" | undefined): string {
  return `${cents > 0 ? "+" : ""}${formatCentsIn(cents, currency)}`;
}

export const OUTCOME_LABEL: Record<SaleOutcome, string> = {
  GAIN: "Capital gain",
  LOSS: "Capital loss",
  BREAK_EVEN: "Break-even — no capital gain or loss",
};

export const outcomeColour = (o: SaleOutcome): string =>
  o === "GAIN" ? "text-[var(--color-eucalyptus)]" : o === "LOSS" ? "text-[var(--color-brick)]" : "text-[var(--color-ink-soft)]";

/** Today's date in the person's own time zone as YYYY-MM-DD (toInputDate would give the UTC date, which can be yesterday in Australia). */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A fresh idempotency key for one sale attempt: submitting it twice records the sale once. */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Older/insecure contexts: 128 random bits from getRandomValues, else Math.random as a last resort.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A number typed into a form ("1,234.5", "$12") → number; null when blank or not a number. */
export function parseTyped(v: string): number | null {
  const t = v.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const decimals = (n: number): number => {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]) + (s.split("e-")[0]!.split(".")[1]?.length ?? 0);
  return s.split(".")[1]?.length ?? 0;
};

/** The same rules the server enforces, for instant feedback. The server remains the authority. Returns the first problem, or null. */
export function validateSaleInputs(i: { quantity: string; price: string; date: string; fees: string; available: number; today: string }): string | null {
  const q = parseTyped(i.quantity);
  if (q === null) return i.quantity.trim() === "" ? "Enter how many shares to sell." : "Enter the quantity as a number.";
  if (q <= 0) return "The quantity sold must be greater than zero.";
  if (decimals(q) > 8) return "The quantity can have at most 8 decimal places.";
  if (q > i.available + 1e-9) return `You can sell at most ${i.available} shares.`;
  const p = parseTyped(i.price);
  if (p === null) return i.price.trim() === "" ? "Enter the sale price per share." : "Enter the sale price as a number.";
  if (p < 0) return "The sale price can't be negative.";
  if (decimals(p) > 6) return "The sale price can have at most 6 decimal places.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date) || Number.isNaN(new Date(`${i.date}T00:00:00Z`).getTime()) || new Date(`${i.date}T00:00:00Z`).toISOString().slice(0, 10) !== i.date) return "Enter a valid sale date.";
  if (i.date > i.today) return "The sale date can't be in the future.";
  if (i.fees.trim() !== "") {
    const f = parseTyped(i.fees);
    if (f === null) return "Enter the fees as a number.";
    if (f < 0) return "Selling fees can't be negative.";
    if (decimals(f) > 2) return "Selling fees can have at most 2 decimal places (cents).";
  }
  return null;
}

/** Gain, loss or break-even from a gain/loss in whole cents. */
export const outcomeOf = (gainLossCents: number): SaleOutcome => (gainLossCents > 0 ? "GAIN" : gainLossCents < 0 ? "LOSS" : "BREAK_EVEN");
