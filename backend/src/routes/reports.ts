import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { getFinancialYearByStartYear, parseFinancialYearId, getCurrentFinancialYear } from "../lib/financialYear";
import * as calc from "../services/calculations";
import { replayLedger, type LedgerTx } from "../services/holdings";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

function resolveFy(req: AuthedRequest) {
  const fyParam = req.query.financialYear as string | undefined;
  return fyParam ? getFinancialYearByStartYear(parseFinancialYearId(fyParam)) : getCurrentFinancialYear();
}

type InvTx = LedgerTx;

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))];
  return lines.join("\n");
}

// --- Financial Year Report --------------------------------------------------
router.get(
  "/financial-year",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const fy = resolveFy(req);
    const [income, expenses, propIncome, invIncome, dividends, gains, household] = await Promise.all([
      calc.totalIncome(householdId, fy.id),
      calc.totalExpenses(householdId, fy.id),
      calc.propertyIncome(householdId, fy.id),
      calc.investmentIncome(householdId, fy.id),
      calc.dividendIncome(householdId, fy.id),
      calc.totalRealisedCapitalGains(householdId, fy.id),
      prisma.household.findUnique({ where: { id: householdId } }),
    ]);
    res.json({
      householdName: household?.name,
      financialYear: fy.label,
      generatedAt: new Date(),
      totalIncome: income,
      totalExpenses: expenses,
      netIncome: income - expenses,
      propertyIncome: propIncome,
      investmentIncome: invIncome,
      dividends,
      capitalGains: gains,
      footer: "Prepared from records entered into the application. Review with your tax adviser.",
    });
  })
);

// --- Property Report ---------------------------------------------------------
router.get(
  "/property",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const fy = resolveFy(req);
    // Rental report: investment properties only (a principal place of residence has no rental income).
    const properties = await prisma.property.findMany({ where: { householdId, propertyType: "INVESTMENT" } });
    const rows = await Promise.all(
      properties.map(async (p: { id: string; name: string }) => {
        const [incomeAgg, expenseAgg] = await Promise.all([
          prisma.transaction.aggregate({ where: { propertyId: p.id, direction: "INCOME", financialYear: fy.id }, _sum: { amount: true } }),
          prisma.transaction.aggregate({ where: { propertyId: p.id, direction: "EXPENSE", financialYear: fy.id }, _sum: { amount: true } }),
        ]);
        const rentalIncome = incomeAgg._sum.amount ?? 0;
        const expenses = expenseAgg._sum.amount ?? 0;
        return { property: p.name, rentalIncome, expenses, netRentalIncome: rentalIncome - expenses };
      })
    );
    res.json({ financialYear: fy.label, properties: rows, footer: "Prepared from records entered into the application. Review with your tax adviser." });
  })
);

// --- Investment Report -------------------------------------------------------
router.get(
  "/investment",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const fy = resolveFy(req);
    const investments = await prisma.investment.findMany({
      where: { householdId },
      include: { investmentTransactions: true, dividends: { where: { financialYear: fy.id } } },
    });
    const rows = investments.map((inv: { name: string; ticker: string | null; investmentTransactions: InvTx[]; currentValueOverride: number | null; dividends: { status: string; netAmount: number }[] }) => {
      // The shared average-cost replay (services/holdings.ts) — same figures as the Shares page and Capital Gains report.
      const replay = replayLedger(inv.investmentTransactions);
      const qty = replay.quantity;
      const costBase = replay.costBase;
      const realised = replay.sales.reduce((sum, sale) => sum + sale.gainLoss, 0);
      const lastPrice = [...inv.investmentTransactions].sort((a, b) => b.date.getTime() - a.date.getTime())[0]?.pricePerUnit ?? 0;
      const currentValue = inv.currentValueOverride ?? qty * lastPrice;
      const dividendIncomeFy = inv.dividends.filter((d) => d.status === "RECEIVED").reduce((s: number, d) => s + d.netAmount, 0);
      return {
        investment: inv.name,
        ticker: inv.ticker,
        quantityHeld: qty,
        costBase,
        currentValue,
        unrealisedGainLoss: currentValue - costBase,
        realisedGainLossFy: realised,
        dividendIncomeFy,
      };
    });
    res.json({ financialYear: fy.label, holdings: rows, footer: "Prepared from records entered into the application. Review with your tax adviser." });
  })
);

