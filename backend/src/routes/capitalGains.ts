import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { capitalGainSchema } from "../lib/validation";
import { getFinancialYearId } from "../lib/financialYear";
import { calculateDisposal } from "../lib/capitalGains";
import { replayLedger } from "../services/holdings";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

interface DisposalRow {
  id: string;
  source: "automatic" | "manual";
  investmentId: string;
  investmentName: string;
  ticker: string | null;
  /**
   * Best-available acquisition date. For manual disposals this is the
   * recorded purchase date. For automatic disposals (average-cost method)
   * this is the date of the earliest parcel still held at the time of sale
   * — not a FIFO-matched date, since this app pools parcels by average
   * cost rather than tracking them individually.
   */
  acquisitionDate: Date | null;
  saleDate: Date;
  quantity: number;
  salePrice: number;
  saleCosts: number;
  /** quantity × sale price, before selling fees. */
  grossProceeds: number;
  /** Net proceeds: gross proceeds − selling fees. */
  proceeds: number;
  costBase: number;
  grossGainLoss: number;
  financialYear: string;
  holdingPeriodDays: number | null;
  eligibleForDiscountInformationalOnly: boolean | null;
  notes: string | null;
  hasDocuments: boolean;
  /** When the sale was recorded in the app (not the sale date). */
  recordedAt: Date | null;
  /** How the cost base was allocated, when it was recorded with the Sell action ("AVERAGE_COST"). */
  costMethod: string | null;
}

/**
 * Reads automatic disposals from InvestmentTransaction "SELL" rows
 * (average-cost method — see calculations.ts) and combines them with
 * persisted manual disposals (for assets not tracked as buy/sell
 * transactions — private sales, collectibles, holdings from before you
 * started using this app, etc). This is informational only: it does NOT
 * determine eligibility for the 50% CGT discount or any other tax
 * treatment — see the disclaimer returned alongside every response here.
 */
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const { financialYear } = req.query as Record<string, string>;

    const investments = await prisma.investment.findMany({
      where: { householdId },
      include: { investmentTransactions: { orderBy: { date: "asc" } } },
    });

    const automatic: DisposalRow[] = [];

    for (const inv of investments) {
      // The shared average-cost replay (services/holdings.ts). Sales recorded with the Sell action report the
      // figures frozen when they were recorded; older SELL rows are worked out here.
      for (const { tx, costOfSold, proceeds, gainLoss, firstBuyDate } of replayLedger(inv.investmentTransactions).sales) {
        const fy = getFinancialYearId(tx.date);
        if (financialYear && fy !== financialYear) continue;
        const holdingDays = firstBuyDate ? Math.round((tx.date.getTime() - firstBuyDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
        automatic.push({
          id: tx.id,
          source: "automatic",
          investmentId: inv.id,
          investmentName: inv.name,
          ticker: inv.ticker,
          acquisitionDate: firstBuyDate,
          saleDate: tx.date,
          quantity: tx.quantity,
          salePrice: tx.pricePerUnit,
          saleCosts: tx.brokerage,
          grossProceeds: tx.grossProceedsCents != null ? tx.grossProceedsCents / 100 : tx.quantity * tx.pricePerUnit,
          proceeds,
          costBase: costOfSold,
          grossGainLoss: gainLoss,
          financialYear: fy,
          holdingPeriodDays: holdingDays,
          eligibleForDiscountInformationalOnly: holdingDays !== null ? holdingDays > 365 : null,
          notes: null,
          hasDocuments: false,
          recordedAt: tx.createdAt,
          costMethod: tx.costMethod ?? null,
        });
      }
    }

    const manualRecords = await prisma.capitalGainDisposal.findMany({
      where: { householdId, ...(financialYear ? { financialYear } : {}) },
      include: { investment: true, documents: true },
      orderBy: { saleDate: "desc" },
    });

    const manual: DisposalRow[] = manualRecords.map((d: (typeof manualRecords)[number]) => ({
      id: d.id,
      source: "manual",
      investmentId: d.investmentId,
      investmentName: d.investment.name,
      ticker: d.investment.ticker,
      acquisitionDate: d.purchaseDate,
      saleDate: d.saleDate,
      quantity: d.quantity,
      salePrice: d.salePrice,
      saleCosts: d.saleCosts,
      grossProceeds: d.salePrice * d.quantity * (d.ownershipPercentage / 100),
      proceeds: d.proceeds,
      costBase: d.costBase,
      grossGainLoss: d.grossGainLoss,
      financialYear: d.financialYear,
      holdingPeriodDays: d.holdingPeriodDays,
      eligibleForDiscountInformationalOnly: d.holdingPeriodDays > 365,
      notes: d.notes,
      hasDocuments: d.documents.length > 0,
      recordedAt: d.createdAt,
      costMethod: null,
    }));

    const items = [...automatic, ...manual].sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime());

    const totals = items.reduce(
      (acc: { gains: number; losses: number }, d) => {
        if (d.grossGainLoss >= 0) acc.gains += d.grossGainLoss;
        else acc.losses += -d.grossGainLoss;
        return acc;
      },
      { gains: 0, losses: 0 }
    );

    res.json({
      items,
      totals: { ...totals, net: totals.gains - totals.losses },
      disclaimer:
        "Informational only — CGT discount eligibility and tax treatment depend on your circumstances. Review with your tax adviser.",
    });
  })
);

