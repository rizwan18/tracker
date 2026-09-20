import type { PortfolioType } from "./constants";

export const PORTFOLIO_LABELS: Record<PortfolioType, string> = {
  PERSONAL: "Personal Finance",
  COMPANY: "Company Finance",
  TRUST: "Trust Finance",
  OTHER: "Other Type",
};

/** A sensible starting name when the person doesn't type one. */
export function defaultPortfolioName(type: PortfolioType): string {
  return PORTFOLIO_LABELS[type];
}

/** A principal place of residence is a personal thing — companies and trusts don't have one. */
export function canHavePpr(type: string): boolean {
  return type === "PERSONAL";
}

export const MAX_PORTFOLIOS_PER_PERSON = 10;

/**
 * Which portfolio (household) a request works on. The browser sends the one it
 * picked in the X-Portfolio-Id header; it is only honoured if the person is a
 * member of it, otherwise their default is used (no header) or the request is refused.
 */
export async function chooseHousehold(
  requested: string | undefined,
  defaultHouseholdId: string | null,
  isMember: (householdId: string) => Promise<boolean>
): Promise<{ householdId: string | null } | { forbidden: true }> {
  if (!requested || requested === defaultHouseholdId) return { householdId: defaultHouseholdId };
  return (await isMember(requested)) ? { householdId: requested } : { forbidden: true };
}
