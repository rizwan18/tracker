/** Australian GST is 10% of the price before GST (1/11 of a GST-inclusive price). */
export const GST_RATE_PERCENT = 10;

/**
 * How the GST on an entry is worked out:
 *  - INCLUSIVE: the amount typed includes GST; GST is 1/11 of it.
 *  - EXCLUSIVE: the amount typed is before GST; GST (10%) is added on top.
 *  - FREE:      no GST.
 *  - MANUAL:    the amount typed is the total paid and the GST component is entered by the person
 *               (e.g. copied from the tax invoice). Nothing is estimated — a blank GST is $0.
 */
export const GST_MODES = ["INCLUSIVE", "EXCLUSIVE", "FREE", "MANUAL"] as const;
export type GstMode = (typeof GST_MODES)[number];

export interface GstBreakdown {
  /** What is paid/received in total, including GST. */
  totalCents: number;
  gstCents: number;
  /** Amount before GST. */
  netCents: number;
}

/**
 * Works out the GST for an amount entered by the person. All arithmetic is in whole
 * cents. For MANUAL entries the GST comes from `manualGstCents` (blank = 0), and range-checking it
 * is the caller's job (the entry schema rejects negative GST and GST above the amount). A business that isn't registered for GST never charges or claims it, so
 * for them every amount is treated as GST-free.
 */
export function computeGst(amountCents: number, mode: GstMode, gstRegistered: boolean, manualGstCents: number | null = null): GstBreakdown {
  if (!gstRegistered || mode === "FREE") return { totalCents: amountCents, gstCents: 0, netCents: amountCents };
  if (mode === "MANUAL") {
    // The GST entered is the source value. The amount is the total, so GST is a part of it, never extra.
    const gstCents = Math.round(manualGstCents ?? 0);
    return { totalCents: amountCents, gstCents, netCents: amountCents - gstCents };
  }
  if (mode === "INCLUSIVE") {
    const gstCents = Math.round(amountCents / 11);
    return { totalCents: amountCents, gstCents, netCents: amountCents - gstCents };
  }
  const gstCents = Math.round((amountCents * GST_RATE_PERCENT) / 100);
  return { totalCents: amountCents + gstCents, gstCents, netCents: amountCents };
}
