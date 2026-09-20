import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { propertySchema, scheduleLineSchema, scheduleDetailsSchema, financialYearIdSchema } from "../lib/validation";
import { getCurrentFinancialYear } from "../lib/financialYear";
import { DEFAULT_RENTAL_SCHEDULE_LINES } from "../lib/constants";
import { findConflictingPpr, pprConflictMessage } from "../lib/propertyTypes";
import { canHavePpr } from "../lib/portfolios";
import { buildRentalSchedule, type ScheduleDirection, type ScheduleLineDef, type ScheduleTotalsRow } from "../services/rentalSchedule";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

/**
 * Business rule: a person can only have one principal place of residence (PPR).
 * Throws a friendly 409 if the signed-in person already owns a different PPR.
 */
async function assertNoOtherPpr(req: AuthedRequest, propertyId?: string) {
  // Across ALL of the person's portfolios — one PPR per person, wherever it's recorded.
  const owned = await prisma.property.findMany({
    where: { owners: { some: { userId: req.userId! } } },
    select: { id: true, name: true, propertyType: true },
  });
  const conflict = findConflictingPpr(owned, propertyId);
  if (conflict) throw new FriendlyError(pprConflictMessage(conflict.name), 409);
}

/** A principal place of residence can only be recorded in a Personal Finance portfolio. */
async function assertPortfolioAllowsPpr(householdId: string) {
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { portfolioType: true } });
  if (!household || !canHavePpr(household.portfolioType)) {
    throw new FriendlyError("A principal place of residence can only be recorded in a Personal Finance portfolio. Choose “Investment property” instead.", 400);
  }
}

function annualisedRent(rentAmount: number | null, rentFrequency: string | null): number {
  if (!rentAmount || !rentFrequency) return 0;
  switch (rentFrequency) {
    case "WEEKLY":
      return rentAmount * 52;
    case "FORTNIGHTLY":
      return rentAmount * 26;
    case "MONTHLY":
      return rentAmount * 12;
    default:
      return 0;
  }
}

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const properties = await prisma.property.findMany({ where: { householdId }, include: { owners: true }, orderBy: { createdAt: "asc" } });
    res.json(properties);
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const data = propertySchema.parse(req.body);
    if (data.propertyType === "PPR") {
      await assertPortfolioAllowsPpr(householdId);
      await assertNoOtherPpr(req);
    }
    const property = await prisma.property.create({
      data: {
        householdId,
        ...data,
        owners: { create: { userId: req.userId!, percentage: 100 } },
      },
      include: { owners: true },
    });
    res.status(201).json(property);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const property = await prisma.property.findFirst({ where: { id: req.params.id, householdId }, include: { owners: true } });
    if (!property) throw new FriendlyError("We couldn't find this property.", 404);
    res.json(property);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.property.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this property.", 404);
    const data = propertySchema.partial().parse(req.body);
    if (data.propertyType === "PPR" && existing.propertyType !== "PPR") {
      await assertPortfolioAllowsPpr(householdId);
      await assertNoOtherPpr(req, existing.id);
    }
    const property = await prisma.property.update({ where: { id: existing.id }, data });
    res.json(property);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.property.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this property.", 404);
    await prisma.property.delete({ where: { id: existing.id } });
    res.json({ message: "Property removed." });
  })
);

