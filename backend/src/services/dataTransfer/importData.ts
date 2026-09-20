import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { FriendlyError } from "../../middleware/errorHandler";
import { parseExportFile, type ParsedFile } from "./parseExport";
import { collectCandidateIds, emptyExistence, planImport, type ImportContext, type ImportPlan } from "./planImport";
import { ID_TABLES, SECTION_LABELS, SECTION_ORDER, type IdTable, type SectionName } from "./sections";

type IdRow = { id: string };

/** Reads what the importer needs to know about the household: its categories/accounts, and which ids already exist. */
export async function loadImportContext(householdId: string, userId: string, candidates: Record<IdTable, string[]>): Promise<ImportContext> {
  const [user, household, categories, accounts, ppr] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
    prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { portfolioType: true } }),
    prisma.category.findMany({ where: { householdId }, select: { id: true, name: true, direction: true } }),
    prisma.account.findMany({ where: { householdId }, select: { id: true, name: true, type: true } }),
    // one PPR per person across all their portfolios
    prisma.property.findFirst({ where: { propertyType: "PPR", owners: { some: { userId } } }, select: { id: true, name: true } }),
  ]);

  const sel = { select: { id: true } } as const;
  const finders: Record<IdTable, { any: (ids: string[]) => Promise<IdRow[]>; mine: (ids: string[]) => Promise<IdRow[]> }> = {
    accounts: { any: (ids) => prisma.account.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.account.findMany({ where: { id: { in: ids }, householdId }, ...sel }) },
    categories: { any: (ids) => prisma.category.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.category.findMany({ where: { id: { in: ids }, householdId }, ...sel }) },
    properties: { any: (ids) => prisma.property.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.property.findMany({ where: { id: { in: ids }, householdId }, ...sel }) },
    property_schedule_lines: {
      any: (ids) => prisma.propertyScheduleLine.findMany({ where: { id: { in: ids } }, ...sel }),
      mine: (ids) => prisma.propertyScheduleLine.findMany({ where: { id: { in: ids }, property: { householdId } }, ...sel }),
    },
    property_year_details: {
      any: (ids) => prisma.propertyYearDetail.findMany({ where: { id: { in: ids } }, ...sel }),
      mine: (ids) => prisma.propertyYearDetail.findMany({ where: { id: { in: ids }, property: { householdId } }, ...sel }),
    },
    investments: { any: (ids) => prisma.investment.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.investment.findMany({ where: { id: { in: ids }, householdId }, ...sel }) },
    investment_transactions: {
      any: (ids) => prisma.investmentTransaction.findMany({ where: { id: { in: ids } }, ...sel }),
      mine: (ids) => prisma.investmentTransaction.findMany({ where: { id: { in: ids }, investment: { householdId } }, ...sel }),
    },
    dividends: { any: (ids) => prisma.dividend.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.dividend.findMany({ where: { id: { in: ids }, investment: { householdId } }, ...sel }) },
    capital_gain_disposals: {
      any: (ids) => prisma.capitalGainDisposal.findMany({ where: { id: { in: ids } }, ...sel }),
      mine: (ids) => prisma.capitalGainDisposal.findMany({ where: { id: { in: ids }, householdId }, ...sel }),
    },
    transactions: { any: (ids) => prisma.transaction.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.transaction.findMany({ where: { id: { in: ids }, householdId }, ...sel }) },
    bills: { any: (ids) => prisma.bill.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.bill.findMany({ where: { id: { in: ids }, householdId }, ...sel }) },
    reminders: { any: (ids) => prisma.reminder.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.reminder.findMany({ where: { id: { in: ids }, householdId }, ...sel }) },
    documents: { any: (ids) => prisma.document.findMany({ where: { id: { in: ids } }, ...sel }), mine: (ids) => prisma.document.findMany({ where: { id: { in: ids }, householdId }, ...sel }) },
  };

  const exists = emptyExistence();
  await Promise.all(
    ID_TABLES.map(async (table) => {
      const ids = candidates[table];
      if (ids.length === 0) return;
      const [any, mine] = await Promise.all([finders[table].any(ids), finders[table].mine(ids)]);
      any.forEach((r) => exists[table].anywhere.add(r.id));
      mine.forEach((r) => exists[table].inHousehold.add(r.id));
    })
  );

  return { householdId, userId, userEmail: user.email, portfolioType: household.portfolioType, categories, accounts, ppr, exists };
}

const BATCH = 1000;
function batches<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) out.push(rows.slice(i, i + BATCH));
  return out;
}