// --- Tax Information Report --------------------------------------------------
router.get(
  "/tax-summary",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const fy = resolveFy(req);
    const [income, expenses, propIncome, propExpenses, invIncome, dividends, franking, gains] = await Promise.all([
      calc.totalIncome(householdId, fy.id),
      calc.totalExpenses(householdId, fy.id),
      calc.propertyIncome(householdId, fy.id),
      calc.propertyExpenses(householdId, fy.id),
      calc.investmentIncome(householdId, fy.id),
      calc.dividendIncome(householdId, fy.id),
      calc.frankingCredits(householdId, fy.id),
      calc.totalRealisedCapitalGains(householdId, fy.id),
    ]);

    const potentialExpenses = await prisma.transaction.findMany({
      where: { householdId, financialYear: fy.id, direction: "EXPENSE", potentialTaxCategory: { not: null } },
      include: { category: true, property: true, documents: true },
      orderBy: { date: "desc" },
    });

    res.json({
      financialYear: fy.label,
      disclaimer:
        "This information is provided for record-keeping and planning purposes only and is not tax or financial advice. Tax treatment can vary depending on your circumstances. Review your records with a registered tax professional before lodging your tax return.",
      totals: {
        totalRecordedIncome: income,
        totalRecordedExpenses: expenses,
        netRentalIncome: propIncome - propExpenses,
        investmentIncome: invIncome,
        dividendIncome: dividends,
        frankingCredits: franking,
        capitalGainsRecorded: gains,
      },
      potentiallyRelevantExpenses: potentialExpenses.map(
        (t: {
          date: Date;
          description: string;
          amount: number;
          category: { name: string } | null;
          property: { name: string } | null;
          potentialTaxCategory: string | null;
          documents: unknown[];
        }) => ({
          date: t.date,
          description: t.description,
          amount: t.amount,
          category: t.category?.name ?? null,
          property: t.property?.name ?? null,
          potentialTaxCategory: t.potentialTaxCategory,
          hasReceipt: t.documents.length > 0,
        })
      ),
    });
  })
);

// --- Bill Report --------------------------------------------------------------
router.get(
  "/bills",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const bills = await prisma.bill.findMany({ where: { householdId }, include: { property: true } });
    type BillRow = { status: string; frequency: string };
    res.json({
      paid: bills.filter((b: BillRow) => b.status === "PAID"),
      unpaid: bills.filter((b: BillRow) => b.status !== "PAID"),
      upcoming: bills.filter((b: BillRow) => b.status === "UPCOMING"),
      overdue: bills.filter((b: BillRow) => b.status === "OVERDUE"),
      recurring: bills.filter((b: BillRow) => b.frequency !== "CUSTOM"),
    });
  })
);

// --- CSV export for any of the above reports ---------------------------------
router.get(
  "/export/:reportType.csv",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const fy = resolveFy(req);
    const { reportType } = req.params;

    let rows: Record<string, unknown>[] = [];
    if (reportType === "tax-summary") {
      const transactions = await prisma.transaction.findMany({
        where: { householdId, financialYear: fy.id },
        include: { category: true, property: true, investment: true, documents: true },
        orderBy: { date: "asc" },
      });
      rows = transactions.map(
        (t: {
          date: Date;
          category: { name: string } | null;
          description: string;
          direction: string;
          amount: number;
          financialYear: string;
          property: { name: string } | null;
          investment: { name: string } | null;
          notes: string | null;
          documents: unknown[];
        }) => ({
          Date: t.date.toISOString().slice(0, 10),
          Category: t.category?.name ?? "",
          Description: t.description,
          Amount: t.direction === "INCOME" ? t.amount : -t.amount,
          FinancialYear: t.financialYear,
          Property: t.property?.name ?? "",
          Investment: t.investment?.name ?? "",
          Notes: t.notes ?? "",
          DocumentAvailable: t.documents.length > 0 ? "Yes" : "No",
        })
      );
    } else if (reportType === "transactions") {
      const transactions = await prisma.transaction.findMany({
        where: { householdId, financialYear: fy.id },
        include: { category: true, property: true },
        orderBy: { date: "asc" },
      });
      rows = transactions.map((t: (typeof transactions)[number]) => ({
        Date: t.date.toISOString().slice(0, 10),
        Description: t.description,
        Direction: t.direction,
        Amount: t.amount,
        Category: t.category?.name ?? "",
        Property: t.property?.name ?? "",
      }));
    } else {
      throw new FriendlyError("Unknown report type.", 400);
    }

    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${reportType}-${fy.id}.csv"`);
    res.send(csv);
  })
);

export default router;
