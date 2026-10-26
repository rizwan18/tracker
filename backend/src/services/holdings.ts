/** Pure helpers for share/ETF holdings that have a dated valuation (from a broker statement or entered by hand). */
import { D, dec, QTY_EPSILON, type Dec } from "../lib/decimal";
import { STOCK_TYPES } from "../lib/constants";

const DAY_MS = 24 * 60 * 60 * 1000;
/** UTC calendar day a ledger date falls on. The app records trade dates as whole days (date inputs), so ordering works by day. */
export const dayKey = (d: Date): number => Math.floor(d.getTime() / DAY_MS);

/** The fields of an InvestmentTransaction the ledger replay needs. The four *Cents fields are set only on sales recorded with the Sell action. */
export interface LedgerTx {
  id?: string;
  type: string;
  date: Date;
  quantity: number;
  pricePerUnit: number;
  brokerage: number;
  createdAt?: Date | null;
  grossProceedsCents?: number | null;
  netProceedsCents?: number | null;
  costBaseCents?: number | null;
  gainLossCents?: number | null;
}

/** True for a sale whose figures were frozen when it was recorded (so they must never be recalculated). */
export const hasSaleSnapshot = (tx: LedgerTx): boolean => tx.type === "SELL" && tx.costBaseCents != null && tx.netProceedsCents != null && tx.gainLossCents != null;

/**
 * The order the ledger is replayed in: by day, buys before sells on the same day (you can't sell what you haven't
 * bought yet), then by when the row was recorded. Deterministic whatever order the database returns rows in.
 */
