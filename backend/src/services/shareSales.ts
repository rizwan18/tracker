/**
 * Selling shares: validating a sale against the holding, working out the capital gain/loss, and recording it.
 *
 * How it fits the existing app
 *  - The buy/sell ledger (InvestmentTransaction) stays the source of truth. A confirmed sale is one new SELL row;
 *    nothing is overwritten or deleted, and a fully sold holding keeps all of its history.
 *  - Realised gains on the Shares page, Capital Gains report, dashboard and tax summary all come from SELL rows
 *    (services/holdings.ts → replayLedger), so a recorded sale flows into every one of them with no separate bookkeeping.
 *  - The sale's figures (gross/net proceeds, allocated cost base, gain/loss) are frozen on the row in whole cents at
 *    confirmation, so they never change when a market price moves or a purchase is later edited.
 *  - If the holding has a recorded unit count (InvestmentValuation — what the Shares table shows as Units), that is
 *    reduced by the units sold in the same transaction, so the table, weightings and totals stay consistent.
 *
 * Cost-base method: average cost. The cost allocated to the units sold is (cost base held ÷ units held) × units sold,
 * measured at the sale date. The units left keep the remaining cost base, so a partial sale never silently changes the
 * per-unit cost of what is still held. See lib/shareSale.ts for the formulas.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { FriendlyError } from "../middleware/errorHandler";
import { STOCK_TYPES } from "../lib/constants";
import { D, dec, MAX_CENTS, QTY_EPSILON, toCentsInt } from "../lib/decimal";
import { COST_METHOD, computeSale, outcomeOf, type SaleFigures, type SaleOutcome } from "../lib/shareSale";
import type { ShareSaleInput, ShareSaleRecordInput } from "../lib/validation";
import { dayKey, lowestRunningQuantity, replayLedger, sellabilityOf, valueHolding, type LedgerTx } from "./holdings";

/** A sale dated up to a day ahead of the server clock is accepted: "today" for a user ahead of UTC (e.g. Melbourne) is already tomorrow in UTC. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface SaleHolding {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  currency: string;
}

export interface SaleValuation {
  asAt: Date;
  units: number;
  marketPrice: number;
  currency: string;
  source: string;
}

/** The holding's recorded unit count after the sale — written as a dated InvestmentValuation row. */
export interface ValuationWrite {
  asAt: Date;
  units: number;
  marketPrice: number;
  marketValue: number;
  marketValueAud: number;
  currency: string;
  source: string;
  /** True when it replaces the existing latest row (same date) rather than adding a newer one. */
  replacesLatest: boolean;
}

export interface SalePlan {
  figures: SaleFigures;
  saleDate: Date;
  pricePerShare: number;
  fees: number;
  /** Units that could be sold right now, before this sale. */
  availableQuantity: number;
  valuation: ValuationWrite | null;
}

const fmtQty = (d: { toString(): string }) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 8 }).format(Number(d.toString()));
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Checks a proposed sale against the holding's history and works out its figures. Pure: everything it needs is passed
 * in, so every rule here is tested without a database. Throws a FriendlyError (with an actionable message) when the sale
 * can't be recorded.
 */
