import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { brokerAccountSchema, CREDENTIAL_FIELD_PATTERN } from "../lib/validation";
import { sameAccountKey } from "../services/brokerAccounts";

/**
 * Broker accounts used to tag share/ETF trades. Identification only: broker name, account nickname, login e-mail.
 * Passwords, tokens and other credentials are never accepted, stored or returned.
 */
const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

function parse(body: unknown) {
  if (body && typeof body === "object" && Object.keys(body).some((k) => CREDENTIAL_FIELD_PATTERN.test(k))) {
    throw new FriendlyError("Passwords and other login credentials are never stored here. Only the broker, account name and login e-mail are needed.", 400);
  }
  const result = brokerAccountSchema.safeParse(body);
  if (!result.success) throw new FriendlyError(result.error.issues[0]?.message ?? "Please check the details and try again.", 400);
  return result.data;
}

const dto = (a: { id: string; brokerName: string; accountName: string; loginEmail: string; _count?: { investmentTransactions: number } }) => ({
  id: a.id,
  brokerName: a.brokerName,
  accountName: a.accountName,
  loginEmail: a.loginEmail,
  transactionCount: a._count?.investmentTransactions ?? 0,
});

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const accounts = await prisma.brokerAccount.findMany({
      where: { householdId: householdOf(req) },
      orderBy: [{ brokerName: "asc" }, { accountName: "asc" }],
      include: { _count: { select: { investmentTransactions: true } } },
    });
    res.json(accounts.map(dto));
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const data = parse(req.body);
    const existing = await prisma.brokerAccount.findMany({ where: { householdId }, select: { brokerName: true, accountName: true } });
    if (existing.some((e) => sameAccountKey(e, data))) throw new FriendlyError("You already have an account with that broker and account name. Use a different account name to tell them apart.", 409);
    const created = await prisma.brokerAccount.create({ data: { householdId, ...data } });
    res.status(201).json(dto(created));
  })
);

// Editing an account changes how it is displayed everywhere; trades keep pointing at it by id, so none are detached.
router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const account = await prisma.brokerAccount.findFirst({ where: { id: req.params.id, householdId } });
    if (!account) throw new FriendlyError("We couldn't find that broker account.", 404);
    const data = parse(req.body);
    const others = await prisma.brokerAccount.findMany({ where: { householdId, NOT: { id: account.id } }, select: { brokerName: true, accountName: true } });
    if (others.some((e) => sameAccountKey(e, data))) throw new FriendlyError("You already have another account with that broker and account name.", 409);
    const updated = await prisma.brokerAccount.update({ where: { id: account.id }, data, include: { _count: { select: { investmentTransactions: true } } } });
    res.json(dto(updated));
  })
);

// An account that trades refer to can't be removed (that would orphan their history); an unused one can.
router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const account = await prisma.brokerAccount.findFirst({ where: { id: req.params.id, householdId }, include: { _count: { select: { investmentTransactions: true } } } });
    if (!account) throw new FriendlyError("We couldn't find that broker account.", 404);
    if (account._count.investmentTransactions > 0) throw new FriendlyError("This account has trades recorded against it, so it can't be removed. You can edit its details instead.", 409);
    await prisma.brokerAccount.delete({ where: { id: account.id } });
    res.json({ message: "Broker account removed." });
  })
);

export default router;
