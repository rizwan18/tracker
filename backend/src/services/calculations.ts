import { prisma } from "../lib/prisma";
import { getFinancialYearId } from "../lib/financialYear";
import { groupPropertyTotals, type PropertyGroupTotals } from "../lib/propertyTypes";
import { currentValueOf } from "./holdings";

/**
 * All calculations are scoped to a householdId and a financial year id
 * ("YYYY-YY"). These are the ONLY place totals get computed — the
 * dashboard, reports, and tax summary all call through here so numbers
 * never drift apart between screens.
 */

async function sumTransactions(householdId: string, financialYear: string, direction: "INCOME" | "EXPENSE", extraWhere: Record<string, unknown> = {}) {
  const result = await prisma.transaction.aggregate({
    where: { householdId, financialYear, direction, ...extraWhere },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function totalIncome(householdId: string, financialYear: string): Promise<number> {
  return sumTransactions(householdId, financialYear, "INCOME");
}

export async function totalExpenses(householdId: string, financialYear: string): Promise<number> {
  return sumTransactions(householdId, financialYear, "EXPENSE");
}

export async function netIncome(householdId: string, financialYear: string): Promise<number> {
  const [income, expenses] = await Promise.all([
    totalIncome(householdId, financialYear),
    totalExpenses(householdId, financialYear),
  ]);
  return income - expenses;
}

export async function propertyIncome(householdId: string, financialYear: string): Promise<number> {
  // Rental figures only cover investment properties — costs of your own home (PPR) aren't rental expenses.
  return sumTransactions(householdId, financialYear, "INCOME", { property: { propertyType: "INVESTMENT" } });
}

export async function propertyExpenses(householdId: string, financialYear: string): Promise<number> {
  return sumTransactions(householdId, financialYear, "EXPENSE", { property: { propertyType: "INVESTMENT" } });
}

export async function netRentalIncome(householdId: string, financialYear: string): Promise<number> {
  const [income, expenses] = await Promise.all([
    propertyIncome(householdId, financialYear),
    propertyExpenses(householdId, financialYear),
  ]);
  return income - expenses;
}

export async function dividendIncome(householdId: string, financialYear: string): Promise<number> {
  const investments = await prisma.investment.findMany({ where: { householdId }, select: { id: true } });
  const ids = investments.map((i: { id: string }) => i.id);
  if (ids.length === 0) return 0;
  const result = await prisma.dividend.aggregate({
    where: { investmentId: { in: ids }, financialYear, status: "RECEIVED" },
    _sum: { netAmount: true },
  });
  return result._sum.netAmount ?? 0;
}

export async function frankingCredits(householdId: string, financialYear: string): Promise<number> {
  const investments = await prisma.investment.findMany({ where: { householdId }, select: { id: true } });
  const ids = investments.map((i: { id: string }) => i.id);
  if (ids.length === 0) return 0;
  const result = await prisma.dividend.aggregate({
    where: { investmentId: { in: ids }, financialYear },
    _sum: { frankingCredit: true },
  });
  return result._sum.frankingCredit ?? 0;
}

export async function investmentIncome(householdId: string, financialYear: string): Promise<number> {
  const [dividends, otherInvestmentTx] = await Promise.all([
    dividendIncome(householdId, financialYear),
    sumTransactions(householdId, financialYear, "INCOME", { investmentId: { not: null } }),
  ]);
  return dividends + otherInvestmentTx;
}

export async function realisedCapitalGains(householdId: string, financialYear: string): Promise<{ gains: number; losses: number; net: number }> {
  const investments = await prisma.investment.findMany({ where: { householdId }, select: { id: true } });
  const ids = investments.map((i: { id: string }) => i.id);
  if (ids.length === 0) return { gains: 0, losses: 0, net: 0 };

  // A disposal ("SELL") realises a gain/loss against the average cost base
  // of BUYs up to that point. This is a simple average-cost approach
  // (not FIFO/LIFO/specific-parcel), clearly informational only — see the
  // capital gains route for the disclaimer shown alongside this figure.
  const allTx = await prisma.investmentTransaction.findMany({
    where: { investmentId: { in: ids } },
    orderBy: { date: "asc" },
  });

  const byInvestment = new Map<string, typeof allTx>();
  for (const tx of allTx) {
    const arr = byInvestment.get(tx.investmentId) ?? [];
    arr.push(tx);
    byInvestment.set(tx.investmentId, arr);
  }

  let gains = 0;
  let losses = 0;

  for (const [, txs] of byInvestment) {
    let heldQty = 0;
    let heldCost = 0;
    for (const tx of txs) {
      if (tx.type === "BUY") {
        heldQty += tx.quantity;
        heldCost += tx.quantity * tx.pricePerUnit + tx.brokerage;
      } else if (tx.type === "SELL") {
        const avgCostPerUnit = heldQty > 0 ? heldCost / heldQty : 0;
        const costOfSold = avgCostPerUnit * tx.quantity;
        const proceeds = tx.quantity * tx.pricePerUnit - tx.brokerage;
        const gainLoss = proceeds - costOfSold;

        // Only count this disposal if it falls in the requested FY.
        const fyOfSale = getFinancialYearId(tx.date);
        if (fyOfSale === financialYear) {
          if (gainLoss >= 0) gains += gainLoss;
          else losses += -gainLoss;
        }

        heldQty -= tx.quantity;
        heldCost -= costOfSold;
      }
    }
  }

  return { gains, losses, net: gains - losses };
}

/**
 * Adds persisted manual disposals (see CapitalGainDisposal / the
 * capital-gains route) on top of realisedCapitalGains' automatic
 * buy/sell-derived figure, so every screen that shows capital gains
 * (dashboard, financial-year report, tax summary) reflects both sources
 * consistently.
 */
export async function totalRealisedCapitalGains(householdId: string, financialYear: string): Promise<{ gains: number; losses: number; net: number }> {
  const [automatic, manualRecords] = await Promise.all([
    realisedCapitalGains(householdId, financialYear),
    prisma.capitalGainDisposal.findMany({ where: { householdId, financialYear }, select: { grossGainLoss: true } }),
  ]);

  let gains = automatic.gains;
  let losses = automatic.losses;
  for (const d of manualRecords as { grossGainLoss: number }[]) {
    if (d.grossGainLoss >= 0) gains += d.grossGainLoss;
    else losses += -d.grossGainLoss;
  }

  return { gains, losses, net: gains - losses };
}

export async function portfolioValue(householdId: string): Promise<{ properties: number; shares: number; other: number; total: number }> {
  // Only investment properties belong in the investment portfolio (your own home is shown separately).
  const properties = await prisma.property.findMany({ where: { householdId, propertyType: "INVESTMENT" } });
  const propertiesValue = properties.reduce((sum: number, p: (typeof properties)[number]) => sum + (p.currentEstimatedValue ?? 0), 0);

  const investments = await prisma.investment.findMany({
    where: { householdId },
    include: { investmentTransactions: true, valuations: { orderBy: { asAt: "desc" }, take: 1 } },
  });

  let sharesValue = 0;
  let otherValue = 0;
  for (const inv of investments) {
    let qty = 0;
    for (const tx of inv.investmentTransactions) {
      qty += tx.type === "BUY" ? tx.quantity : -tx.quantity;
    }
    const lastPrice = [...inv.investmentTransactions].sort((a, b) => b.date.getTime() - a.date.getTime())[0]?.pricePerUnit ?? 0;
    // The newest statement valuation (in A$) wins, then a manual override, then units × last price.
    const estimatedValue = currentValueOf({ valuation: inv.valuations[0] ?? null, override: inv.currentValueOverride, quantity: qty, lastPrice });
    if (inv.type === "SHARE" || inv.type === "ETF" || inv.type === "LIC") {
      sharesValue += estimatedValue;
    } else {
      otherValue += estimatedValue;
    }
  }

  return {
    properties: propertiesValue,
    shares: sharesValue,
    other: otherValue,
    total: propertiesValue + sharesValue + otherValue,
  };
}

export async function totalLoanBalance(householdId: string): Promise<number> {
  const properties = await prisma.property.findMany({ where: { householdId }, select: { loanBalance: true } });
  return properties.reduce((sum: number, p: (typeof properties)[number]) => sum + (p.loanBalance ?? 0), 0);
}

export async function upcomingBills(householdId: string, withinDays = 30, limit = 10) {
  const now = new Date();
  const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  return prisma.bill.findMany({
    where: {
      householdId,
      status: { in: ["UPCOMING", "OVERDUE"] },
      nextDueDate: { lte: horizon },
    },
    orderBy: { nextDueDate: "asc" },
    take: limit,
    include: { property: true, category: true },
  });
}

export async function overdueBills(householdId: string) {
  const now = new Date();
  return prisma.bill.findMany({
    where: { householdId, status: { not: "PAID" }, nextDueDate: { lt: now } },
    orderBy: { nextDueDate: "asc" },
  });
}

export async function propertyCount(householdId: string): Promise<number> {
  return prisma.property.count({ where: { householdId } });
}

/** Value, loan and equity split by property type. */
export async function propertyBreakdown(householdId: string): Promise<{ investment: PropertyGroupTotals; ppr: PropertyGroupTotals }> {
  const properties = await prisma.property.findMany({
    where: { householdId },
    select: { propertyType: true, currentEstimatedValue: true, loanBalance: true },
  });
  return groupPropertyTotals(properties);
}
