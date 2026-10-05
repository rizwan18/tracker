import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { transactionSchema } from "../lib/validation";
import { getFinancialYearId } from "../lib/financialYear";
import { LIKELY_DEDUCTIBLE_EXPENSE_CATEGORIES, POTENTIAL_TAX_SUGGESTION } from "../lib/constants";
import { syncExpenseReminder } from "../lib/expenseReminders";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const { financialYear, direction, propertyId, investmentId, categoryId, search, page = "1", pageSize = "50" } = req.query as Record<string, string>;

    const where: Record<string, unknown> = { householdId };
    if (financialYear) where.financialYear = financialYear;
    if (direction) where.direction = direction;
    if (propertyId) where.propertyId = propertyId;
    if (investmentId) where.investmentId = investmentId;
    if (categoryId) where.categoryId = categoryId;
    if (search) where.description = { contains: search };

    const take = Math.min(Number(pageSize) || 50, 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { date: "desc" },
        skip,
        take,
        include: { category: true, account: true, property: true, investment: true, documents: true },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({ items, total, page: Number(page), pageSize: take });
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const data = transactionSchema.parse(req.body);
    const financialYear = getFinancialYearId(data.date);

    let suggestedTaxCategory = data.potentialTaxCategory ?? null;
    if (!suggestedTaxCategory && data.direction === "EXPENSE" && data.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
      if (category && LIKELY_DEDUCTIBLE_EXPENSE_CATEGORIES.has(category.name)) {
        suggestedTaxCategory = POTENTIAL_TAX_SUGGESTION;
      }
    }

    const transaction = await prisma.transaction.create({
      data: {
        householdId,
        userId: req.userId!,
        date: data.date,
        description: data.description,
        amount: data.amount,
        direction: data.direction,
        categoryId: data.categoryId ?? null,
        accountId: data.accountId ?? null,
        propertyId: data.propertyId ?? null,
        investmentId: data.investmentId ?? null,
        notes: data.notes ?? null,
        isRecurring: data.isRecurring ?? false,
        recurrenceFrequency: data.recurrenceFrequency ?? null,
        potentialTaxCategory: suggestedTaxCategory,
        financialYear,
      },
    });
    // Expenses dated in the future also show up under Reminders.
    await syncExpenseReminder(transaction);
    res.status(201).json(transaction);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.transaction.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this transaction.", 404);

    const data = transactionSchema.partial().parse(req.body);
    const financialYear = data.date ? getFinancialYearId(data.date) : undefined;

    const updated = await prisma.transaction.update({
      where: { id: existing.id },
      data: { ...data, ...(financialYear ? { financialYear } : {}) },
    });
    await syncExpenseReminder(updated);
    res.json(updated);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.transaction.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this transaction.", 404);
    await prisma.transaction.delete({ where: { id: existing.id } });
    res.json({ message: "Transaction deleted." });
  })
);

router.post(
  "/:id/duplicate",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.transaction.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this transaction.", 404);
    const today = new Date();
    const duplicate = await prisma.transaction.create({
      data: {
        householdId,
        userId: req.userId!,
        date: today,
        description: existing.description,
        amount: existing.amount,
        direction: existing.direction,
        categoryId: existing.categoryId,
        accountId: existing.accountId,
        propertyId: existing.propertyId,
        investmentId: existing.investmentId,
        notes: existing.notes,
        isRecurring: existing.isRecurring,
        recurrenceFrequency: existing.recurrenceFrequency,
        potentialTaxCategory: existing.potentialTaxCategory,
        financialYear: getFinancialYearId(today),
      },
    });
    res.status(201).json(duplicate);
  })
);

export default router;