export function compareLedger(a: LedgerTx, b: LedgerTx): number {
  const day = dayKey(a.date) - dayKey(b.date);
  if (day !== 0) return day;
  const kind = (a.type === "BUY" ? 0 : 1) - (b.type === "BUY" ? 0 : 1);
  if (kind !== 0) return kind;
  const made = (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  if (made !== 0) return made;
  const ia = a.id ?? "";
  const ib = b.id ?? "";
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

export interface ReplayedSale<T extends LedgerTx = LedgerTx> {
  tx: T;
  /** Cost base allocated to the units sold. */
  costOfSold: number;
  /** Net proceeds (gross − selling fees). */
  proceeds: number;
  /** proceeds − costOfSold: positive = gain, negative = loss. */
  gainLoss: number;
  /** Date of the first purchase recorded up to this sale (the app pools parcels, so this is the best-available acquisition date). */
  firstBuyDate: Date | null;
}

export interface LedgerReplay<T extends LedgerTx = LedgerTx> {
  /** Units held after every transaction, exact. */
  quantityExact: Dec;
  /** Total cost base still held (purchase cost incl. brokerage, less cost allocated to units sold), exact. */
  costBaseExact: Dec;
  quantity: number;
  costBase: number;
  sales: ReplayedSale<T>[];
  hasBuys: boolean;
  hasSells: boolean;
  /** Units and cost base held immediately after each transaction, in replay order (the basis of the transactions table). */
  steps: Array<{ tx: T; quantityAfter: number; costBaseAfter: number }>;
}

/**
 * THE average-cost calculation — the one place buy/sell history is turned into units held, cost base and
 * realised gains, so the Shares page, Capital Gains report, dashboard and tax summary can never disagree.
 *
 *  - BUY: units and cost increase; cost = units × price + brokerage.
 *  - SELL: the cost allocated to the units sold is (cost base held ÷ units held) × units sold — i.e. the
 *    average cost of everything held at that point. The remaining units keep the remaining cost, so the
 *    per-unit cost of what's left is unchanged by a partial sale. Selling the last unit takes all remaining cost.
 *  - A sale recorded with the Sell action carries frozen cents figures; those are used as recorded and never
 *    recalculated. Older SELL rows (no snapshot) are worked out here: proceeds = units × price − brokerage.
 */
export function replayLedger<T extends LedgerTx>(txs: readonly T[]): LedgerReplay<T> {
  let quantity = new D(0);
  let costBase = new D(0);
  let hasBuys = false;
  let hasSells = false;
  let firstBuyDate: Date | null = null;
  const sales: ReplayedSale<T>[] = [];
  const steps: LedgerReplay<T>["steps"] = [];

  for (const tx of [...txs].sort(compareLedger)) {
    const q = dec(tx.quantity);
    if (tx.type === "BUY") {
      hasBuys = true;
      firstBuyDate ??= tx.date;
      quantity = quantity.plus(q);
      costBase = costBase.plus(q.times(dec(tx.pricePerUnit))).plus(dec(tx.brokerage));
      steps.push({ tx, quantityAfter: quantity.toNumber(), costBaseAfter: costBase.toNumber() });
      continue;
    }
    hasSells = true;
    let costOfSold: Dec;
    let proceeds: Dec;
    let gainLoss: Dec;
    if (hasSaleSnapshot(tx)) {
      costOfSold = new D(tx.costBaseCents!).div(100);
      proceeds = new D(tx.netProceedsCents!).div(100);
      gainLoss = new D(tx.gainLossCents!).div(100);
    } else {
      const avgCost = quantity.gt(0) ? costBase.div(quantity) : new D(0);
      costOfSold = avgCost.times(q);
      proceeds = q.times(dec(tx.pricePerUnit)).minus(dec(tx.brokerage));
      gainLoss = proceeds.minus(costOfSold);
    }
    sales.push({ tx, costOfSold: costOfSold.toNumber(), proceeds: proceeds.toNumber(), gainLoss: gainLoss.toNumber(), firstBuyDate });
    quantity = quantity.minus(q);
    costBase = costBase.minus(costOfSold);
    // Nothing left: no cost base left either (drops sub-cent rounding dust from the final allocation).
    if (quantity.isZero()) costBase = new D(0);
    steps.push({ tx, quantityAfter: quantity.toNumber(), costBaseAfter: costBase.toNumber() });
  }

  return { quantityExact: quantity, costBaseExact: costBase, quantity: quantity.toNumber(), costBase: costBase.toNumber(), sales, hasBuys, hasSells, steps };
}

/** One transaction as the Shares & ETFs transactions table shows it. Everything comes from the same replay as the holding totals. */
export interface TransactionRow {
  id: string;
  /** BUY: units × price + brokerage (what it cost). SELL: units × price − fees (net proceeds). */
  totalValue: number;
  /** Units held straight after this transaction. */
  unitsAfter: number;
  /** SELL only: net proceeds − cost base of the units sold (positive = profit). null for a BUY — not applicable. */
  realisedGainLoss: number | null;
}

export function transactionRowsOf(txs: readonly (LedgerTx & { id: string })[]): TransactionRow[] {
  const replay = replayLedger(txs);
  const saleOf = new Map(replay.sales.map((s) => [s.tx.id, s]));
  return replay.steps.map(({ tx, quantityAfter }) => {
    const sale = saleOf.get(tx.id);
    return {
      id: tx.id,
      totalValue: sale ? sale.proceeds : dec(tx.quantity).times(dec(tx.pricePerUnit)).plus(dec(tx.brokerage)).toNumber(),
      unitsAfter: quantityAfter,
      realisedGainLoss: sale ? sale.gainLoss : null,
    };
  });
}

/** The lowest number of units held at any point in the (replayed) ledger — negative means a sale exceeded what was held at that time. */
export function lowestRunningQuantity(txs: readonly LedgerTx[]): { lowest: Dec; at: Date | null } {
  let running = new D(0);
  let lowest = new D(0);
  let at: Date | null = null;
  for (const tx of [...txs].sort(compareLedger)) {
    running = tx.type === "BUY" ? running.plus(dec(tx.quantity)) : running.minus(dec(tx.quantity));
    if (running.lt(lowest)) {
      lowest = running;
      at = tx.date;
    }
  }
  return { lowest, at };
}

/** True when adding `added` to `history` would leave the holding short of units at some point it wasn't short before (a sale of more than was held). */
export function addingLeavesShortfall(history: readonly LedgerTx[], added: LedgerTx): boolean {
  return lowestRunningQuantity([...history, added]).lowest.lt(lowestRunningQuantity(history).lowest.minus(QTY_EPSILON));
}

/** True when removing the transaction `removedId` would leave the holding short of units (e.g. deleting a purchase a later sale relies on). */
export function removingLeavesShortfall(history: readonly (LedgerTx & { id: string })[], removedId: string): boolean {
  return lowestRunningQuantity(history.filter((t) => t.id !== removedId)).lowest.lt(lowestRunningQuantity(history).lowest.minus(QTY_EPSILON));
}

/** Whether (and how many) units of a holding can be sold with the Sell action, and why not if it can't. */
export interface Sellability {
  canSell: boolean;
  /** Units that can be sold right now: the lesser of what the buy/sell history says is held and what the recorded holding says. */
  availableQuantity: number;
  reason: string | null;
}

export function sellabilityOf(args: { type: string; txs: readonly LedgerTx[]; valuation: { units: number } | null }): Sellability {
  if (!(STOCK_TYPES as readonly string[]).includes(args.type)) return { canSell: false, availableQuantity: 0, reason: "Only shares, ETFs and LICs can be sold here." };
  const replay = replayLedger(args.txs);
  if (!replay.hasBuys) return { canSell: false, availableQuantity: 0, reason: "There is no purchase history for this holding, so its cost base is unknown. Add the purchase first (Update holding)." };
  let available = replay.quantityExact;
  if (args.valuation) available = D.min(available, dec(args.valuation.units));
  if (available.lte(QTY_EPSILON)) return { canSell: false, availableQuantity: 0, reason: "No units left to sell." };
  return { canSell: true, availableQuantity: available.toNumber(), reason: null };
}

/** A holding that has been sold down to nothing. Kept (with its history) but no longer an active holding. */
export const isClosedPosition = (args: { hasSells: boolean; unitsHeld: number }): boolean => args.hasSells && args.unitsHeld <= QTY_EPSILON.toNumber();


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

/**
 * Computes quantity held, average cost base, and unrealised gain/loss for one investment from its
 * buy/sell history. Brokerage is added to a buy's cost and deducted from a sell's proceeds — the
 * only place brokerage fees affect the app's figures, however they were recorded (via "Add an
 * investment"'s initial purchase or "Add a buy/sell transaction").
 */
export function computeHoldingSummary(
  txs: LedgerTx[],
  currentValueOverride: number | null,
  valuation: LatestValuation | null = null,
) {
  const replay = replayLedger(txs);
  let realisedGain = 0;
  let realisedLoss = 0;
  // Cost base of the units already sold (the same figure each sale's gain/loss was measured against) —
  // the denominator for a realised percentage return. Not part of the gain/loss itself.
  let realisedCostBase = 0;
  for (const sale of replay.sales) {
    if (sale.gainLoss >= 0) realisedGain += sale.gainLoss;
    else realisedLoss += -sale.gainLoss;
    realisedCostBase += sale.costOfSold;
  }

  const sorted = [...txs].sort(compareLedger);
  const lastPrice = sorted[sorted.length - 1]?.pricePerUnit ?? 0;
  const unitsHeld = valuation ? valuation.units : replay.quantity;
  // A holding sold down to nothing is worth nothing, whatever a manual override or stale price says.
  const closed = isClosedPosition({ hasSells: replay.hasSells, unitsHeld });
  const currentValue = closed ? 0 : currentValueOf({ valuation, override: currentValueOverride, quantity: replay.quantity, lastPrice });
  // A holding imported from a statement has no purchase history, so there's no cost to compare against.
  const costBaseKnown = txs.length > 0;
  const unrealisedGainLoss = costBaseKnown ? currentValue - replay.costBase : 0;

  return { quantity: unitsHeld, costBase: replay.costBase, costBaseKnown, currentValue, unrealisedGainLoss, realisedGain, realisedLoss, realisedCostBase, closed };
}
