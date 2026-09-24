/** Pure helpers for share/ETF holdings that have a dated valuation (from a broker statement or entered by hand). */

export interface LatestValuation {
  asAt: Date;
  units: number;
  marketPrice: number;
  marketValue: number;
  marketValueAud: number;
  currency: string;
  source: string;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * What an investment is worth now, in Australian dollars. The newest valuation wins (it's a real statement
 * figure); otherwise a manual override; otherwise units bought/sold × the last traded price.
 */
export function currentValueOf(args: { valuation: Pick<LatestValuation, "marketValueAud"> | null; override: number | null; quantity: number; lastPrice: number }): number {
  return args.valuation?.marketValueAud ?? args.override ?? args.quantity * args.lastPrice;
}

/** Each holding's share of the whole portfolio, as a percentage rounded to two decimals (the way Stake prints it). */
export function computeWeightings(items: Array<{ id: string; valueAud: number }>): Map<string, number> {
  const total = items.reduce((s, i) => s + Math.max(0, i.valueAud), 0);
  return new Map(items.map((i) => [i.id, total > 0 ? round2((Math.max(0, i.valueAud) / total) * 100) : 0]));
}

/**
 * Value of a holding from units and price, in its own currency. US holdings are shown in US$ only, so no
 * exchange rate is needed: when none is given, `marketValueAud` simply mirrors `marketValue` (no conversion).
 * An `fxRate` is still honoured if a caller supplies one (e.g. older API clients).
 */
export function valueHolding(units: number, marketPrice: number, currency: string, fxRate: number | null = null): { marketValue: number; marketValueAud: number } {
  const marketValue = round2(units * marketPrice);
  if (currency !== "USD" || !fxRate || fxRate <= 0) return { marketValue, marketValueAud: marketValue };
  return { marketValue, marketValueAud: round2(marketValue * fxRate) };
}
