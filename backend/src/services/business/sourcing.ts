/**
 * Cost/payment arithmetic for a sourcing order. Everything here works in whole
 * cents, in the order's own `currency` — the same convention as the rest of
 * Company Finance. Converting to an AUD estimate is a display-only multiply by
 * `exchangeRateToAud` (mirrors how Investment/InvestmentValuation show a
 * marketValueAud alongside the native-currency figure); it's never posted
 * anywhere, so a missing or rough rate never corrupts the order's own figures.
 */

export interface SourcingCostInputs {
  quantity: number;
  unitCostCents: number;
  shipments: Array<{ freightCostCents: number; customsDutyCents: number; insuranceCostCents: number; otherCostCents: number }>;
  inspections: Array<{ costCents: number }>;
  payments: Array<{ amountCents: number; feeCents?: number }>;
}

export interface SourcingCostBreakdown {
  goodsCostCents: number;
  shippingCostCents: number;
  inspectionCostCents: number;
  /** Transaction fees charged on payments. An extra cost of the order, settled at the time of payment. */
  transactionFeeCents: number;
  totalCostCents: number;
  /** Cash out so far: payments to the supplier plus the transaction fees paid with them. */
  paidCents: number;
  balanceCents: number;
}

/** Whole-cent goods cost. Quantity can be fractional (e.g. 12.5 kg), so round only at the end. */
export function goodsCostCents(quantity: number, unitCostCents: number): number {
  return Math.round(quantity * unitCostCents);
}

export function computeSourcingCosts(input: SourcingCostInputs): SourcingCostBreakdown {
  const goods = goodsCostCents(input.quantity, input.unitCostCents);
  const shipping = input.shipments.reduce((s, sh) => s + sh.freightCostCents + sh.customsDutyCents + sh.insuranceCostCents + sh.otherCostCents, 0);
  const inspection = input.inspections.reduce((s, i) => s + i.costCents, 0);
  const fees = input.payments.reduce((s, p) => s + (p.feeCents ?? 0), 0);
  const total = goods + shipping + inspection + fees;
  // A fee is paid at the moment it's charged, so it counts as paid too — meaning it raises the
  // total cost without ever leaving a balance owing (or hiding one).
  const paid = input.payments.reduce((s, p) => s + p.amountCents + (p.feeCents ?? 0), 0);
  return {
    goodsCostCents: goods, shippingCostCents: shipping, inspectionCostCents: inspection, transactionFeeCents: fees,
    totalCostCents: total, paidCents: paid, balanceCents: total - paid,
  };
}

/** A cents amount in `currency`, estimated in AUD (1:1 when the order is already in AUD). */
export function toAudEstimateCents(cents: number, currency: string, exchangeRateToAud: number | null | undefined): number {
  if (currency === "AUD" || !exchangeRateToAud) return cents;
  return Math.round(cents * exchangeRateToAud);
}
