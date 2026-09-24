import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import multer from "multer";
import { investmentSchema, investmentTransactionSchema, investmentValuationSchema } from "../lib/validation";
import { computeWeightings, currentValueOf, valueHolding, type LatestValuation } from "../services/holdings";
import { parseStakeReport, StakeParseError } from "../services/stake/parseStakeReport";
import { planStakeImport, type StakePlan } from "../services/stake/planStakeImport";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

type ValuationRow = LatestValuation;

/** Computes quantity held, average cost base, and unrealised gain/loss for one investment. */
function computeHoldingSummary(txs: { type: string; quantity: number; pricePerUnit: number; brokerage: number; date: Date }[], currentValueOverride: number | null, valuation: ValuationRow | null = null) {
  let quantity = 0;
  let costBase = 0;
  let realisedGain = 0;
  let realisedLoss = 0;

  const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const tx of sorted) {
    if (tx.type === "BUY") {
      quantity += tx.quantity;
      costBase += tx.quantity * tx.pricePerUnit + tx.brokerage;
    } else {
      const avgCost = quantity > 0 ? costBase / quantity : 0;
      const costOfSold = avgCost * tx.quantity;
      const proceeds = tx.quantity * tx.pricePerUnit - tx.brokerage;
      const gainLoss = proceeds - costOfSold;
      if (gainLoss >= 0) realisedGain += gainLoss;
      else realisedLoss += -gainLoss;
      quantity -= tx.quantity;
      costBase -= costOfSold;
    }
  }

  const lastPrice = sorted[sorted.length - 1]?.pricePerUnit ?? 0;
  const currentValue = currentValueOf({ valuation, override: currentValueOverride, quantity, lastPrice });
  // A holding imported from a statement has no purchase history, so there's no cost to compare against.
  const costBaseKnown = txs.length > 0;
  const unrealisedGainLoss = costBaseKnown ? currentValue - costBase : 0;

  return { quantity: valuation ? valuation.units : quantity, costBase, costBaseKnown, currentValue, unrealisedGainLoss, realisedGain, realisedLoss };
}

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
    // entered by hand or imported from a broker report); these two are reserved for a live market quote.
    currentMarketPrice: null as number | null,
    currentMarketValue: null as number | null,
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
      };
    });
    res.json(withSummary);
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const { valuation, ...data } = investmentSchema.extend({ valuation: investmentValuationSchema.optional().nullable() }).parse(req.body);
    const values = valuation ? valueHolding(valuation.units, valuation.marketPrice, data.currency, valuation.fxRate ?? null) : null;
    if (valuation && !values) throw new FriendlyError("Please enter the exchange rate (A$ per US$) for a US holding.", 400);
    const investment = await prisma.investment.create({
      data: {
        householdId,
        ...data,
        ...(valuation && values
          ? { valuations: { create: { asAt: valuation.asAt, units: valuation.units, marketPrice: valuation.marketPrice, marketValue: values.marketValue, marketValueAud: values.marketValueAud, currency: data.currency, source: "MANUAL" } } }
          : {}),
      },
    });
    res.status(201).json(investment);
  })
);

// Import a Stake "Portfolio Valuation" report (.xlsx): preview first (dryRun), then apply.
const stakeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5_000_000, files: 1 } }).single("file");

function receiveStakeUpload(req: AuthedRequest, res: Parameters<typeof stakeUpload>[1]): Promise<void> {
  return new Promise((resolve, reject) => {
    stakeUpload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return reject(new FriendlyError("That file is larger than 5 MB, which is too big for a Stake report.", 413));
      reject(new FriendlyError("We couldn't read that upload. Please choose the Stake report (.xlsx).", 400));
    });
  });
}