// --- Manually recorded disposals (persisted) ---------------------------------
// For assets not tracked as buy/sell investment transactions — private
// sales, collectibles, holdings from before you started using this app, etc.

router.post(
  "/manual",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const data = capitalGainSchema.parse(req.body);
    const investment = await prisma.investment.findFirst({ where: { id: data.investmentId, householdId } });
    if (!investment) throw new FriendlyError("We couldn't find this investment.", 404);

    const purchaseCosts = data.purchaseCosts ?? 0;
    const saleCosts = data.saleCosts ?? 0;
    const ownershipPct = data.ownershipPercentage ?? 100;

    const { costBase, proceeds, grossGainLoss, holdingPeriodDays, eligibleForDiscountInformationalOnly } = calculateDisposal({
      purchaseDate: data.purchaseDate,
      purchasePrice: data.purchasePrice,
      purchaseCosts,
      saleDate: data.saleDate,
      salePrice: data.salePrice,
      saleCosts,
      quantity: data.quantity,
      ownershipPercentage: ownershipPct,
    });

    const disposal = await prisma.capitalGainDisposal.create({
      data: {
        householdId,
        investmentId: data.investmentId,
        purchaseDate: data.purchaseDate,
        purchasePrice: data.purchasePrice,
        purchaseCosts,
        saleDate: data.saleDate,
        salePrice: data.salePrice,
        saleCosts,
        quantity: data.quantity,
        ownershipPercentage: ownershipPct,
        costBase,
        proceeds,
        grossGainLoss,
        holdingPeriodDays,
        financialYear: getFinancialYearId(data.saleDate),
        notes: data.notes ?? null,
      },
    });

    res.status(201).json({
      ...disposal,
      eligibleForDiscountInformationalOnly,
      disclaimer: "Informational only — CGT discount eligibility and tax treatment depend on your circumstances. Review with your tax adviser.",
    });
  })
);

router.put(
  "/manual/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.capitalGainDisposal.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this disposal.", 404);

    const data = capitalGainSchema.partial().parse(req.body);

    const purchaseDate = data.purchaseDate ?? existing.purchaseDate;
    const purchasePrice = data.purchasePrice ?? existing.purchasePrice;
    const purchaseCosts = data.purchaseCosts ?? existing.purchaseCosts;
    const saleDate = data.saleDate ?? existing.saleDate;
    const salePrice = data.salePrice ?? existing.salePrice;
    const saleCosts = data.saleCosts ?? existing.saleCosts;
    const quantity = data.quantity ?? existing.quantity;
    const ownershipPct = data.ownershipPercentage ?? existing.ownershipPercentage;

    const { costBase, proceeds, grossGainLoss, holdingPeriodDays } = calculateDisposal({
      purchaseDate,
      purchasePrice,
      purchaseCosts,
      saleDate,
      salePrice,
      saleCosts,
      quantity,
      ownershipPercentage: ownershipPct,
    });

    const disposal = await prisma.capitalGainDisposal.update({
      where: { id: existing.id },
      data: {
        investmentId: data.investmentId ?? existing.investmentId,
        purchaseDate,
        purchasePrice,
        purchaseCosts,
        saleDate,
        salePrice,
        saleCosts,
        quantity,
        ownershipPercentage: ownershipPct,
        costBase,
        proceeds,
        grossGainLoss,
        holdingPeriodDays,
        financialYear: getFinancialYearId(saleDate),
        notes: data.notes !== undefined ? data.notes : existing.notes,
      },
    });

    res.json(disposal);
  })
);

router.delete(
  "/manual/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.capitalGainDisposal.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this disposal.", 404);
    await prisma.capitalGainDisposal.delete({ where: { id: existing.id } });
    res.json({ message: "Disposal removed." });
  })
);

export default router;
