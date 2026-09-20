import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { portfolioSchema, portfolioSetupSchema, portfolioRenameSchema } from "../lib/validation";
import { seedDefaultCategories } from "../lib/seedCategories";
import { MAX_PORTFOLIOS_PER_PERSON } from "../lib/portfolios";

const router = Router();
router.use(requireAuth);

interface PortfolioDto {
  id: string;
  name: string;
  type: string;
  role: string;
  isDefault: boolean;
}

/** Everything the signed-in person can open, their default portfolio first. */
async function listPortfolios(userId: string): Promise<PortfolioDto[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  // Accounts created before portfolios existed have no membership row yet.
  if (user.householdId) {
    await prisma.portfolioMember.upsert({
      where: { userId_householdId: { userId, householdId: user.householdId } },
      create: { userId, householdId: user.householdId, role: user.householdRole },
      update: {},
    });
  }
  const rows = await prisma.portfolioMember.findMany({ where: { userId }, include: { household: true }, orderBy: { createdAt: "asc" } });
  return rows
    .map((m) => ({ id: m.householdId, name: m.household.name, type: m.household.portfolioType, role: m.role, isDefault: m.householdId === user.householdId }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ portfolios: await listPortfolios(req.userId!) });
  })
);

async function createPortfolio(userId: string, type: string, name: string) {
  return prisma.$transaction(async (tx) => {
    const household = await tx.household.create({ data: { name, portfolioType: type, setupComplete: true } });
    await tx.portfolioMember.create({ data: { userId, householdId: household.id, role: "PRIMARY" } });
    await seedDefaultCategories(tx, household.id);
    return household;
  });
}

// Add another portfolio at any time (e.g. a company or trust alongside personal finances).
router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = portfolioSchema.parse(req.body);
    const existing = await listPortfolios(req.userId!);
    if (existing.length >= MAX_PORTFOLIOS_PER_PERSON) {
      throw new FriendlyError(`You can have up to ${MAX_PORTFOLIOS_PER_PERSON} portfolios.`, 400);
    }
    const household = await createPortfolio(req.userId!, data.type, data.name);
    res.status(201).json({ id: household.id, name: household.name, type: household.portfolioType, role: "PRIMARY", isDefault: false });
  })
);

// The setup page, right after registering: choose the type(s) of portfolio to start with.
// The account already has one empty portfolio, which becomes the first choice; any others are created.
router.post(
  "/setup",
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = portfolioSetupSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
    const current = user.householdId ? await prisma.household.findUnique({ where: { id: user.householdId } }) : null;
    if (!current || current.setupComplete) {
      throw new FriendlyError("Your portfolios are already set up. You can add another from Settings.", 409);
    }
    const [first, ...rest] = data.portfolios;
    await prisma.$transaction(async (tx) => {
      await tx.household.update({ where: { id: current.id }, data: { portfolioType: first!.type, name: first!.name, setupComplete: true } });
      for (const p of rest) {
        const household = await tx.household.create({ data: { name: p.name, portfolioType: p.type, setupComplete: true } });
        await tx.portfolioMember.create({ data: { userId: user.id, householdId: household.id, role: "PRIMARY" } });
        await seedDefaultCategories(tx, household.id);
      }
    });
    res.status(201).json({ portfolios: await listPortfolios(user.id) });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name } = portfolioRenameSchema.parse(req.body);
    const member = await prisma.portfolioMember.findUnique({ where: { userId_householdId: { userId: req.userId!, householdId: req.params.id! } } });
    if (!member) throw new FriendlyError("We couldn't find that portfolio.", 404);
    const household = await prisma.household.update({ where: { id: member.householdId }, data: { name } });
    res.json({ id: household.id, name: household.name, type: household.portfolioType });
  })
);

export default router;
