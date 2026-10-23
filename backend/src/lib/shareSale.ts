/**
 * The arithmetic of selling shares — pure (no database, no HTTP) so it can be tested exhaustively and is the only
 * place these formulas live.
 *
 *   Gross sale proceeds  = quantity sold × sale price per share
 *   Net sale proceeds    = gross sale proceeds − selling fees
 *   Cost base of shares sold = (cost base held ÷ units held) × quantity sold      (average-cost method)
 *   Capital gain / loss  = net sale proceeds − cost base of shares sold
 *                          > 0 capital gain · < 0 capital loss · = 0 break-even
 *
 * Everything is exact decimal arithmetic and every money result is whole cents, rounded half-up. When the whole
 * remaining holding is sold, the allocated cost base is ALL of the cost base still held, so nothing is left behind
 * through rounding.
 *
 * This is an accounting gain/loss for tracking only. It applies no CGT discount, tax rate or offset, and it is not
 * necessarily the figure that belongs on a tax return.
 */
import { D, QTY_EPSILON, toCentsInt, type Dec } from "./decimal";

export const COST_METHOD = "AVERAGE_COST" as const;
export type CostMethod = typeof COST_METHOD;

export type SaleOutcome = "GAIN" | "LOSS" | "BREAK_EVEN";

export interface SaleFigures {
  quantity: number;
  /** quantity × price, whole cents. */
  grossProceedsCents: number;
  feesCents: number;
  /** gross − fees, whole cents. May be negative if the fees exceed the proceeds. */
  netProceedsCents: number;
  /** Cost base allocated to the units sold, whole cents. */
  costBaseCents: number;
  /** net − cost base, whole cents. */
  gainLossCents: number;
  outcome: SaleOutcome;
  /** Average cost of one unit of everything held at the time of the sale (for display and audit; the cents figures above are authoritative). */
  costBasePerShare: number;
  /** What was held immediately before the sale. */
  poolQuantity: number;
  poolCostBaseCents: number;
  /** What is left after the sale. */
  remainingQuantity: number;
  remainingCostBaseCents: number;
  /** True when this sale sells everything that was held. */
  closesHolding: boolean;
  costMethod: CostMethod;
}

export function outcomeOf(gainLossCents: number): SaleOutcome {
  return gainLossCents > 0 ? "GAIN" : gainLossCents < 0 ? "LOSS" : "BREAK_EVEN";
}

export function computeSale(args: {
  quantity: Dec;
  pricePerShare: Dec;
  fees: Dec;
  /** Units held immediately before the sale. */
  poolQuantity: Dec;
  /** Cost base (in dollars, exact) still held immediately before the sale. */
  poolCostBase: Dec;
}): SaleFigures {
  const { quantity, pricePerShare, fees, poolQuantity, poolCostBase } = args;

  const grossProceedsCents = toCentsInt(quantity.times(pricePerShare));
  const feesCents = toCentsInt(fees);
  const netProceedsCents = grossProceedsCents - feesCents;

  // Selling everything (within dust) takes all remaining cost base; otherwise allocate in proportion to units sold.
  // Multiply before dividing so the only rounding is the final one, to the cent.
  const sellsEverything = quantity.minus(poolQuantity).abs().lte(QTY_EPSILON);
  const allocated: Dec = sellsEverything || poolQuantity.lte(0) ? poolCostBase : poolCostBase.times(quantity).div(poolQuantity);
  const costBaseCents = toCentsInt(allocated);
  const gainLossCents = netProceedsCents - costBaseCents;

  const remainingQuantity = sellsEverything ? new D(0) : poolQuantity.minus(quantity);
  const remainingCostBaseCents = sellsEverything ? 0 : toCentsInt(poolCostBase.minus(allocated));

  return {
    quantity: quantity.toNumber(),
    grossProceedsCents,
    feesCents,
    netProceedsCents,
    costBaseCents,
    gainLossCents,
    outcome: outcomeOf(gainLossCents),
    costBasePerShare: poolQuantity.gt(0) ? poolCostBase.div(poolQuantity).toDecimalPlaces(6).toNumber() : 0,
    poolQuantity: poolQuantity.toNumber(),
    poolCostBaseCents: toCentsInt(poolCostBase),
    remainingQuantity: remainingQuantity.toNumber(),
    remainingCostBaseCents,
    closesHolding: sellsEverything,
    costMethod: COST_METHOD,
  };
}

/**
 * A calendar date typed as YYYY-MM-DD (or an ISO date-time, of which only the UTC day is kept) → that day at 00:00 UTC,
 * which is how the app stores every trade date. Returns null for anything that isn't a real date, e.g. 2026-02-30.
 */
export function parseSaleDate(input: string): Date | null {
  const t = input.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  let result: Date | null = null;
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) result = dt;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const dt = new Date(t);
    if (!Number.isNaN(dt.getTime())) result = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  }
  return result && result.getUTCFullYear() >= 1900 ? result : null;
}
