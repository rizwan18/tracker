import { Router } from "express";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword, signAuthToken, generatePasswordResetToken } from "../lib/auth";
import { registerSchema, loginSchema, requestPasswordResetSchema, resetPasswordSchema } from "../lib/validation";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { seedDefaultCategories } from "../lib/seedCategories";

const router = Router();

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existing) {
      throw new FriendlyError("An account with this email already exists. Try signing in instead.");
    }

    const household = await prisma.household.create({
      // Starts as a personal portfolio; the setup page (right after registering) lets the
      // person choose the type(s) they actually want.
      data: { name: data.householdName || `${data.fullName}'s household`, portfolioType: "PERSONAL", setupComplete: false },
    });

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        fullName: data.fullName,
        householdId: household.id,
        householdRole: "PRIMARY",
      },
    });

    await prisma.portfolioMember.create({ data: { userId: user.id, householdId: household.id, role: "PRIMARY" } });

    // Seed the default Australian income/expense categories for this new household.
    await seedDefaultCategories(prisma, household.id);

    const token = signAuthToken({ userId: user.id, householdId: household.id });
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, easyViewEnabled: user.easyViewEnabled },
    });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!user) {
      throw new FriendlyError("We couldn't find an account with those details.", 401);
    }
    const valid = await verifyPassword(data.password, user.passwordHash);
    if (!valid) {
      throw new FriendlyError("We couldn't find an account with those details.", 401);
    }
    const token = signAuthToken({ userId: user.id, householdId: user.householdId });
    res.json({
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, easyViewEnabled: user.easyViewEnabled },
    });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      easyViewEnabled: user.easyViewEnabled,
      timezone: user.timezone,
      householdId: user.householdId,
    });
  })
);

router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { easyViewEnabled, timezone, fullName } = req.body as { easyViewEnabled?: boolean; timezone?: string; fullName?: string };
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: {
        ...(easyViewEnabled !== undefined ? { easyViewEnabled } : {}),
        ...(timezone ? { timezone } : {}),
        ...(fullName ? { fullName } : {}),
      },
    });
    res.json({ id: user.id, easyViewEnabled: user.easyViewEnabled, timezone: user.timezone, fullName: user.fullName });
  })
);

// --- Password reset architecture -------------------------------------------
// This wires up the full token lifecycle (generate, hash, store, verify,
// expire, single-use). Actually emailing the raw token requires an email
// provider (e.g. Postmark/SES) to be configured — see README "Password
// reset" for where to plug that in. In dev, the raw token is returned in
// the response so the flow can be tested end-to-end without email.

router.post(
  "/request-password-reset",
  asyncHandler(async (req, res) => {
    const { email } = requestPasswordResetSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always respond the same way whether or not the account exists, so we
    // don't leak which emails are registered.
    if (!user) {
      return res.json({ message: "If an account exists for that email, a reset link has been sent." });
    }
    const { raw, hash } = generatePasswordResetToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const devOnlyToken = process.env.NODE_ENV !== "production" ? raw : undefined;
    res.json({ message: "If an account exists for that email, a reset link has been sent.", devOnlyToken });
  })
);

router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    const candidates = await prisma.passwordResetToken.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
    });
    const bcrypt = await import("bcryptjs");
    const match = candidates.find((c: { tokenHash: string }) => bcrypt.compareSync(token, c.tokenHash));
    if (!match) {
      throw new FriendlyError("This reset link is invalid or has expired. Please request a new one.", 400);
    }
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: match.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: match.id }, data: { usedAt: new Date() } }),
    ]);
    res.json({ message: "Your password has been updated. You can now sign in." });
  })
);

export default router;
