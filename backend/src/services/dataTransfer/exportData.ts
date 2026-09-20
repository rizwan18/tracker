import { prisma } from "../../lib/prisma";
import { renderExportCsv, type ExportData } from "./renderExport";

export { renderExportCsv, type ExportData } from "./renderExport";

/** Loads everything that belongs to a household (and the signed-in person's profile). */
export async function loadExportData(householdId: string, userId: string): Promise<ExportData> {
  const [user, household, accounts, categories, properties, owners, scheduleLines, yearDetails, photos, investments, investmentTransactions, dividends, disposals, transactions, bills, reminders, documents] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.household.findUniqueOrThrow({ where: { id: householdId } }),
      prisma.account.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } }),
      prisma.category.findMany({ where: { householdId }, orderBy: [{ direction: "asc" }, { name: "asc" }] }),
      prisma.property.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } }),
      prisma.propertyOwnership.findMany({ where: { property: { householdId } }, include: { user: { select: { email: true } } } }),
      prisma.propertyScheduleLine.findMany({ where: { property: { householdId } }, orderBy: [{ propertyId: "asc" }, { sortOrder: "asc" }] }),
      prisma.propertyYearDetail.findMany({ where: { property: { householdId } }, orderBy: [{ propertyId: "asc" }, { financialYear: "asc" }] }),
      prisma.propertyPhoto.findMany({ where: { property: { householdId } }, orderBy: [{ propertyId: "asc" }, { createdAt: "asc" }] }),
      prisma.investment.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } }),
      prisma.investmentTransaction.findMany({ where: { investment: { householdId } }, orderBy: { date: "asc" } }),
      prisma.dividend.findMany({ where: { investment: { householdId } }, orderBy: { createdAt: "asc" } }),
      prisma.capitalGainDisposal.findMany({ where: { householdId }, orderBy: { saleDate: "asc" } }),
      prisma.transaction.findMany({ where: { householdId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
      prisma.bill.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } }),
      prisma.reminder.findMany({ where: { householdId }, orderBy: { dueDate: "asc" } }),
      prisma.document.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } }),
    ]);

  return {
    profile: { fullName: user.fullName, email: user.email, timezone: user.timezone, easyViewEnabled: user.easyViewEnabled, householdName: household.name },
    accounts,
    categories,
    properties,
    owners: owners.map((o) => ({ propertyId: o.propertyId, email: o.user.email, percentage: o.percentage })),
    scheduleLines,
    yearDetails,
    photos,
    investments,
    investmentTransactions,
    dividends,
    disposals,
    transactions,
    bills,
    reminders,
    documents,
  };
}

export async function buildExportCsv(householdId: string, userId: string, now: Date = new Date()): Promise<string> {
  return renderExportCsv(await loadExportData(householdId, userId), now);
}