router.post(
  "/import/stake",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await receiveStakeUpload(req, res);
    if (!req.file) throw new FriendlyError("Please choose the Stake report (.xlsx) to import.", 400);
    const dryRun = req.body?.dryRun !== "false";
    const zeroMissing = req.body?.zeroMissing !== "false";

    let report;
    try {
      report = parseStakeReport(new Uint8Array(req.file.buffer));
    } catch (err) {
      if (err instanceof StakeParseError) throw new FriendlyError(err.message, 400);
      throw err;
    }
    const asAt = new Date(`${report.statementDate}T00:00:00.000Z`);
    if (asAt.getTime() > Date.now() + 2 * 24 * 60 * 60 * 1000) throw new FriendlyError("The statement date is in the future — please check the report.", 400);

    const existing = await prisma.investment.findMany({ where: { householdId }, include: latestValuation });
    const atDate = await prisma.investmentValuation.findMany({
      where: { investment: { householdId }, asAt },
      select: { investmentId: true, units: true, marketPrice: true, marketValueAud: true },
    });
    const plan = planStakeImport(
      report,
      existing.map((e) => ({ id: e.id, name: e.name, ticker: e.ticker, type: e.type, market: e.market, currency: e.currency, createdAt: e.createdAt, latest: e.valuations[0] ? { asAt: e.valuations[0].asAt, source: e.valuations[0].source } : null })),
      atDate,
      { zeroMissing }
    );

    const preview = {
      report: { reportType: report.reportType, ownerName: report.ownerName, statementDate: report.statementDate, generatedOn: report.generatedOn, defaultCurrency: report.defaultCurrency },
      warnings: [...report.warnings, ...plan.warnings],
      holdings: plan.rows.map((r) => ({ ...r.holding, action: r.action, existingName: r.existingName, investmentType: r.investmentType })),
      missing: plan.missing,
      counts: plan.counts,
    };
    if (dryRun) return res.json({ dryRun: true, ...preview });

    await applyStakePlan(householdId, plan, asAt, zeroMissing);
    res.json({ dryRun: false, ...preview });
  })
);

async function applyStakePlan(householdId: string, plan: StakePlan, asAt: Date, zeroMissing: boolean) {
  await prisma.$transaction(
    async (tx) => {
      for (const row of plan.rows) {
        if (row.action === "unchanged") continue;
        const h = row.holding;
        let investmentId = row.investmentId;
        if (!investmentId) {
          const created = await tx.investment.create({ data: { householdId, name: h.name, ticker: h.symbol, type: row.investmentType, market: h.market, currency: h.currency } });
          investmentId = created.id;
        } else {
          // Older records don't know their market — fill it in now that we do.
          await tx.investment.updateMany({ where: { id: investmentId, householdId, market: null }, data: { market: h.market, currency: h.currency } });
        }
        const values = { units: h.units, marketPrice: h.marketPrice, marketValue: h.marketValue, marketValueAud: h.marketValueAud, currency: h.currency, source: "STAKE" };
        await tx.investmentValuation.upsert({ where: { investmentId_asAt: { investmentId, asAt } }, create: { investmentId, asAt, ...values }, update: values });
      }
      if (zeroMissing) {
        for (const m of plan.missing) {
          const zero = { units: 0, marketPrice: 0, marketValue: 0, marketValueAud: 0, currency: m.currency, source: "STAKE" };
          await tx.investmentValuation.upsert({ where: { investmentId_asAt: { investmentId: m.investmentId, asAt } }, create: { investmentId: m.investmentId, asAt, ...zero }, update: zero });
        }
      }
    },
    { timeout: 20000 }
  );
}

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
    const data = investmentValuationSchema.parse(req.body);
    const values = valueHolding(data.units, data.marketPrice, investment.currency, data.fxRate ?? null);
    if (!values) throw new FriendlyError("Please enter the exchange rate (A$ per US$) for a US holding.", 400);
    const fields = { units: data.units, marketPrice: data.marketPrice, marketValue: values.marketValue, marketValueAud: values.marketValueAud, currency: investment.currency, source: "MANUAL" };
    const saved = await prisma.investmentValuation.upsert({
      where: { investmentId_asAt: { investmentId: investment.id, asAt: data.asAt } },
      create: { investmentId: investment.id, asAt: data.asAt, ...fields },
      update: fields,
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