/** Writes the plan in one all-or-nothing database transaction and reports how many rows were really added. */
export async function applyImportPlan(plan: ImportPlan, ctx: ImportContext): Promise<Record<SectionName, number>> {
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const tags: SectionName[] = [];
  const add = <T>(section: SectionName, rows: T[], run: (batch: T[]) => Prisma.PrismaPromise<{ count: number }>) => {
    for (const batch of batches(rows)) {
      ops.push(run(batch));
      tags.push(section);
    }
  };
  const c = plan.creates;
  // Parents first, children after.
  add("accounts", c.accounts, (data) => prisma.account.createMany({ data, skipDuplicates: true }));
  add("categories", c.categories, (data) => prisma.category.createMany({ data, skipDuplicates: true }));
  add("properties", c.properties, (data) => prisma.property.createMany({ data, skipDuplicates: true }));
  add("property_owners", c.propertyOwnerships, (data) => prisma.propertyOwnership.createMany({ data, skipDuplicates: true }));
  add("property_schedule_lines", c.scheduleLines, (data) => prisma.propertyScheduleLine.createMany({ data, skipDuplicates: true }));
  add("property_year_details", c.yearDetails, (data) => prisma.propertyYearDetail.createMany({ data, skipDuplicates: true }));
  add("investments", c.investments, (data) => prisma.investment.createMany({ data, skipDuplicates: true }));
  add("investment_transactions", c.investmentTransactions, (data) => prisma.investmentTransaction.createMany({ data, skipDuplicates: true }));
  add("dividends", c.dividends, (data) => prisma.dividend.createMany({ data, skipDuplicates: true }));
  add("capital_gain_disposals", c.disposals, (data) => prisma.capitalGainDisposal.createMany({ data, skipDuplicates: true }));
  add("transactions", c.transactions, (data) => prisma.transaction.createMany({ data, skipDuplicates: true }));
  add("bills", c.bills, (data) => prisma.bill.createMany({ data, skipDuplicates: true }));
  add("reminders", c.reminders, (data) => prisma.reminder.createMany({ data, skipDuplicates: true }));
  add("documents", c.documents, (data) => prisma.document.createMany({ data, skipDuplicates: true }));

  if (plan.profile) {
    const { fullName, timezone, easyViewEnabled, householdName } = plan.profile;
    if (fullName !== undefined || timezone !== undefined || easyViewEnabled !== undefined) {
      ops.push(prisma.user.update({ where: { id: ctx.userId }, data: { fullName, timezone, easyViewEnabled } }));
      tags.push("profile");
    }
    if (householdName !== undefined) {
      ops.push(prisma.household.update({ where: { id: ctx.householdId }, data: { name: householdName } }));
      tags.push("profile");
    }
  }

  const results = (await prisma.$transaction(ops)) as unknown[];
  const added = Object.fromEntries(SECTION_ORDER.map((s) => [s, 0])) as Record<SectionName, number>;
  results.forEach((res, i) => {
    const tag = tags[i];
    if (!tag) return;
    added[tag] = tag === "profile" ? 1 : added[tag] + ((res as { count?: number }).count ?? 0);
  });
  return added;
}

export interface ImportPreview {
  summary: ImportPlan["summary"];
  /** The same numbers as `summary`, in display order with friendly names (only sections that appear in the file). */
  sections: Array<{ key: SectionName; label: string; inFile: number; toAdd: number; alreadyThere: number; skipped: number }>;
  warnings: string[];
  errors: string[];
  warningCount: number;
  errorCount: number;
  profile: ImportPlan["profile"];
}

const LIST_LIMIT = 100;

export function describePlan(plan: ImportPlan): ImportPreview {
  return {
    summary: plan.summary,
    sections: SECTION_ORDER.filter((key) => plan.summary[key].inFile > 0).map((key) => ({ key, label: SECTION_LABELS[key], ...plan.summary[key] })),
    warnings: plan.warnings.slice(0, LIST_LIMIT),
    errors: plan.errors.slice(0, LIST_LIMIT),
    warningCount: plan.warnings.length,
    errorCount: plan.errors.length,
    profile: plan.profile,
  };
}

/** Parse + plan (+ apply). Shared by the route so the dry-run and the real import use exactly the same steps. */
export async function runImport(csv: string, householdId: string, userId: string, opts: { dryRun: boolean; includeProfile: boolean }) {
  let parsed: ParsedFile;
  try {
    parsed = parseExportFile(csv);
  } catch (err) {
    if (err instanceof FriendlyError) throw err;
    throw new FriendlyError("We couldn't read that file. Please choose the CSV you downloaded from this app.", 400);
  }
  const candidates = collectCandidateIds(parsed, householdId);
  const ctx = await loadImportContext(householdId, userId, candidates);
  const plan = planImport(parsed, ctx, { includeProfile: opts.includeProfile });
  if (opts.dryRun) return { dryRun: true as const, ...describePlan(plan), added: null };
  const added = await applyImportPlan(plan, ctx);
  return { dryRun: false as const, ...describePlan(plan), added };
}
