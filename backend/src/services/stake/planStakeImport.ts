import type { StakeHolding, StakeReport } from "./parseStakeReport";

export interface ExistingInvestment {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  market: string | null;
  currency: string;
  createdAt: Date;
  /** Newest valuation, if any. */
  latest: { asAt: Date; source: string } | null;
}

export interface ExistingValuationAtDate {
  investmentId: string;
  units: number;
  marketPrice: number;
  marketValueAud: number;
}

export interface StakePlanRow {
  holding: StakeHolding;
  action: "create" | "update" | "unchanged";
  investmentId: string | null;
  /** Name of the existing investment being updated (so the person can see what it matched). */
  existingName: string | null;
  investmentType: "SHARE" | "ETF";
}

export interface StakePlan {
  asAt: string;
  rows: StakePlanRow[];
  /** Holdings from an earlier Stake import that aren't in this statement (sold, or transferred out). */
  missing: Array<{ investmentId: string; name: string; ticker: string | null; currency: string }>;
  counts: { create: number; update: number; unchanged: number; zeroed: number };
  warnings: string[];
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Stake lists ETFs with "ETF" in the name (e.g. "ISHARES S&P 500 ETF-ETF UNITS"); everything else is a share. */
export function investmentTypeFor(name: string): "SHARE" | "ETF" {
  return /\bETF\b/i.test(name) ? "ETF" : "SHARE";
}

/**
 * Finds the investment a statement line belongs to: same symbol on the same market. Older records
 * have no market (the app used to ask for an "ASX ticker"), so they only match Australian lines.
 */
export function findMatch(existing: ExistingInvestment[], holding: Pick<StakeHolding, "symbol" | "market">): ExistingInvestment | null {
  const candidates = existing
    .filter((e) => e.ticker && e.ticker.trim().toUpperCase() === holding.symbol && (e.market === holding.market || (e.market === null && holding.market === "ASX")))
    .sort((a, b) => Number(["SHARE", "ETF", "LIC"].includes(b.type)) - Number(["SHARE", "ETF", "LIC"].includes(a.type)) || a.createdAt.getTime() - b.createdAt.getTime());
  return candidates[0] ?? null;
}

/**
 * Works out what importing a statement would do, without touching the database.
 *  - a line matching an existing investment (same symbol and market) adds a valuation to it
 *  - any other line creates a new share/ETF
 *  - importing the same statement twice changes nothing
 *  - holdings from an earlier Stake import that are missing from a newer statement are listed, and can be zeroed
 */
export function planStakeImport(report: StakeReport, existing: ExistingInvestment[], atDate: ExistingValuationAtDate[], opts: { zeroMissing: boolean }): StakePlan {
  const asAt = report.statementDate as string;
  const warnings: string[] = [];
  const valuationAtDate = new Map(atDate.map((v) => [v.investmentId, v]));
  const matchedIds = new Set<string>();
  const counts = { create: 0, update: 0, unchanged: 0, zeroed: 0 };
  let olderThanLatest = 0;

  const rows: StakePlanRow[] = report.holdings.map((holding) => {
    const match = findMatch(existing, holding);
    const investmentType = investmentTypeFor(holding.name);
    if (!match) {
      counts.create++;
      return { holding, action: "create", investmentId: null, existingName: null, investmentType };
    }
    matchedIds.add(match.id);
    if (match.latest && match.latest.asAt.toISOString().slice(0, 10) > asAt) olderThanLatest++;
    const current = valuationAtDate.get(match.id);
    const unchanged = !!current && sameNumber(current.units, holding.units) && sameNumber(current.marketPrice, holding.marketPrice) && sameNumber(current.marketValueAud, holding.marketValueAud);
    if (unchanged) counts.unchanged++;
    else counts.update++;
    return { holding, action: unchanged ? "unchanged" : "update", investmentId: match.id, existingName: match.name, investmentType };
  });

  const missing = existing
    .filter((e) => !matchedIds.has(e.id) && e.latest?.source === "STAKE" && e.latest.asAt.toISOString().slice(0, 10) < asAt)
    .map((e) => ({ investmentId: e.id, name: e.name, ticker: e.ticker, currency: e.currency }));
  if (opts.zeroMissing) counts.zeroed = missing.length;

  if (olderThanLatest > 0) {
    warnings.push(`This statement (${asAt}) is older than the latest value already recorded for ${olderThanLatest} of these holdings. It will be kept as history and won't replace the newer figures.`);
  }
  return { asAt, rows, missing, counts, warnings };
}
