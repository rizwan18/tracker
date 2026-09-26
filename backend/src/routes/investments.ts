import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { investmentSchema, investmentTransactionSchema, investmentValuationSchema, investmentInitialTransactionSchema } from "../lib/validation";
import { computeWeightings, computeHoldingSummary, currentValueOf, valueHolding, type LatestValuation } from "../services/holdings";
import { refreshMarketPrices } from "../services/marketPriceRefresh";
import { isMarketOpen, toMarket } from "../lib/marketHours";
import { STOCK_TYPES } from "../lib/constants";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

/** Whether `inv`'s exchange is trading right now — informational only (see marketPriceRefresh.ts
 * for the actual gate on calling the provider). null for anything that isn't a share/ETF/LIC. */
function marketOpenOf(inv: { type: string; ticker: string | null; market: string | null }): boolean | null {
  if (!STOCK_TYPES.includes(inv.type as (typeof STOCK_TYPES)[number]) || !inv.ticker) return null;
  return isMarketOpen(toMarket(inv.market));
}

type ValuationRow = LatestValuation;

const latestValuation = { valuations: { orderBy: { asAt: "desc" as const }, take: 1 } };
const latestValuation2 = { valuations: { orderBy: { asAt: "desc" as const }, take: 1, select: { marketValueAud: true } } };


function holdingDto(v: ValuationRow | undefined | null, weightingPercent: number | undefined) {
  if (!v) return null;
  return {
    asAt: v.asAt.toISOString(),
    units: v.units,
    marketPrice: v.marketPrice,
    marketValue: v.marketValue,
    marketValueAud: v.marketValueAud,
    currency: v.currency,
    source: v.source,
    weightingPercent: weightingPercent ?? 0,
    // Read-only, blank for now. `marketPrice` / `marketValue*` above are the purchase figures (units × price
    // entered by hand or imported from a broker report); these are reserved for a live market quote.
    currentMarketPrice: null as number | null,
    currentMarketValue: null as number | null,
    // Read-only and blank until a live market value is available to compare against the purchase value.
    unrealisedGainLoss: null as number | null,
  };
}

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const investments = await prisma.investment.findMany({
      where: { householdId },
      include: { investmentTransactions: true, dividends: true, ...latestValuation },
      orderBy: { createdAt: "asc" },
    });
    // Each holding's share of the whole portfolio (as Stake prints "Weighting").
    const weightings = computeWeightings(investments.filter((i) => i.valuations[0]).map((i) => ({ id: i.id, valueAud: i.valuations[0]!.marketValueAud })));
    const withSummary = investments.map((inv) => {
      const { valuations, ...rest } = inv;
      return {
        ...rest,
        summary: computeHoldingSummary(inv.investmentTransactions, inv.currentValueOverride, valuations[0] ?? null),
        holding: holdingDto(valuations[0], weightings.get(inv.id)),
        totalDividends: inv.dividends.filter((d) => d.status === "RECEIVED").reduce((s: number, d) => s + d.netAmount, 0),
        marketOpen: marketOpenOf(inv),
      };
    });
    res.json(withSummary);
  })
);

// Refresh persisted market prices for the household's shares/ETFs from the market-data
// provider — but only for holdings whose exchange is open right now, and not more than once
// a minute per holding (see services/marketPriceRefresh.ts). Called by the frontend once,
// shortly after the Shares and ETFs page has already rendered the stored database values, so
// a slow/failed provider call never blocks or breaks the initial page load. Returns nothing
// useful of its own — the frontend just re-fetches GET /investments afterwards to pick up
// whatever this did or didn't change.
router.post(
  "/refresh-market-prices",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await refreshMarketPrices(householdId);
    res.status(204).end();
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const { valuation, initialTransaction, ...data } = investmentSchema
      .extend({ valuation: investmentValuationSchema.optional().nullable(), initialTransaction: investmentInitialTransactionSchema.optional().nullable() })
      .parse(req.body);
    const values = valuation ? valueHolding(valuation.units, valuation.marketPrice, data.currency, valuation.fxRate ?? null) : null;
    const investment = await prisma.$transaction(async (tx) => {
      const created = await tx.investment.create({
        data: {
          householdId,
          ...data,
          ...(valuation && values
            ? { valuations: { create: { asAt: valuation.asAt, units: valuation.units, marketPrice: valuation.marketPrice, marketValue: values.marketValue, marketValueAud: values.marketValueAud, currency: data.currency, source: "MANUAL" } } }
            : {}),
        },
      });
      // The units/price/date/brokerage entered as the initial purchase become this holding's first
      // BUY transaction — the same record type "Add a buy/sell transaction" creates — so brokerage
      // fees are incorporated into cost base via the app's existing calculation (computeHoldingSummary),
      // with no separate/new methodology.
      if (initialTransaction) {
        await tx.investmentTransaction.create({
          data: { investmentId: created.id, type: "BUY", date: initialTransaction.date, quantity: initialTransaction.quantity, pricePerUnit: initialTransaction.pricePerUnit, brokerage: initialTransaction.brokerage ?? 0 },
        });
      }
      return created;
    });
    res.status(201).json(investment);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const investment = await prisma.investment.findFirst({
      where: { id: req.params.id, householdId },
      include: { investmentTransactions: { orderBy: { date: "asc" } }, dividends: { orderBy: { paymentDate: "desc" } }, valuations: { orderBy: { asAt: "desc" }, take: 24 } },
    });
    if (!investment) throw new FriendlyError("We couldn't find this investment.", 404);
    // Weighting needs every holding's latest value.
    const all = await prisma.investment.findMany({ where: { householdId }, select: { id: true, ...latestValuation2 } });
    const weightings = computeWeightings(all.filter((i) => i.valuations[0]).map((i) => ({ id: i.id, valueAud: i.valuations[0]!.marketValueAud })));
    const latest = investment.valuations[0] ?? null;
    res.json({
      ...investment,
      summary: computeHoldingSummary(investment.investmentTransactions, investment.currentValueOverride, latest),
      holding: holdingDto(latest, weightings.get(investment.id)),
      marketOpen: marketOpenOf(investment),
      valuations: investment.valuations.map((v) => ({ id: v.id, asAt: v.asAt.toISOString(), units: v.units, marketPrice: v.marketPrice, marketValue: v.marketValue, marketValueAud: v.marketValueAud, currency: v.currency, source: v.source })),
    });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.investment.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this investment.", 404);
    const data = investmentSchema.partial().parse(req.body);
    const investment = await prisma.investment.update({ where: { id: existing.id }, data });
    res.json(investment);
  })
);

