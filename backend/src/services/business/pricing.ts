/**
 * Landed cost → cost price per unit → recommended selling price (target GROSS margin).
 *
 *   Total sourcing cost   = sum of every landed-cost line (manufacturing, inspection, freight, duty, …)
 *   Cost price per unit   = total sourcing cost ÷ quantity
 *   Selling price per unit = cost price per unit ÷ (1 − margin)          e.g. $6.00 ÷ 0.60 = $10.00
 *
 * This is a gross MARGIN, not a markup: cost × 1.40 would only give a 28.57% margin.
 *
 * Money is whole cents in the order's own currency, as everywhere in Company Finance. Per-unit figures are
 * fractional cents (e.g. 1166.666…) — nothing is rounded here; round only when displaying (2 decimals).
 * Selling expenses (marketplace/payment fees, advertising, GST, income tax) are deliberately not part of this.
 */
import { goodsCostCents, type SourcingCostInputs } from "./sourcing";

export const DEFAULT_TARGET_MARGIN_PERCENT = 40;

/** The groups shown on the pricing card. A new cost (packaging, storage, …) only needs a line in one of them. */
export type LandedCostGroup = "MANUFACTURING" | "INSPECTION" | "FREIGHT" | "OTHER";

export interface LandedCostLine {
  key: string;
  label: string;
  group: LandedCostGroup;
  cents: number;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * Every cost that makes up the landed cost of an order. To include another cost later, add a line here —
 * the totals, the per-unit cost and the selling price all follow from the list.
 */
export function landedCostLines(input: SourcingCostInputs): LandedCostLine[] {
  return [
    { key: "manufacturing", label: "Manufacturing", group: "MANUFACTURING", cents: goodsCostCents(input.quantity, input.unitCostCents) },
    { key: "inspection", label: "Inspection", group: "INSPECTION", cents: sum(input.inspections.map((i) => i.costCents)) },
    { key: "freight", label: "Freight", group: "FREIGHT", cents: sum(input.shipments.map((s) => s.freightCostCents)) },
    { key: "customsDuty", label: "Customs duty", group: "OTHER", cents: sum(input.shipments.map((s) => s.customsDutyCents)) },
    { key: "insurance", label: "Insurance", group: "OTHER", cents: sum(input.shipments.map((s) => s.insuranceCostCents)) },
    { key: "otherShipping", label: "Other shipping costs", group: "OTHER", cents: sum(input.shipments.map((s) => s.otherCostCents)) },
    { key: "transactionFees", label: "Payment transaction fees", group: "OTHER", cents: sum(input.payments.map((p) => p.feeCents ?? 0)) },
  ];
}

export interface LandedCostTotals {
  manufacturingCents: number;
  inspectionCents: number;
  freightCents: number;
  otherCents: number;
  totalCents: number;
}

export function landedCostTotals(lines: LandedCostLine[]): LandedCostTotals {
  const group = (g: LandedCostGroup) => sum(lines.filter((l) => l.group === g).map((l) => l.cents));
  return {
    manufacturingCents: group("MANUFACTURING"),
    inspectionCents: group("INSPECTION"),
    freightCents: group("FREIGHT"),
    otherCents: group("OTHER"),
    totalCents: sum(lines.map((l) => l.cents)),
  };
}

export type PricingProblem = "MISSING_QUANTITY" | "INVALID_QUANTITY" | "INVALID_COST" | "NO_COST" | "INVALID_MARGIN";

export type UnitPricing =
  | {
      ok: true;
      totalCostCents: number;
      quantity: number;
      targetMarginPercent: number;
      /** Fractional cents — unrounded. */
      costPerUnitCents: number;
      sellingPricePerUnitCents: number;
      grossProfitPerUnitCents: number;
    }
  | { ok: false; reason: PricingProblem; message: string };

const fail = (reason: PricingProblem, message: string): UnitPricing => ({ ok: false, reason, message });

/**
 * Cost price per unit and the selling price that earns `targetMarginPercent` gross margin.
 * Never returns NaN / Infinity: bad or missing input comes back as `{ ok: false, message }` instead.
 * A missing margin means the default (40%); a margin must be at least 0 and below 100.
 */
export function computeUnitPricing(args: { lines: LandedCostLine[]; quantity: number | null | undefined; targetMarginPercent?: number | null }): UnitPricing {
  const { lines, quantity } = args;
  const margin = args.targetMarginPercent ?? DEFAULT_TARGET_MARGIN_PERCENT;

  if (quantity === null || quantity === undefined || Number.isNaN(quantity)) return fail("MISSING_QUANTITY", "Enter the quantity to see the cost price per unit.");
  if (!Number.isFinite(quantity) || quantity <= 0) return fail("INVALID_QUANTITY", "Quantity must be more than zero to work out a cost per unit.");
  if (lines.some((l) => !Number.isFinite(l.cents) || l.cents < 0)) return fail("INVALID_COST", "A cost is negative or isn't a valid amount. Costs can't be negative.");
  if (!Number.isFinite(margin) || margin < 0 || margin >= 100) return fail("INVALID_MARGIN", "The target gross margin must be at least 0% and less than 100%.");

  const totalCostCents = sum(lines.map((l) => l.cents));
  if (totalCostCents === 0) return fail("NO_COST", "Add the manufacturing, inspection and freight costs to see the cost price per unit.");

  const costPerUnitCents = totalCostCents / quantity;
  // Selling = cost ÷ (1 − margin). Written as cost × 100 ÷ (100 − margin%) so that 40% is exactly 60 (not 0.6000000000000001).
  const sellingPricePerUnitCents = (costPerUnitCents * 100) / (100 - margin);
  return {
    ok: true,
    totalCostCents,
    quantity,
    targetMarginPercent: margin,
    costPerUnitCents,
    sellingPricePerUnitCents,
    grossProfitPerUnitCents: sellingPricePerUnitCents - costPerUnitCents,
  };
}

/** An amount in `currency` converted to AUD at the recorded rate — unrounded, and unchanged for AUD or when no rate is recorded. */
export function toAudEstimate(cents: number, currency: string, exchangeRateToAud: number | null | undefined): number {
  if (currency === "AUD" || !exchangeRateToAud) return cents;
  return cents * exchangeRateToAud;
}

/** What the screen shows for a sourcing order: the landed-cost groups plus the per-unit pricing. */
export function buildPricingDto(
  input: SourcingCostInputs,
  opts: { currency: string; exchangeRateToAud: number | null; targetMarginPercent: number | null | undefined }
) {
  const lines = landedCostLines(input);
  const landed = landedCostTotals(lines);
  const unit = computeUnitPricing({ lines, quantity: input.quantity, targetMarginPercent: opts.targetMarginPercent });
  const convertible = opts.currency !== "AUD" && !!opts.exchangeRateToAud;
  return {
    targetMarginPercent: opts.targetMarginPercent ?? DEFAULT_TARGET_MARGIN_PERCENT,
    landed,
    unit: unit.ok
      ? {
          ok: true as const,
          costPerUnitCents: unit.costPerUnitCents,
          sellingPricePerUnitCents: unit.sellingPricePerUnitCents,
          grossProfitPerUnitCents: unit.grossProfitPerUnitCents,
          // Only for a foreign-currency order that has an exchange rate.
          costPerUnitAudEstCents: convertible ? toAudEstimate(unit.costPerUnitCents, opts.currency, opts.exchangeRateToAud) : null,
          sellingPricePerUnitAudEstCents: convertible ? toAudEstimate(unit.sellingPricePerUnitCents, opts.currency, opts.exchangeRateToAud) : null,
        }
      : { ok: false as const, reason: unit.reason, message: unit.message },
  };
}
