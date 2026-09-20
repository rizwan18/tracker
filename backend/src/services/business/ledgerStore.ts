import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { FriendlyError } from "../../middleware/errorHandler";
import { DEFAULT_CHART } from "./chart";
import { PostingError, journalsForEntry, type PostingAccounts } from "./posting";
import type { AccountRef, LedgerLineForReport } from "./reports";
import { endOfDayUtc } from "./reports";

type Db = Prisma.TransactionClient;

/** First visit to the business module: create the business profile and the standard chart of accounts. */
export async function ensureBusinessSetup(householdId: string) {
  const existing = await prisma.businessProfile.findUnique({ where: { householdId } });
  if (existing) return existing;
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { name: true } });
  await prisma.ledgerAccount.createMany({
    data: DEFAULT_CHART.map((a) => ({ householdId, code: a.code, name: a.name, type: a.type, group: a.group, systemKey: a.systemKey ?? null, isBank: a.isBank ?? false })),
    skipDuplicates: true,
  });
  return prisma.businessProfile.upsert({
    where: { householdId },
    create: { householdId, businessName: household.name },
    update: {},
  });
}

export async function loadAccounts(householdId: string): Promise<AccountRef[]> {
  const rows = await prisma.ledgerAccount.findMany({ where: { householdId }, orderBy: { code: "asc" } });
  return rows.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, group: a.group, isBank: a.isBank, systemKey: a.systemKey }));
}

export async function postingAccounts(householdId: string, db: Db | typeof prisma = prisma): Promise<PostingAccounts> {
  const system = await db.ledgerAccount.findMany({ where: { householdId, systemKey: { not: null } }, select: { id: true, systemKey: true } });
  const byKey = new Map(system.map((a) => [a.systemKey as string, a.id]));
  const get = (key: string) => {
    const id = byKey.get(key);
    if (!id) throw new FriendlyError("A required system account is missing from your chart of accounts. Please contact support.", 500);
    return id;
  };
  return { receivable: get("ACCOUNTS_RECEIVABLE"), payable: get("ACCOUNTS_PAYABLE"), gstCollected: get("GST_COLLECTED"), gstPaid: get("GST_PAID") };
}

/** Ledger lines (with their dates) for a household, optionally within a date range. */
export async function loadLines(householdId: string, range: { from?: Date; to?: Date } = {}): Promise<LedgerLineForReport[]> {
  const date: Prisma.DateTimeFilter = {};
  if (range.from) date.gte = range.from;
  if (range.to) date.lte = range.to;
  const rows = await prisma.journalLine.findMany({
    where: { entry: { householdId, ...(range.from || range.to ? { date } : {}) } },
    select: { accountId: true, debitCents: true, creditCents: true, entry: { select: { date: true } } },
  });
  return rows.map((r) => ({ accountId: r.accountId, debitCents: r.debitCents, creditCents: r.creditCents, date: r.entry.date }));
}

/** Parses YYYY-MM-DD as the start of that day (UTC), or the end of that day when `endOfDay`. */
export function parseDay(value: unknown, endOfDay = false): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return endOfDay ? endOfDayUtc(d) : d;
}

interface StoredEntry {
  id: string;
  householdId: string;
  kind: string;
  date: Date;
  description: string;
  reference: string | null;
  accountId: string;
  totalCents: number;
  gstCents: number;
  status: string;
  paidDate: Date | null;
  bankAccountId: string | null;
}

/** (Re)posts the ledger journals for a sale/expense: removes what was posted before and writes the current version. */
export async function repostEntry(tx: Db, entry: StoredEntry, userId: string): Promise<void> {
  const accounts = await postingAccounts(entry.householdId, tx);
  let drafts;
  try {
    drafts = journalsForEntry(
      {
        kind: entry.kind as "INCOME" | "EXPENSE",
        date: entry.date,
        description: entry.description,
        reference: entry.reference,
        accountId: entry.accountId,
        totalCents: entry.totalCents,
        gstCents: entry.gstCents,
        status: entry.status as "PAID" | "UNPAID",
        paidDate: entry.paidDate,
        bankAccountId: entry.bankAccountId,
      },
      accounts
    );
  } catch (err) {
    if (err instanceof PostingError) throw new FriendlyError(err.message, 400);
    throw err;
  }
  await tx.journalEntry.deleteMany({ where: { householdId: entry.householdId, sourceId: entry.id } });
  for (const d of drafts) {
    await tx.journalEntry.create({
      data: {
        householdId: entry.householdId,
        date: d.date,
        description: d.description,
        reference: d.reference ?? null,
        source: d.source,
        sourceId: entry.id,
        createdById: userId,
        lines: { create: d.lines.map((l) => ({ accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo ?? null })) },
      },
    });
  }
}
