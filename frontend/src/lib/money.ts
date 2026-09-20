import { formatMoney } from "./format";

/** "$1,234.50", "1234.5" or "12" → whole cents. Returns null when it isn't a valid amount. */
export function toCents(input: string): number | null {
  const s = input.replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === "" || s === ".") return null;
  const cents = Math.round(parseFloat(s) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/** Whole cents as dollars, e.g. 123450 → "1234.50" (for putting back into an input). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** $1,234.50 (always two decimals; negatives as -$1,234.50). */
export function formatCents(cents: number): string {
  return formatMoney(cents / 100);
}

export type GstMode = "INCLUSIVE" | "EXCLUSIVE" | "FREE";

/** Same rules as the server: GST is 1/11 of a GST-inclusive price, or 10% on top of an exclusive one. */
export function computeGst(amountCents: number, mode: GstMode, gstRegistered: boolean): { totalCents: number; gstCents: number; netCents: number } {
  if (!gstRegistered || mode === "FREE") return { totalCents: amountCents, gstCents: 0, netCents: amountCents };
  if (mode === "INCLUSIVE") {
    const gstCents = Math.round(amountCents / 11);
    return { totalCents: amountCents, gstCents, netCents: amountCents - gstCents };
  }
  const gstCents = Math.round(amountCents / 10);
  return { totalCents: amountCents + gstCents, gstCents, netCents: amountCents };
}
