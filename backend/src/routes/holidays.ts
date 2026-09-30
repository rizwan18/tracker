import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { holidayPlanSchema, holidayExpenseSchema, holidayMilestoneSchema } from "../lib/validation";
import { breakdownByCategory, buildTimeline, computeHolidayTotals, savingsPlan } from "../services/personal/holidays";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your portfolio first.", 400);
  return req.householdId;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const detailInclude = {
  expenses: { orderBy: [{ dueDate: "asc" as const }, { createdAt: "asc" as const }] },
  milestones: { orderBy: { date: "asc" as const } },
} satisfies Prisma.HolidayPlanInclude;

type PlanWithChildren = Prisma.HolidayPlanGetPayload<{ include: typeof detailInclude }>;

function summaryDto(p: PlanWithChildren) {
  return {
    id: p.id, name: p.name, destination: p.destination, status: p.status, startDate: iso(p.startDate), endDate: iso(p.endDate),
    travellers: p.travellers, budget: p.budget,
    totals: computeHolidayTotals(p.expenses, p.budget, p.travellers),
    openMilestones: p.milestones.filter((m) => !m.done).length,
    updatedAt: p.updatedAt.toISOString(),
  };
}

function detailDto(p: PlanWithChildren) {
  const totals = computeHolidayTotals(p.expenses, p.budget, p.travellers);
  return {
    ...summaryDto(p),
    notes: p.notes,
    totals,
    savings: savingsPlan(totals.outstanding, p.startDate),
    byCategory: breakdownByCategory(p.expenses),
    timeline: buildTimeline(p, p.expenses, p.milestones),
    expenses: p.expenses.map((e) => ({
      id: e.id, category: e.category, description: e.description, estimatedAmount: e.estimatedAmount, actualAmount: e.actualAmount,
      dueDate: iso(e.dueDate), paidDate: iso(e.paidDate), notes: e.notes,
    })),
    milestones: p.milestones.map((m) => ({ id: m.id, title: m.title, type: m.type, date: iso(m.date), done: m.done, notes: m.notes })),
  };
}

async function findPlan(req: AuthedRequest): Promise<PlanWithChildren> {
  const plan = await prisma.holidayPlan.findFirst({ where: { id: req.params.id, householdId: householdOf(req) }, include: detailInclude });
  if (!plan) throw new FriendlyError("We couldn't find that holiday.", 404);
  return plan;
}

// --------------------------------------------------------------------------- plans
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const plans = await prisma.holidayPlan.findMany({
      where: { householdId: householdOf(req) },
      include: detailInclude,
      orderBy: [{ startDate: "asc" }, { createdAt: "desc" }],
    });
    res.json(plans.map(summaryDto));
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = holidayPlanSchema.parse(req.body);
    const created = await prisma.holidayPlan.create({ data: { householdId: householdOf(req), ...data }, include: detailInclude });
    res.status(201).json(detailDto(created));
  })
);

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(detailDto(await findPlan(req)));
  })
);

router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findPlan(req);
    const data = holidayPlanSchema.parse(req.body);
    const updated = await prisma.holidayPlan.update({ where: { id: existing.id }, data, include: detailInclude });
    res.json(detailDto(updated));
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await findPlan(req);
    await prisma.holidayPlan.delete({ where: { id: existing.id } });
    res.json({ message: "Holiday deleted." });
  })
);

// --------------------------------------------------------------------------- expenses
router.post(
  "/:id/expenses",
  asyncHandler(async (req: AuthedRequest, res) => {
    const plan = await findPlan(req);
    const data = holidayExpenseSchema.parse(req.body);
    await prisma.holidayExpense.create({ data: { holidayPlanId: plan.id, ...data } });
    res.status(201).json(detailDto(await findPlan(req)));
  })
);

router.put(
  "/:id/expenses/:expenseId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const plan = await findPlan(req);
    const expense = plan.expenses.find((e) => e.id === req.params.expenseId);
    if (!expense) throw new FriendlyError("We couldn't find that expense.", 404);
    const data = holidayExpenseSchema.parse(req.body);
    await prisma.holidayExpense.update({ where: { id: expense.id }, data });
    res.json(detailDto(await findPlan(req)));
  })
);

router.delete(
  "/:id/expenses/:expenseId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const plan = await findPlan(req);
    const expense = plan.expenses.find((e) => e.id === req.params.expenseId);
    if (!expense) throw new FriendlyError("We couldn't find that expense.", 404);
    await prisma.holidayExpense.delete({ where: { id: expense.id } });
    res.json(detailDto(await findPlan(req)));
  })
);

// --------------------------------------------------------------------------- milestones
router.post(
  "/:id/milestones",
  asyncHandler(async (req: AuthedRequest, res) => {
    const plan = await findPlan(req);
    const data = holidayMilestoneSchema.parse(req.body);
    await prisma.holidayMilestone.create({ data: { holidayPlanId: plan.id, ...data } });
    res.status(201).json(detailDto(await findPlan(req)));
  })
);

router.put(
  "/:id/milestones/:milestoneId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const plan = await findPlan(req);
    const milestone = plan.milestones.find((m) => m.id === req.params.milestoneId);
    if (!milestone) throw new FriendlyError("We couldn't find that item.", 404);
    const data = holidayMilestoneSchema.parse(req.body);
    await prisma.holidayMilestone.update({ where: { id: milestone.id }, data });
    res.json(detailDto(await findPlan(req)));
  })
);

router.delete(
  "/:id/milestones/:milestoneId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const plan = await findPlan(req);
    const milestone = plan.milestones.find((m) => m.id === req.params.milestoneId);
    if (!milestone) throw new FriendlyError("We couldn't find that item.", 404);
    await prisma.holidayMilestone.delete({ where: { id: milestone.id } });
    res.json(detailDto(await findPlan(req)));
  })
);

export default router;
