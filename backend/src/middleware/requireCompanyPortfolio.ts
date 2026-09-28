import { NextFunction, Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthedRequest } from "./requireAuth";
import { FriendlyError } from "./errorHandler";

/** The active household id, or a friendly error if the person hasn't finished setting up a portfolio. */
export function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your portfolio first.", 400);
  return req.householdId;
}

/**
 * Company Finance features (business accounting, sourcing) only exist for
 * COMPANY portfolios. Mirrors the inline check in routes/business.ts so both
 * routers enforce the same rule without duplicating the lookup logic.
 */
export async function requireCompanyPortfolio(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const household = await prisma.household.findUnique({ where: { id: householdOf(req) }, select: { portfolioType: true } });
    if (!household || household.portfolioType !== "COMPANY") {
      throw new FriendlyError("This is part of Company Finance. Open (or add) a Company Finance portfolio to use it.", 403);
    }
    next();
  } catch (err) {
    next(err);
  }
}