router.get(
  "/:id/summary",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const property = await prisma.property.findFirst({ where: { id: req.params.id, householdId } });
    if (!property) throw new FriendlyError("We couldn't find this property.", 404);

    const financialYear = (req.query.financialYear as string) || getCurrentFinancialYear().id;

    const [incomeAgg, expenseAgg, expenseByCategory] = await Promise.all([
      prisma.transaction.aggregate({ where: { propertyId: property.id, direction: "INCOME", financialYear }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { propertyId: property.id, direction: "EXPENSE", financialYear }, _sum: { amount: true } }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { propertyId: property.id, direction: "EXPENSE", financialYear },
        _sum: { amount: true },
      }),
    ]);

    const rentalIncome = incomeAgg._sum.amount ?? 0;
    const expenses = expenseAgg._sum.amount ?? 0;
    const netRentalIncome = rentalIncome - expenses;
    const annualRent = annualisedRent(property.rentAmount, property.rentFrequency);
    const rentalYield =
      property.currentEstimatedValue && property.currentEstimatedValue > 0 ? (annualRent / property.currentEstimatedValue) * 100 : null;
    const estimatedEquity =
      property.currentEstimatedValue !== null && property.loanBalance !== null
        ? property.currentEstimatedValue - property.loanBalance
        : null;

    const categoryIds = expenseByCategory.map((c: { categoryId: string | null }) => c.categoryId).filter((id: string | null): id is string => !!id);
    const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } });
    const categoryMap = new Map(categories.map((c: { id: string; name: string }) => [c.id, c.name]));

    res.json({
      property,
      financialYear,
      rentalIncome,
      expenses,
      netRentalIncome,
      annualisedRentalIncome: annualRent,
      rentalYield,
      estimatedEquity,
      majorExpenses: expenseByCategory
        .map((c: { categoryId: string | null; _sum: { amount: number | null } }) => ({
          category: c.categoryId ? categoryMap.get(c.categoryId) ?? "Uncategorised" : "Uncategorised",
          amount: c._sum.amount ?? 0,
        }))
        .sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount),
    });
  })
);

// ---------------------------------------------------------------------------
// Rental income & expenses schedule (per property, per financial year)
// ---------------------------------------------------------------------------

async function findOwnedProperty(req: AuthedRequest) {
  const householdId = householdOf(req);
  const property = await prisma.property.findFirst({ where: { id: req.params.id, householdId }, include: { owners: true } });
  if (!property) throw new FriendlyError("We couldn't find this property.", 404);
  return { householdId, property };
}

/** Find the household's category by name/direction, creating it if it doesn't exist yet. */
async function findOrCreateCategory(householdId: string, name: string, direction: ScheduleDirection): Promise<{ id: string }> {
  const existing = await prisma.category.findFirst({ where: { householdId, name, direction } });
  if (existing) return existing;
  return prisma.category.create({ data: { householdId, name, direction, isCustom: true } });
}

/** First time a property's schedule is opened, give it the standard set of lines. */
async function ensureDefaultScheduleLines(householdId: string, propertyId: string) {
  const data: Array<{ propertyId: string; categoryId: string; label: string; isManual: boolean; sortOrder: number }> = [];
  for (const [index, def] of DEFAULT_RENTAL_SCHEDULE_LINES.entries()) {
    const category = await findOrCreateCategory(householdId, def.categoryName, def.direction);
    data.push({ propertyId, categoryId: category.id, label: def.label, isManual: def.isManual ?? false, sortOrder: index });
  }
  await prisma.propertyScheduleLine.createMany({ data, skipDuplicates: true });
  await prisma.property.update({ where: { id: propertyId }, data: { scheduleInitialised: true } });
}

router.get(
  "/:id/schedule",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, property } = await findOwnedProperty(req);
    const financialYear = financialYearIdSchema.catch(getCurrentFinancialYear().id).parse(req.query.financialYear);

    if (!property.scheduleInitialised) await ensureDefaultScheduleLines(householdId, property.id);

    const [lineRecords, groups, yearDetail, allCategories] = await Promise.all([
      prisma.propertyScheduleLine.findMany({ where: { propertyId: property.id }, include: { category: true } }),
      prisma.transaction.groupBy({
        by: ["categoryId", "direction"],
        where: { propertyId: property.id, financialYear },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.propertyYearDetail.findUnique({ where: { propertyId_financialYear: { propertyId: property.id, financialYear } } }),
      prisma.category.findMany({ where: { householdId }, orderBy: [{ direction: "asc" }, { name: "asc" }] }),
    ]);

    type LineRecord = { id: string; categoryId: string; label: string | null; isManual: boolean; sortOrder: number; category: { name: string; direction: string } };
    const lines: ScheduleLineDef[] = (lineRecords as LineRecord[]).map((l) => ({
      id: l.id,
      categoryId: l.categoryId,
      name: l.label?.trim() || l.category.name,
      direction: l.category.direction as ScheduleDirection,
      isManual: l.isManual,
      sortOrder: l.sortOrder,
    }));

    const rows: ScheduleTotalsRow[] = (
      groups as Array<{ categoryId: string | null; direction: string; _sum: { amount: number | null }; _count: { _all: number } }>
    ).map((g) => ({
      categoryId: g.categoryId,
      direction: g.direction as ScheduleDirection,
      total: g._sum.amount ?? 0,
      count: g._count._all,
    }));

    const categoryNames = new Map<string, string>((allCategories as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
    const owner = property.owners.find((o: { userId: string }) => o.userId === req.userId) ?? property.owners[0];
    const ownershipPercentage = owner?.percentage ?? 100;

    const schedule = buildRentalSchedule(lines, rows, categoryNames, ownershipPercentage);

    // Categories the user could still add as a line (not already on this property's list).
    const usedCategoryIds = new Set(lines.map((l) => l.categoryId));
    const availableCategories = (allCategories as Array<{ id: string; name: string; direction: string }>)
      .filter((c) => !usedCategoryIds.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, direction: c.direction }));

    res.json({
      property: { id: property.id, name: property.name },
      financialYear,
      details: {
        ownershipPercentage,
        availableForRentDate: property.availableForRentDate,
        weeksRented: yearDetail?.weeksRented ?? null,
      },
      ...schedule,
      availableCategories,
    });
  })
);

