import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { getCurrentFinancialYear, getFinancialYearByStartYear, parseFinancialYearId, listRecentFinancialYears, daysRemainingInFinancialYear } from "../lib/financialYear";
import * as calc from "../services/calculations";
import { prisma } from "../lib/prisma";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
    const householdId = req.householdId;

    const fyParam = req.query.financialYear as string | undefined;
    const fy = fyParam ? getFinancialYearByStartYear(parseFinancialYearId(fyParam)) : getCurrentFinancialYear();

    const [
      income,
      expenses,
      propIncome,
      propExpenses,
      dividends,
      invIncome,
      capitalGains,
      portfolio,
      propertyTotals,
      upcoming,
      overdue,
      propCount,
      dueSoonReminders,
    ] = await Promise.all([
      calc.totalIncome(householdId, fy.id),
      calc.totalExpenses(householdId, fy.id),
      calc.propertyIncome(householdId, fy.id),
      calc.propertyExpenses(householdId, fy.id),
      calc.dividendIncome(householdId, fy.id),
      calc.investmentIncome(householdId, fy.id),
      calc.totalRealisedCapitalGains(householdId, fy.id),
      calc.portfolioValue(householdId),
      calc.propertyBreakdown(householdId),
      calc.upcomingBills(householdId, 30, 10),
      calc.overdueBills(householdId),
      calc.propertyCount(householdId),
      prisma.reminder.findMany({
        where: { householdId, status: { in: ["PENDING", "SNOOZED"] }, dueDate: { lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) } },
        orderBy: { dueDate: "asc" },
        take: 8,
      }),
    ]);

    const propertyList = await prisma.property.findMany({
      where: { householdId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, address: true, propertyType: true, currentEstimatedValue: true, loanBalance: true },
    });
    // Each property's main picture, shown as its icon on the dashboard.
    const primaries = await prisma.propertyPhoto.findMany({ where: { propertyId: { in: propertyList.map((p) => p.id) }, isPrimary: true }, select: { id: true, propertyId: true } });
    const primaryByProperty = new Map(primaries.map((p) => [p.propertyId, p.id]));

    const recentTransactions = await prisma.transaction.findMany({
      where: { householdId },
      orderBy: { date: "desc" },
      take: 8,
      include: { category: true, property: true },
    });

    // Build a small set of helpful, non-overwhelming alerts (section 6).
    const alerts: Array<{ id: string; message: string; severity: "info" | "warning" }> = [];
    for (const bill of overdue.slice(0, 3) as Array<{ id: string; name: string }>) {
      alerts.push({ id: `overdue-${bill.id}`, message: `${bill.name} is overdue`, severity: "warning" });
    }
    for (const reminder of dueSoonReminders.slice(0, 3) as Array<{ id: string; title: string; dueDate: Date }>) {
      const days = Math.ceil((reminder.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      alerts.push({
        id: `reminder-${reminder.id}`,
        message: days <= 0 ? `${reminder.title} is due today` : `${reminder.title} in ${days} day${days === 1 ? "" : "s"}`,
        severity: days <= 3 ? "warning" : "info",
      });
    }

    res.json({
      financialYear: { id: fy.id, label: fy.label, startDate: fy.startDate, endDate: fy.endDate, daysRemaining: daysRemainingInFinancialYear(fy) },
      availableFinancialYears: listRecentFinancialYears(6).map((y) => ({ id: y.id, label: y.label })),
      snapshot: {
        totalIncome: income,
        totalExpenses: expenses,
        netIncome: income - expenses,
        investmentIncome: invIncome,
        propertyIncome: propIncome,
        dividends,
        otherIncome: Math.max(0, income - propIncome - invIncome),
        upcomingBillsCount: upcoming.length,
        outstandingBillsCount: overdue.length,
      },
      investmentSnapshot: {
        propertyValue: portfolio.properties,
        shareValue: portfolio.shares,
        otherValue: portfolio.other,
        totalInvestmentValue: portfolio.total,
        totalInvestmentIncome: invIncome,
        capitalGains,
      },
      propertySnapshot: {
        numberOfProperties: propCount,
        totalRentalIncome: propIncome,
        totalPropertyExpenses: propExpenses,
        netRentalIncome: propIncome - propExpenses,
        // Investment properties only (your own home is reported separately below).
        loanBalance: propertyTotals.investment.loanBalance,
        estimatedEquity: propertyTotals.investment.equity,
        investmentCount: propertyTotals.investment.count,
        pprCount: propertyTotals.ppr.count,
        ppr: propertyTotals.ppr,
      },
      properties: propertyList.map((p) => ({ ...p, primaryPhotoId: primaryByProperty.get(p.id) ?? null })),
      upcomingPayments: upcoming.map((b: { id: string; name: string; amount: number; nextDueDate: Date; property: { name: string } | null }) => ({
        id: b.id,
        name: b.name,
        amount: b.amount,
        dueDate: b.nextDueDate,
        property: b.property?.name ?? null,
      })),
      alerts,
      recentActivity: recentTransactions.map((t: { id: string; description: string; direction: string; amount: number; date: Date; category: { name: string } | null }) => ({
        id: t.id,
        description: t.description,
        amount: t.direction === "INCOME" ? t.amount : -t.amount,
        date: t.date,
        category: t.category?.name ?? null,
      })),
    });
  })
);

export default router;
