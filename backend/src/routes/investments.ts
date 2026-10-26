import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { z } from "zod";
import { investmentSchema, investmentTransactionSchema, investmentTransactionEditSchema, investmentValuationSchema, investmentInitialTransactionSchema, shareSaleSchema, shareSaleRecordSchema } from "../lib/validation";
import { computeWeightings, computeHoldingSummary, currentValueOf, hasSaleSnapshot, addingLeavesShortfall, removingLeavesShortfall, sellabilityOf, transactionRowsOf, valueHolding, type LatestValuation } from "../services/holdings";
import { resolveBrokerAccountId } from "../services/brokerAccounts";
import { editInvestmentTransaction } from "../services/transactionEdits";
import { previewShareSale, recordShareSale } from "../services/shareSales";
import { refreshMarketPrices } from "../services/marketPriceRefresh";
import { isMarketOpen, toMarket } from "../lib/marketHours";
import { STOCK_TYPES } from "../lib/constants";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

/** Parses a request body, turning the first problem into a plain-English message (not just the field name). */
function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new FriendlyError(result.error.issues[0]?.message ?? "Please check the details and try again.", 400);
  return result.data;
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
        transactionRows: transactionRowsOf(inv.investmentTransactions),
        holding: holdingDto(valuations[0], weightings.get(inv.id)),
        sellable: sellabilityOf({ type: inv.type, txs: inv.investmentTransactions, valuation: valuations[0] ?? null }),
        totalDividends: inv.dividends.filter((d) => d.status === "RECEIVED").reduce((s: number, d) => s + d.netAmount, 0),
        marketOpen: marketOpenOf(inv),
      };
    });
    res.json(withSummary);
  })
);

// Refresh persisted market prices for the household's shares/ETFs from the market-data
// provider — at most once a minute per holding while its exchange is open, and at most once
// every 24 hours while it's closed (see lib/priceRefreshPolicy.ts). Called by the frontend once,
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
        const brokerAccountId = await resolveBrokerAccountId(tx, householdId, initialTransaction.brokerAccountId);
        await tx.investmentTransaction.create({
          data: { investmentId: created.id, type: "BUY", date: initialTransaction.date, quantity: initialTransaction.quantity, pricePerUnit: initialTransaction.pricePerUnit, brokerage: initialTransaction.brokerage ?? 0, brokerAccountId },
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
      transactionRows: transactionRowsOf(investment.investmentTransactions),
      holding: holdingDto(latest, weightings.get(investment.id)),
      sellable: sellabilityOf({ type: investment.type, txs: investment.investmentTransactions, valuation: latest }),
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
    const { brokerage, brokerAccountId: chosenAccountId, ...data } = investmentValuationSchema.parse(req.body);
    const brokerAccountId = await resolveBrokerAccountId(prisma, householdId, chosenAccountId);
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
        // Keep a previously chosen broker account unless a different one was picked now.
        const openingFields = { type: "BUY" as const, date: data.asAt, quantity: data.units, pricePerUnit: data.marketPrice, brokerage };
        const only = existing.length === 1 ? existing[0] : undefined;
        if (existing.length === 0) {
          await tx.investmentTransaction.create({ data: { investmentId: investment.id, ...openingFields, brokerAccountId } });
        } else if (only && only.type === "BUY") {
          await tx.investmentTransaction.update({ where: { id: only.id }, data: { ...openingFields, ...(brokerAccountId ? { brokerAccountId } : {}) } });
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

// --- Selling shares ----------------------------------------------------------------------------------------------
// Preview: work out the proceeds, allocated cost base and capital gain/loss for a proposed sale without saving
// anything. This is what the Sell form shows for review, so what the person confirms is what the server will record.
router.post(
  "/:id/sales/preview",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const input = parseBody(shareSaleSchema, req.body);
    res.json(await previewShareSale(householdId, req.params.id as string, input));
  })
);

// Record a confirmed sale (see services/shareSales.ts). Repeating a request with the same clientRequestId records the
// sale once: the original is returned again (200) instead of creating a second one (201).
router.post(
  "/:id/sales",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const input = parseBody(shareSaleRecordSchema, req.body);
    const result = await recordShareSale(householdId, req.params.id as string, input);
    res.status(result.duplicate ? 200 : 201).json(result);
  })
);

router.post(
  "/:id/transactions",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const investment = await prisma.investment.findFirst({ where: { id: req.params.id, householdId } });
    if (!investment) throw new FriendlyError("We couldn't find this investment.", 404);
    const { brokerAccountId: chosenAccountId, ...data } = investmentTransactionSchema.parse(req.body);
    const brokerAccountId = await resolveBrokerAccountId(prisma, householdId, chosenAccountId);
    // A sale of units that aren't held would leave a negative holding, so a hand-entered SELL is checked against the history first.
    if (data.type === "SELL") {
      const history = await prisma.investmentTransaction.findMany({ where: { investmentId: investment.id } });
      const probe = { id: "~new", type: "SELL", date: data.date, quantity: data.quantity, pricePerUnit: data.pricePerUnit, brokerage: data.brokerage ?? 0, createdAt: new Date() };
      if (addingLeavesShortfall(history, probe)) {
        throw new FriendlyError("You can't sell more units than you held on that date. Check the date and the number of units.", 400);
      }
    }
    const tx = await prisma.investmentTransaction.create({
      data: { investmentId: investment.id, ...data, brokerage: data.brokerage ?? 0, brokerAccountId },
    });
    res.status(201).json(tx);
  })
);

// Correct any field of a recorded transaction (including which security it belongs to). Holdings, cost base and gains are derived
// from the history, and the stored sale figures are recomputed in the same database transaction — see services/transactionEdits.ts.
router.put(
  "/transactions/:txId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const input = parseBody(investmentTransactionEditSchema, req.body);
    res.json(await editInvestmentTransaction(householdId, req.params.txId as string, input));
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
    // A sale recorded with the Sell action is a permanent record: deleting it would quietly rewrite realised gains and
    // leave the holding's units out of step. (Older SELL rows entered by hand can still be removed as before.)
    if (hasSaleSnapshot(tx)) throw new FriendlyError("A recorded share sale can't be deleted, because that would change your realised gains history.", 409);
    // Removing a purchase that later sales rely on would leave a negative holding.
    const history = await prisma.investmentTransaction.findMany({ where: { investmentId: tx.investmentId } });
    if (removingLeavesShortfall(history, tx.id)) {
      throw new FriendlyError("This purchase can't be removed because a later sale relies on those units. Remove or change that sale first.", 409);
    }
    await prisma.investmentTransaction.delete({ where: { id: tx.id } });
    res.json({ message: "Transaction removed." });
  })
);

export default router;
