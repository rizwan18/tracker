import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma";
import { FriendlyError } from "../../../middleware/errorHandler";
import { LIKELY_DEDUCTIBLE_EXPENSE_CATEGORIES, POTENTIAL_TAX_SUGGESTION } from "../../../lib/constants";
import { isForwardDatedExpense, syncExpenseReminder } from "../../../lib/expenseReminders";
import { getFinancialYearId } from "../../../lib/financialYear";
import { ensureBusinessSetup, postingAccounts } from "../../business/ledgerStore";
import { journalsForEntry, PostingError } from "../../business/posting";
import { parseDate } from "./format";
import { readTable, type PlannedRow, type ReadTable } from "./table";
import { BUSINESS_COLUMNS, BUSINESS_TITLE, businessKey, planBusiness, renderBusinessCsv, renderBusinessTemplate, type BusinessRecord } from "./business";
import { PERSONAL_READ_COLUMNS, PERSONAL_TITLE, personalKey, planPersonal, renderPersonalCsv, renderPersonalTemplate, type PersonalRecord } from "./personal";

/**
 * The simple income & expenses CSV — one export / template / import for whichever kind of portfolio is open:
 * Personal Finance (income and expenses) or Business Finance (sales and expenses, with GST).
 */
export type Flavour = "PERSONAL" | "BUSINESS";

async function flavourOf(householdId: string): Promise<Flavour> {
  const h = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { portfolioType: true } });
  return h.portfolioType === "COMPANY" ? "BUSINESS" : "PERSONAL";
}

const stamp = (now: Date) => now.toISOString().slice(0, 10);

// ------------------------------------------------------------------ export & template