// Record or update the units and price of a holding as at a date.
router.put(
  "/:id/valuation",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const investment = await prisma.investment.findFirst({ where: { id: req.params.id, householdId } });
    if (!investment) throw new FriendlyError("We couldn't find this investment.", 404);
    const { brokerage, ...data } = investmentValuationSchema.parse(req.body);
    const values = valueHolding(data.units, data.marketPrice, investment.currency, data.fxRate ?? null);
    const fields = { units: data.units, marketPrice: data.marketPrice, marketValue: values.marketValue, marketValueAud: values.marketValueAud, currency: investment.currency, source: "MANUAL" };
    const saved = await prisma.$transaction(async (tx) => {
      const valuation = await tx.investmentValuation.upsert({
        where: { investmentId_asAt: { investmentId: investment.id, asAt: data.asAt } },
        create: { investmentId: investment.id, asAt: data.asAt, ...fields },
        update: fields,
      });
      // The Update Holding form doubles as "record the opening purchase" for investments that
      // don't get bought/sold through the transactions form (crypto, managed funds, term deposits,
      // and a stock's very first purchase). So that brokerage actually reaches the cost base and
      // unrealised gain/loss (computeHoldingSummary reads investmentTransactions, never valuations),
      // keep a single opening BUY transaction in sync with what's entered here. If more than one
      // transaction already exists, the holding has its own trade history — leave it alone rather
      // than guess which one to overwrite; use "Add a buy/sell transaction" for those instead.
      if (brokerage !== undefined && data.units > 0 && data.marketPrice > 0) {
        const existing = await tx.investmentTransaction.findMany({ where: { investmentId: investment.id }, orderBy: { date: "asc" } });
        const openingFields = { type: "BUY" as const, date: data.asAt, quantity: data.units, pricePerUnit: data.marketPrice, brokerage };
        if (existing.length === 0) {
          await tx.investmentTransaction.create({ data: { investmentId: investment.id, ...openingFields } });
        } else if (existing.length === 1 && existing[0].type === "BUY") {
          await tx.investmentTransaction.update({ where: { id: existing[0].id }, data: openingFields });
        }
      }
      return valuation;
    });
    res.json(saved);
  })
);

router.delete(
  "/:id/valuations/:valuationId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const valuation = await prisma.investmentValuation.findFirst({ where: { id: req.params.valuationId, investmentId: req.params.id, investment: { householdId } } });
    if (!valuation) throw new FriendlyError("We couldn't find that entry.", 404);
    await prisma.investmentValuation.delete({ where: { id: valuation.id } });
    res.json({ message: "Removed." });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.investment.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this investment.", 404);
    await prisma.investment.delete({ where: { id: existing.id } });
    res.json({ message: "Investment removed." });
  })
);

router.post(
  "/:id/transactions",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const investment = await prisma.investment.findFirst({ where: { id: req.params.id, householdId } });
    if (!investment) throw new FriendlyError("We couldn't find this investment.", 404);
    const data = investmentTransactionSchema.parse(req.body);
    const tx = await prisma.investmentTransaction.create({
      data: { investmentId: investment.id, ...data, brokerage: data.brokerage ?? 0 },
    });
    res.status(201).json(tx);
  })
);

router.delete(
  "/transactions/:txId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const tx = await prisma.investmentTransaction.findFirst({
      where: { id: req.params.txId, investment: { householdId } },
    });
    if (!tx) throw new FriendlyError("We couldn't find this transaction.", 404);
    await prisma.investmentTransaction.delete({ where: { id: tx.id } });
    res.json({ message: "Transaction removed." });
  })
);

export default router;