router.put(
  "/:id/schedule/details",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, property } = await findOwnedProperty(req);
    const data = scheduleDetailsSchema.parse(req.body);

    if (data.weeksRented !== undefined) {
      await prisma.propertyYearDetail.upsert({
        where: { propertyId_financialYear: { propertyId: property.id, financialYear: data.financialYear } },
        create: { propertyId: property.id, financialYear: data.financialYear, weeksRented: data.weeksRented },
        update: { weeksRented: data.weeksRented },
      });
    }
    if (data.ownershipPercentage !== undefined) {
      // Taking a share in someone else's PPR would give this person a second one.
      if (property.propertyType === "PPR" && !property.owners.some((o: { userId: string }) => o.userId === req.userId)) {
        await assertNoOtherPpr(req, property.id);
      }
      await prisma.propertyOwnership.upsert({
        where: { propertyId_userId: { propertyId: property.id, userId: req.userId! } },
        create: { propertyId: property.id, userId: req.userId!, percentage: data.ownershipPercentage },
        update: { percentage: data.ownershipPercentage },
      });
    }
    if (data.availableForRentDate !== undefined) {
      await prisma.property.update({ where: { id: property.id }, data: { availableForRentDate: data.availableForRentDate } });
    }
    res.json({ message: "Saved." });
  })
);

router.post(
  "/:id/schedule/lines",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, property } = await findOwnedProperty(req);
    const data = scheduleLineSchema.parse(req.body);

    let categoryId = data.categoryId;
    if (categoryId) {
      const category = await prisma.category.findFirst({ where: { id: categoryId, householdId } });
      if (!category) throw new FriendlyError("We couldn't find that category.", 404);
    } else {
      categoryId = (await findOrCreateCategory(householdId, data.name!, data.direction!)).id;
    }

    const existing = await prisma.propertyScheduleLine.findUnique({ where: { propertyId_categoryId: { propertyId: property.id, categoryId } } });
    if (existing) return res.json(existing);

    const last = await prisma.propertyScheduleLine.aggregate({ where: { propertyId: property.id }, _max: { sortOrder: true } });
    const line = await prisma.propertyScheduleLine.create({
      data: {
        propertyId: property.id,
        categoryId,
        label: data.label?.trim() || null,
        isManual: data.isManual ?? false,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(line);
  })
);

router.delete(
  "/:id/schedule/lines/:lineId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { property } = await findOwnedProperty(req);
    const line = await prisma.propertyScheduleLine.findFirst({ where: { id: req.params.lineId, propertyId: property.id } });
    if (!line) throw new FriendlyError("We couldn't find that line.", 404);
    // Only the line is removed from this property's list — recorded transactions are untouched.
    await prisma.propertyScheduleLine.delete({ where: { id: line.id } });
    res.json({ message: "Line removed from the list." });
  })
);

export default router;