export async function exportIncomeExpenses(householdId: string, now: Date = new Date()): Promise<{ csv: string; fileName: string; flavour: Flavour }> {
  const flavour = await flavourOf(householdId);
  if (flavour === "BUSINESS") {
    await ensureBusinessSetup(householdId);
    const [entries, accounts] = await Promise.all([
      prisma.businessEntry.findMany({ where: { householdId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
      prisma.ledgerAccount.findMany({ where: { householdId }, select: { id: true, name: true } }),
    ]);
    return { csv: renderBusinessCsv({ entries, accounts }), fileName: `business-sales-and-expenses-${stamp(now)}.csv`, flavour };
  }
  const [transactions, categories, accounts, properties, investments] = await Promise.all([
    prisma.transaction.findMany({ where: { householdId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    prisma.category.findMany({ where: { householdId }, select: { id: true, name: true } }),
    prisma.account.findMany({ where: { householdId }, select: { id: true, name: true } }),
    prisma.property.findMany({ where: { householdId }, select: { id: true, name: true } }),
    prisma.investment.findMany({ where: { householdId }, select: { id: true, name: true } }),
  ]);
  return { csv: renderPersonalCsv({ transactions, categories, accounts, properties, investments }), fileName: `personal-income-and-expenses-${stamp(now)}.csv`, flavour };
}

export async function templateIncomeExpenses(householdId: string, now: Date = new Date()): Promise<{ csv: string; fileName: string; flavour: Flavour }> {
  const flavour = await flavourOf(householdId);
  if (flavour === "BUSINESS") {
    const profile = await ensureBusinessSetup(householdId);
    const accounts = await prisma.ledgerAccount.findMany({ where: { householdId }, select: { id: true, code: true, name: true, type: true, systemKey: true, isBank: true, isActive: true } });
    return { csv: renderBusinessTemplate({ accounts, gstRegistered: profile.gstRegistered }, now), fileName: "business-sales-and-expenses-template.csv", flavour };
  }
  const [categories, accounts, properties, investments] = await Promise.all([
    prisma.category.findMany({ where: { householdId }, select: { id: true, name: true, direction: true }, orderBy: { name: "asc" } }),
    prisma.account.findMany({ where: { householdId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.property.findMany({ where: { householdId }, select: { id: true, name: true } }),
    prisma.investment.findMany({ where: { householdId }, select: { id: true, name: true, ticker: true } }),
  ]);
  return { csv: renderPersonalTemplate({ categories, accounts, properties, investments }, now), fileName: "personal-income-and-expenses-template.csv", flavour };
}

// ------------------------------------------------------------------ import

export interface PreviewRow {
  rowNumber: number;
  status: PlannedRow<unknown>["status"];
  cells: string[];
  messages: Array<{ level: "error" | "warning" | "info"; text: string }>;
}

export interface IncomeExpensesImportResult {
  flavour: Flavour;
  title: string;
  /** What one row is called: "transaction" or "sale or expense". */
  noun: string;
  columns: string[];
  /** Every problem row, every duplicate, every row with a warning, plus the first few clean rows. */
  rows: PreviewRow[];
  /** Clean rows that aren't in `rows`. */
  hiddenReadyRows: number;
  totals: { found: number; ready: number; duplicates: number; errors: number; warnings: number };
  ignoredColumns: string[];
  /** How many rows would be (or were) added. */
  willImport: number;
  imported: number | null;
}

const SAMPLE_READY_ROWS = 15;

/** The date range of the file, so only nearby existing records are loaded to look for duplicates. */
function dateSpan(table: ReadTable): { from: Date; to: Date } | null {
  const days = table.rows.map((r) => (r.cells.date ? parseDate(r.cells.date) : null)).filter((d): d is Date => d !== null).map((d) => d.getTime());
  if (days.length === 0) return null;
  return { from: new Date(Math.min(...days) - 86_400_000), to: new Date(Math.max(...days) + 86_400_000) };
}

function summarise<T>(rows: PlannedRow<T>[], importDuplicates: boolean) {
  const count = (s: PlannedRow<T>["status"]) => rows.filter((r) => r.status === s).length;
  const ready = count("ready");
  const duplicates = count("duplicate");
  return {
    totals: { found: rows.length, ready, duplicates, errors: count("error"), warnings: rows.filter((r) => r.status === "ready" && r.messages.some((m) => m.level === "warning")).length },
    willImport: ready + (importDuplicates ? duplicates : 0),
  };
}

function previewRows<T>(rows: PlannedRow<T>[]): { rows: PreviewRow[]; hiddenReadyRows: number } {
  let clean = 0;
  const shown: PreviewRow[] = [];
  for (const r of rows) {
    const interesting = r.status !== "ready" || r.messages.length > 0;
    if (!interesting && clean >= SAMPLE_READY_ROWS) continue;
    if (!interesting) clean++;
    shown.push({ rowNumber: r.rowNumber, status: r.status, cells: r.cells, messages: r.messages });
  }
  return { rows: shown, hiddenReadyRows: rows.filter((r) => r.status === "ready" && r.messages.length === 0).length - clean };
}

export async function importIncomeExpenses(
  csv: string,
  householdId: string,
  userId: string,
  opts: { dryRun: boolean; importDuplicates: boolean }
): Promise<IncomeExpensesImportResult> {
  const flavour = await flavourOf(householdId);
  return flavour === "BUSINESS" ? importBusiness(csv, householdId, userId, opts) : importPersonal(csv, householdId, userId, opts);
}

async function importPersonal(csv: string, householdId: string, userId: string, opts: { dryRun: boolean; importDuplicates: boolean }): Promise<IncomeExpensesImportResult> {
  const table = readTable(csv, PERSONAL_READ_COLUMNS, PERSONAL_TITLE);
  const span = dateSpan(table);
  const [categories, accounts, properties, investments, existingRows] = await Promise.all([
    prisma.category.findMany({ where: { householdId }, select: { id: true, name: true, direction: true } }),
    prisma.account.findMany({ where: { householdId }, select: { id: true, name: true } }),
    prisma.property.findMany({ where: { householdId }, select: { id: true, name: true } }),
    prisma.investment.findMany({ where: { householdId }, select: { id: true, name: true, ticker: true } }),
    span ? prisma.transaction.findMany({ where: { householdId, date: { gte: span.from, lte: span.to } }, select: { date: true, direction: true, amount: true, description: true } }) : Promise.resolve([]),
  ]);
  const existing = new Map<string, number>();
  for (const t of existingRows) {
    const key = personalKey(t.date, t.direction, Math.round(t.amount * 100), t.description);
    existing.set(key, (existing.get(key) ?? 0) + 1);
  }
  const { rows, previewColumns } = planPersonal(table, { categories, accounts, properties, investments, existing });
  const { totals, willImport } = summarise(rows, opts.importDuplicates);

  let imported: number | null = null;
  if (!opts.dryRun) {
    const toAdd = rows.filter((r): r is PlannedRow<PersonalRecord> & { record: PersonalRecord } => r.record !== null && (r.status === "ready" || (opts.importDuplicates && r.status === "duplicate")));
    if (toAdd.length === 0) throw new FriendlyError("There is nothing to import. Fix the rows that need attention (or choose to import the possible duplicates) and try again.", 400);
    const data = toAdd.map(({ record: r }) => ({
      id: randomUUID(),
      householdId,
      userId,
      date: r.date,
      description: r.description,
      amount: r.amountCents / 100,
      direction: r.direction,
      categoryId: r.categoryId,
      accountId: r.accountId,
      propertyId: r.propertyId,
      investmentId: r.investmentId,
      notes: r.notes,
      isRecurring: r.isRecurring,
      recurrenceFrequency: r.recurrenceFrequency,
      // The same two things the "add a transaction" form fills in for you.
      potentialTaxCategory: r.direction === "EXPENSE" && r.categoryName && LIKELY_DEDUCTIBLE_EXPENSE_CATEGORIES.has(r.categoryName) ? POTENTIAL_TAX_SUGGESTION : null,
      financialYear: getFinancialYearId(r.date),
    }));
    const batches: (typeof data)[] = [];
    for (let i = 0; i < data.length; i += 1000) batches.push(data.slice(i, i + 1000));
    await prisma.$transaction(batches.map((batch) => prisma.transaction.createMany({ data: batch })));
    // Expenses dated in the future also show up under Reminders, as they do when added one at a time.
    for (const t of data) if (isForwardDatedExpense(t.direction, t.date)) await syncExpenseReminder({ id: t.id, householdId, description: t.description, direction: t.direction, date: t.date });
    imported = data.length;
  }
  return { flavour: "PERSONAL", title: PERSONAL_TITLE, noun: "transaction", columns: previewColumns, ...previewRows(rows), totals, ignoredColumns: table.ignoredColumns, willImport, imported };
}

async function importBusiness(csv: string, householdId: string, userId: string, opts: { dryRun: boolean; importDuplicates: boolean }): Promise<IncomeExpensesImportResult> {
  const table = readTable(csv, BUSINESS_COLUMNS, BUSINESS_TITLE);
  const profile = await ensureBusinessSetup(householdId);
  const span = dateSpan(table);
  const [accounts, existingRows] = await Promise.all([
    prisma.ledgerAccount.findMany({ where: { householdId }, select: { id: true, code: true, name: true, type: true, systemKey: true, isBank: true, isActive: true } }),
    span ? prisma.businessEntry.findMany({ where: { householdId, date: { gte: span.from, lte: span.to } }, select: { date: true, kind: true, totalCents: true, description: true, reference: true } }) : Promise.resolve([]),
  ]);
  const existing = new Map<string, number>();
  for (const e of existingRows) {
    const key = businessKey(e.date, e.kind, e.totalCents, e.description, e.reference);
    existing.set(key, (existing.get(key) ?? 0) + 1);
  }
  const { rows, previewColumns } = planBusiness(table, { gstRegistered: profile.gstRegistered, accounts, existing });
  const { totals, willImport } = summarise(rows, opts.importDuplicates);

  let imported: number | null = null;
  if (!opts.dryRun) {
    const toAdd = rows.filter((r): r is PlannedRow<BusinessRecord> & { record: BusinessRecord } => r.record !== null && (r.status === "ready" || (opts.importDuplicates && r.status === "duplicate")));
    if (toAdd.length === 0) throw new FriendlyError("There is nothing to import. Fix the rows that need attention (or choose to import the possible duplicates) and try again.", 400);

    await prisma.$transaction(
      async (tx) => {
        const posting = await postingAccounts(householdId, tx);
        const entries = toAdd.map(({ record }) => ({ id: randomUUID(), householdId, createdById: userId, ...record.data }));
        const journals: Array<{ id: string; householdId: string; date: Date; description: string; reference: string | null; source: string; sourceId: string; createdById: string }> = [];
        const lines: Array<{ id: string; entryId: string; accountId: string; debitCents: number; creditCents: number; memo: string | null }> = [];
        for (const e of entries) {
          let drafts;
          try {
            // Exactly the postings that adding the entry on the form would make.
            drafts = journalsForEntry(
              { kind: e.kind as "INCOME" | "EXPENSE", date: e.date, description: e.description, reference: e.reference, accountId: e.accountId, totalCents: e.totalCents, gstCents: e.gstCents, status: e.status as "PAID" | "UNPAID", paidDate: e.paidDate, bankAccountId: e.bankAccountId },
              posting
            );
          } catch (err) {
            if (err instanceof PostingError) throw new FriendlyError(err.message, 400);
            throw err;
          }
          for (const d of drafts) {
            const id = randomUUID();
            journals.push({ id, householdId, date: d.date, description: d.description, reference: d.reference ?? null, source: d.source, sourceId: e.id, createdById: userId });
            for (const l of d.lines) lines.push({ id: randomUUID(), entryId: id, accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo ?? null });
          }
        }
        const chunk = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / 1000) }, (_, i) => xs.slice(i * 1000, (i + 1) * 1000));
        for (const b of chunk(entries)) await tx.businessEntry.createMany({ data: b });
        for (const b of chunk(journals)) await tx.journalEntry.createMany({ data: b });
        for (const b of chunk(lines)) await tx.journalLine.createMany({ data: b });
        imported = entries.length;
      },
      { timeout: 25_000 }
    );
  }
  return { flavour: "BUSINESS", title: BUSINESS_TITLE, noun: "sale or expense", columns: previewColumns, ...previewRows(rows), totals, ignoredColumns: table.ignoredColumns, willImport, imported };
}