export function planShareSale(args: {
  holding: SaleHolding;
  transactions: readonly LedgerTx[];
  latestValuation: SaleValuation | null;
  input: ShareSaleInput;
  now: Date;
}): SalePlan {
  const { holding, transactions, latestValuation, input, now } = args;
  const label = holding.ticker ?? holding.name;

  if (!(STOCK_TYPES as readonly string[]).includes(holding.type)) throw new FriendlyError("Only shares, ETFs and LICs can be sold here.", 409);
  if (input.saleDate.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw new FriendlyError("The sale date can't be in the future.", 400);

  const quantity = dec(input.quantity);
  const price = dec(input.pricePerShare);
  const fees = dec(input.fees);

  // 1. Is there anything to sell right now, and is the quantity within it?
  const sellable = sellabilityOf({ type: holding.type, txs: transactions, valuation: latestValuation });
  if (!sellable.canSell) throw new FriendlyError(sellable.reason ?? "This holding can't be sold.", 409);
  if (quantity.minus(dec(sellable.availableQuantity)).gt(QTY_EPSILON)) {
    throw new FriendlyError(`You can't sell ${fmtQty(quantity)} shares of ${label} — only ${fmtQty(dec(sellable.availableQuantity))} ${sellable.availableQuantity === 1 ? "is" : "are"} available to sell.`, 400);
  }

  // 2. What was held on the sale date? (Matters for a sale dated in the past: it is measured against what you held
  //    then, not what you hold now.)
  const saleDay = dayKey(input.saleDate);
  const heldThen = replayLedger(transactions.filter((t) => dayKey(t.date) <= saleDay));
  if (!heldThen.hasBuys) {
    const firstBuy = transactions.filter((t) => t.type === "BUY").sort((a, b) => a.date.getTime() - b.date.getTime())[0];
    throw new FriendlyError(`You can't record a sale on ${fmtDay(input.saleDate)} — your first purchase of ${label} was on ${firstBuy ? fmtDay(firstBuy.date) : "a later date"}.`, 400);
  }
  if (quantity.minus(heldThen.quantityExact).gt(QTY_EPSILON)) {
    throw new FriendlyError(`You can't sell ${fmtQty(quantity)} shares of ${label} on ${fmtDay(input.saleDate)} — you only held ${fmtQty(heldThen.quantityExact)} then.`, 400);
  }

  // 3. A sale dated in the past mustn't leave a later sale short of shares.
  const newSale: LedgerTx = { id: "~new", type: "SELL", date: input.saleDate, quantity: input.quantity, pricePerUnit: input.pricePerShare, brokerage: input.fees, createdAt: now };
  const without = lowestRunningQuantity(transactions);
  const withSale = lowestRunningQuantity([...transactions, newSale]);
  if (withSale.lowest.lt(without.lowest.minus(QTY_EPSILON))) {
    throw new FriendlyError(`Recording this sale on ${fmtDay(input.saleDate)} would leave your later sales of ${label} short of shares. Check the date and quantity.`, 400);
  }

  // 4. The figures.
  const figures = computeSale({ quantity, pricePerShare: price, fees, poolQuantity: heldThen.quantityExact, poolCostBase: heldThen.costBaseExact });
  const biggest = Math.max(Math.abs(figures.grossProceedsCents), Math.abs(figures.netProceedsCents), Math.abs(figures.costBaseCents), Math.abs(figures.gainLossCents));
  if (biggest > MAX_CENTS) throw new FriendlyError(`This sale is too large to record in one go (the limit is about $${new Intl.NumberFormat("en-AU").format(Math.floor(MAX_CENTS / 100))} per sale). Record it as several smaller sales.`, 400);

  // 5. The recorded unit count, if the holding has one.
  let valuation: ValuationWrite | null = null;
  if (latestValuation) {
    let units = dec(latestValuation.units).minus(quantity);
    if (units.lte(QTY_EPSILON)) units = new D(0);
    const replacesLatest = input.saleDate.getTime() <= latestValuation.asAt.getTime();
    const values = valueHolding(units.toNumber(), latestValuation.marketPrice, latestValuation.currency);
    valuation = {
      asAt: replacesLatest ? latestValuation.asAt : input.saleDate,
      units: units.toNumber(),
      marketPrice: latestValuation.marketPrice,
      ...values,
      currency: latestValuation.currency,
      source: replacesLatest ? latestValuation.source : "SALE",
      replacesLatest,
    };
  }

  return { figures, saleDate: input.saleDate, pricePerShare: input.pricePerShare, fees: input.fees, availableQuantity: sellable.availableQuantity, valuation };
}

// ---------------------------------------------------------------------------------------------------------------
// What the API returns
// ---------------------------------------------------------------------------------------------------------------

export interface SaleDto {
  id: string;
  investmentId: string;
  saleDate: string;
  quantity: number;
  pricePerShare: number;
  grossProceedsCents: number;
  feesCents: number;
  netProceedsCents: number;
  costBaseCents: number;
  gainLossCents: number;
  outcome: SaleOutcome;
  costMethod: string;
  recordedAt: string;
}

type SaleRow = {
  id: string;
  investmentId: string;
  date: Date;
  quantity: number;
  pricePerUnit: number;
  brokerage: number;
  grossProceedsCents: number | null;
  netProceedsCents: number | null;
  costBaseCents: number | null;
  gainLossCents: number | null;
  costMethod: string | null;
  createdAt: Date;
};

export function saleDtoOf(row: SaleRow): SaleDto {
  return {
    id: row.id,
    investmentId: row.investmentId,
    saleDate: row.date.toISOString(),
    quantity: row.quantity,
    pricePerShare: row.pricePerUnit,
    grossProceedsCents: row.grossProceedsCents ?? 0,
    feesCents: toCentsInt(dec(row.brokerage)),
    netProceedsCents: row.netProceedsCents ?? 0,
    costBaseCents: row.costBaseCents ?? 0,
    gainLossCents: row.gainLossCents ?? 0,
    outcome: outcomeOf(row.gainLossCents ?? 0),
    costMethod: row.costMethod ?? COST_METHOD,
    recordedAt: row.createdAt.toISOString(),
  };
}

export interface SalePreviewDto extends SaleFigures {
  investmentId: string;
  name: string;
  ticker: string | null;
  currency: string;
  saleDate: string;
  pricePerShare: number;
  availableQuantity: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------------------------

type Db = Prisma.TransactionClient;

async function loadState(db: Db, householdId: string, investmentId: string) {
  const investment = await db.investment.findFirst({ where: { id: investmentId, householdId } });
  if (!investment) throw new FriendlyError("We couldn't find this investment.", 404);
  const [transactions, latest] = await Promise.all([
    db.investmentTransaction.findMany({ where: { investmentId } }),
    db.investmentValuation.findFirst({ where: { investmentId }, orderBy: { asAt: "desc" } }),
  ]);
  const holding: SaleHolding = { id: investment.id, name: investment.name, ticker: investment.ticker, type: investment.type, currency: investment.currency };
  const latestValuation: SaleValuation | null = latest ? { asAt: latest.asAt, units: latest.units, marketPrice: latest.marketPrice, currency: latest.currency, source: latest.source } : null;
  return { holding, transactions, latestValuation };
}

/** Works out a sale without saving anything — what the Sell form shows for review. */
export async function previewShareSale(householdId: string, investmentId: string, input: ShareSaleInput, now: Date = new Date()): Promise<SalePreviewDto> {
  const { holding, transactions, latestValuation } = await loadState(prisma, householdId, investmentId);
  const plan = planShareSale({ holding, transactions, latestValuation, input, now });
  return {
    ...plan.figures,
    investmentId: holding.id,
    name: holding.name,
    ticker: holding.ticker,
    currency: holding.currency,
    saleDate: plan.saleDate.toISOString(),
    pricePerShare: plan.pricePerShare,
    availableQuantity: plan.availableQuantity,
  };
}

export interface RecordedSale {
  /** True when this request id had already been recorded — the existing sale is returned and nothing new is written. */
  duplicate: boolean;
  sale: SaleDto;
  remainingQuantity: number;
  closed: boolean;
}

const isUniqueViolation = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

function sameRequest(existing: SaleRow, input: ShareSaleRecordInput): boolean {
  return (
    existing.quantity === input.quantity &&
    existing.pricePerUnit === input.pricePerShare &&
    existing.brokerage === input.fees &&
    dayKey(existing.date) === dayKey(input.saleDate)
  );
}

async function existingByRequest(db: Db, investmentId: string, clientRequestId: string) {
  return db.investmentTransaction.findUnique({ where: { investmentId_clientRequestId: { investmentId, clientRequestId } } });
}

/**
 * Records a confirmed sale. The sale row and the holding update are written in ONE database transaction, so a failure
 * leaves both exactly as they were.
 *
 * Two safeguards against bad data from concurrent or repeated requests:
 *  - The investment row is updated first, which takes a row lock held until the transaction ends: two sales of the same
 *    holding are therefore processed one after the other, each seeing the other's result (no overselling).
 *  - `clientRequestId` is unique per holding: submitting the same sale twice records it once and returns the original.
 */
export async function recordShareSale(householdId: string, investmentId: string, input: ShareSaleRecordInput, now: Date = new Date()): Promise<RecordedSale> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const locked = await tx.investment.updateMany({ where: { id: investmentId, householdId }, data: { updatedAt: now } });
        if (locked.count === 0) throw new FriendlyError("We couldn't find this investment.", 404);

        const already = await existingByRequest(tx, investmentId, input.clientRequestId);
        if (already) return duplicateOf(tx, householdId, already, input);

        const { holding, transactions, latestValuation } = await loadState(tx, householdId, investmentId);
        const plan = planShareSale({ holding, transactions, latestValuation, input, now });
        const f = plan.figures;

        const created = await tx.investmentTransaction.create({
          data: {
            investmentId,
            type: "SELL",
            date: plan.saleDate,
            quantity: input.quantity,
            pricePerUnit: input.pricePerShare,
            brokerage: input.fees,
            grossProceedsCents: f.grossProceedsCents,
            netProceedsCents: f.netProceedsCents,
            costBaseCents: f.costBaseCents,
            gainLossCents: f.gainLossCents,
            costMethod: f.costMethod,
            clientRequestId: input.clientRequestId,
          },
        });

        const v = plan.valuation;
        if (v) {
          const fields = { units: v.units, marketPrice: v.marketPrice, marketValue: v.marketValue, marketValueAud: v.marketValueAud, currency: v.currency, source: v.source };
          await tx.investmentValuation.upsert({
            where: { investmentId_asAt: { investmentId, asAt: v.asAt } },
            create: { investmentId, asAt: v.asAt, ...fields },
            update: fields,
          });
        }

        return { duplicate: false, sale: saleDtoOf(created), remainingQuantity: f.remainingQuantity, closed: f.closesHolding };
      },
      { maxWait: 5_000, timeout: 20_000 }
    );
  } catch (e) {
    // Two identical requests raced past the check above: the database's unique key let one through. Return that one.
    if (isUniqueViolation(e)) {
      const existing = await existingByRequest(prisma, investmentId, input.clientRequestId);
      if (existing) return duplicateOf(prisma, householdId, existing, input);
    }
    throw e;
  }
}

/** The answer to a repeated request: the sale that was already recorded, plus what the holding looks like now. */
async function duplicateOf(db: Db, householdId: string, existing: SaleRow, input: ShareSaleRecordInput): Promise<RecordedSale> {
  if (!sameRequest(existing, input)) throw new FriendlyError("This request was already used for a different sale. Please start the sale again.", 409);
  const { transactions, latestValuation } = await loadState(db, householdId, existing.investmentId);
  const unitsHeld = latestValuation ? latestValuation.units : replayLedger(transactions).quantity;
  return { duplicate: true, sale: saleDtoOf(existing), remainingQuantity: unitsHeld, closed: unitsHeld <= QTY_EPSILON.toNumber() };
}
