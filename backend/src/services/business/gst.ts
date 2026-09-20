/** Australian GST is 10% of the price before GST (1/11 of a GST-inclusive price). */
export const GST_RATE_PERCENT = 10;

export const GST_MODES = ["INCLUSIVE", "EXCLUSIVE", "FREE"] as const;
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
 * cents. A business that isn't registered for GST never charges or claims it, so
 * for them every amount is treated as GST-free.
 */
export function computeGst(amountCents: number, mode: GstMode, gstRegistered: boolean): GstBreakdown {
  if (!gstRegistered || mode === "FREE") return { totalCents: amountCents, gstCents: 0, netCents: amountCents };
  if (mode === "INCLUSIVE") {
    const gstCents = Math.round(amountCents / 11);
    return { totalCents: amountCents, gstCents, netCents: amountCents - gstCents };
  }
  const gstCents = Math.round((amountCents * GST_RATE_PERCENT) / 100);
  return { totalCents: amountCents + gstCents, gstCents, netCents: amountCents };
}
