import { NextFunction, Response, Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { businessEntrySchema, businessPaySchema, businessProfileSchema, ledgerAccountSchema, ledgerAccountUpdateSchema, manualJournalSchema } from "../lib/validation";
import { getFinancialYearId } from "../lib/financialYear";
import { formatAbn } from "../lib/abn";
import { computeGst } from "../services/business/gst";
import { isFixedAsset } from "../services/business/chart";
import { PostingError, assertBalanced } from "../services/business/posting";
import { ensureBusinessSetup, loadAccounts, loadLines, parseDay, repostEntry } from "../services/business/ledgerStore";
import {
  aggregate, buildAgedReport, buildBalanceSheet, buildCashSummary, buildGstReport, buildIncomeStatement, buildLedger, buildMonthly, buildTrialBalance,
  endOfDayUtc, financialYearRangeUtc, financialYearStartYearUtc, naturalBalance, netProfit, type AccountRef,
} from "../services/business/reports";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your portfolio first.", 400);
  return req.householdId;
}

// Business accounting belongs to Company Finance portfolios.
router.use(async (req: AuthedRequest, _res: Response, next: NextFunction) => {
  try {
    const household = await prisma.household.findUnique({ where: { id: householdOf(req) }, select: { portfolioType: true } });
    if (!household || household.portfolioType !== "COMPANY") {
      throw new FriendlyError("Business accounting is part of Company Finance. Open (or add) a Company Finance portfolio to use it.", 403);
    }
    next();
  } catch (err) {
    next(err);
  }
});

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// --------------------------------------------------------------------------- profile
async function profileDto(householdId: string) {
  const p = await ensureBusinessSetup(householdId);
  return {
    businessName: p.businessName,
    abn: p.abn,
    abnFormatted: p.abn ? formatAbn(p.abn) : null,
    entityType: p.entityType,
    gstRegistered: p.gstRegistered,
    gstBasis: p.gstBasis,
  };
}

router.get(
  "/profile",
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await profileDto(householdOf(req)));
  })
);

router.put(
  "/profile",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureBusinessSetup(householdId);
    const data = businessProfileSchema.parse(req.body);
    await prisma.businessProfile.update({ where: { householdId }, data });
    res.json(await profileDto(householdId));
  })
);

// --------------------------------------------------------------------------- chart of accounts
router.get(
  "/accounts",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureBusinessSetup(householdId);
    const asAt = parseDay(req.query.asAt, true) ?? endOfDayUtc(new Date());
    const [rows, lines] = await Promise.all([prisma.ledgerAccount.findMany({ where: { householdId }, orderBy: { code: "asc" } }), loadLines(householdId, { to: asAt })]);
    const balances = aggregate(lines);
    const used = new Set(lines.map((l) => l.accountId));
    res.json({
      asAt: asAt.toISOString(),
      accounts: rows.map((a) => ({
        id: a.id, code: a.code, name: a.name, type: a.type, group: a.group, isBank: a.isBank, isActive: a.isActive, isSystem: !!a.systemKey,
        balanceCents: naturalBalance(a, balances.get(a.id)), hasActivity: used.has(a.id),
      })),
    });
  })
);

router.post(
  "/accounts",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureBusinessSetup(householdId);
    const data = ledgerAccountSchema.parse(req.body);
    if (data.isBank && data.type !== "ASSET" && data.type !== "LIABILITY") throw new FriendlyError("Only asset accounts (bank, cash) or credit cards can be money accounts.", 400);
    const clash = await prisma.ledgerAccount.findUnique({ where: { householdId_code: { householdId, code: data.code } } });
    if (clash) throw new FriendlyError(`The code ${data.code} is already used by “${clash.name}”.`, 409);
    const created = await prisma.ledgerAccount.create({ data: { householdId, ...data } });
    res.status(201).json(created);
  })
);

router.patch(
  "/accounts/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const account = await prisma.ledgerAccount.findFirst({ where: { id: req.params.id, householdId } });
    if (!account) throw new FriendlyError("We couldn't find that account.", 404);
    const data = ledgerAccountUpdateSchema.parse(req.body);
    if (data.isActive === false && account.systemKey) throw new FriendlyError("This account is used by the app itself and can't be switched off.", 400);
    if (data.code && data.code !== account.code) {
      const clash = await prisma.ledgerAccount.findUnique({ where: { householdId_code: { householdId, code: data.code } } });
      if (clash) throw new FriendlyError(`The code ${data.code} is already used by “${clash.name}”.`, 409);
    }
    res.json(await prisma.ledgerAccount.update({ where: { id: account.id }, data }));
  })
);

router.delete(
  "/accounts/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const account = await prisma.ledgerAccount.findFirst({ where: { id: req.params.id, householdId } });
    if (!account) throw new FriendlyError("We couldn't find that account.", 404);
    if (account.systemKey) throw new FriendlyError("This account is used by the app itself and can't be deleted.", 400);
    const [lines, entries] = await Promise.all([
      prisma.journalLine.count({ where: { accountId: account.id } }),
      prisma.businessEntry.count({ where: { OR: [{ accountId: account.id }, { bankAccountId: account.id }] } }),
    ]);
    if (lines > 0 || entries > 0) throw new FriendlyError("This account has transactions, so it can't be deleted. You can switch it off instead.", 409);
    await prisma.ledgerAccount.delete({ where: { id: account.id } });
    res.json({ message: "Account deleted." });
  })
);

// --------------------------------------------------------------------------- sales & expenses
const entryInclude = { account: { select: { id: true, code: true, name: true } }, bankAccount: { select: { id: true, code: true, name: true } } } as const;

type EntryWithAccounts = Prisma.BusinessEntryGetPayload<{ include: typeof entryInclude }>;

function entryDto(e: EntryWithAccounts) {
  return {
    id: e.id, kind: e.kind, date: iso(e.date), dueDate: iso(e.dueDate), description: e.description, contactName: e.contactName, reference: e.reference,
    account: e.account, totalCents: e.totalCents, gstCents: e.gstCents, netCents: e.totalCents - e.gstCents, gstMode: e.gstMode, status: e.status,
    paidDate: iso(e.paidDate), bankAccount: e.bankAccount, notes: e.notes,
  };
}

function periodOf(req: AuthedRequest): { from: Date; to: Date; financialYear: string } {
  const financialYear = typeof req.query.financialYear === "string" && /^\d{4}-\d{2}$/.test(req.query.financialYear) ? req.query.financialYear : getFinancialYearId(new Date());
  const fy = financialYearRangeUtc(financialYear);
  return { from: parseDay(req.query.from) ?? fy.from, to: parseDay(req.query.to, true) ?? fy.to, financialYear };
}

router.get(
  "/entries",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureBusinessSetup(householdId);
    const { from, to } = periodOf(req);
    const kind = req.query.kind === "INCOME" || req.query.kind === "EXPENSE" ? req.query.kind : undefined;
    const status = req.query.status === "PAID" || req.query.status === "UNPAID" ? req.query.status : undefined;
    const rows = await prisma.businessEntry.findMany({
      where: { householdId, date: { gte: from, lte: to }, ...(kind ? { kind } : {}), ...(status ? { status } : {}) },
      include: entryInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    const total = (k: "INCOME" | "EXPENSE", f: (e: (typeof rows)[number]) => number) => rows.filter((e) => e.kind === k).reduce((s, e) => s + f(e), 0);
    res.json({
      items: rows.map(entryDto),
      totals: {
        incomeCents: total("INCOME", (e) => e.totalCents - e.gstCents),
        expenseCents: total("EXPENSE", (e) => e.totalCents - e.gstCents),
        unpaidIncomeCents: rows.filter((e) => e.kind === "INCOME" && e.status === "UNPAID").reduce((s, e) => s + e.totalCents, 0),
        unpaidExpenseCents: rows.filter((e) => e.kind === "EXPENSE" && e.status === "UNPAID").reduce((s, e) => s + e.totalCents, 0),
      },
    });
  })
);

/** Checks the category and bank account belong to this business and suit the kind of entry. */
async function checkEntryAccounts(householdId: string, data: { kind: string; accountId: string; status: string; bankAccountId?: string | null }) {
  const account = await prisma.ledgerAccount.findFirst({ where: { id: data.accountId, householdId, isActive: true } });
  if (!account) throw new FriendlyError("Please choose a category from your chart of accounts.", 400);
  if (data.kind === "INCOME" && account.type !== "INCOME") throw new FriendlyError("A sale needs an income category.", 400);
  if (data.kind === "EXPENSE" && !(account.type === "EXPENSE" || (account.type === "ASSET" && !account.systemKey && !account.isBank))) {
    throw new FriendlyError("An expense needs an expense category (or an asset account such as equipment for something you're buying to keep).", 400);
  }
  if (data.status === "PAID") {
    const bank = data.bankAccountId ? await prisma.ledgerAccount.findFirst({ where: { id: data.bankAccountId, householdId, isActive: true, isBank: true } }) : null;
    if (!bank) throw new FriendlyError("Please choose a bank account (or card) from your chart of accounts.", 400);
  }
}

function entryData(data: ReturnType<typeof businessEntrySchema.parse>, gstRegistered: boolean) {
  const g = computeGst(data.amountCents, data.gstMode, gstRegistered);
  const paid = data.status === "PAID";
  return {
    kind: data.kind,
    date: data.date,
    dueDate: data.dueDate ?? null,
    description: data.description,
    contactName: data.contactName || null,
    reference: data.reference || null,
    accountId: data.accountId,
    totalCents: g.totalCents,
    gstCents: g.gstCents,
    gstMode: gstRegistered ? data.gstMode : "FREE",
    status: data.status,
    paidDate: paid ? data.paidDate ?? null : null,
    bankAccountId: paid ? data.bankAccountId ?? null : null,
    notes: data.notes || null,
  };
}

router.post(
  "/entries",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const profile = await ensureBusinessSetup(householdId);
    const data = businessEntrySchema.parse(req.body);
    await checkEntryAccounts(householdId, data);
    const created = await prisma.$transaction(
      async (tx) => {
        const entry = await tx.businessEntry.create({ data: { householdId, createdById: req.userId!, ...entryData(data, profile.gstRegistered) }, include: entryInclude });
        await repostEntry(tx, entry, req.userId!);
        return entry;
      },
      { timeout: 15000 }
    );
    res.status(201).json(entryDto(created));
  })
);

async function findEntry(req: AuthedRequest) {
  const householdId = householdOf(req);
  const entry = await prisma.businessEntry.findFirst({ where: { id: req.params.id, householdId } });
  if (!entry) throw new FriendlyError("We couldn't find that entry.", 404);
  return { householdId, entry };
}

router.put(
  "/entries/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, entry: existing } = await findEntry(req);
    const profile = await ensureBusinessSetup(householdId);
    const data = businessEntrySchema.parse(req.body);
    await checkEntryAccounts(householdId, data);
    const updated = await prisma.$transaction(
      async (tx) => {
        const entry = await tx.businessEntry.update({ where: { id: existing.id }, data: entryData(data, profile.gstRegistered), include: entryInclude });
        await repostEntry(tx, entry, req.userId!);
        return entry;
      },
      { timeout: 15000 }
    );
    res.json(entryDto(updated));
  })
);

router.post(
  "/entries/:id/pay",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, entry: existing } = await findEntry(req);
    const { paidDate, bankAccountId } = businessPaySchema.parse(req.body);
    await checkEntryAccounts(householdId, { kind: existing.kind, accountId: existing.accountId, status: "PAID", bankAccountId });
    const updated = await prisma.$transaction(async (tx) => {
      const entry = await tx.businessEntry.update({ where: { id: existing.id }, data: { status: "PAID", paidDate, bankAccountId }, include: entryInclude });
      await repostEntry(tx, entry, req.userId!);
      return entry;
    });
    res.json(entryDto(updated));
  })
);

router.post(
  "/entries/:id/unpay",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { entry: existing } = await findEntry(req);
    const updated = await prisma.$transaction(async (tx) => {
      const entry = await tx.businessEntry.update({ where: { id: existing.id }, data: { status: "UNPAID", paidDate: null, bankAccountId: null }, include: entryInclude });
      await repostEntry(tx, entry, req.userId!);
      return entry;
    });
    res.json(entryDto(updated));
  })
);

router.delete(
  "/entries/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, entry } = await findEntry(req);
    await prisma.$transaction([
      prisma.journalEntry.deleteMany({ where: { householdId, sourceId: entry.id } }),
      prisma.businessEntry.delete({ where: { id: entry.id } }),
    ]);
    res.json({ message: "Deleted." });
  })
);

// --------------------------------------------------------------------------- manual journals
router.get(
  "/journals",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureBusinessSetup(householdId);
    const { from, to } = periodOf(req);
    const rows = await prisma.journalEntry.findMany({
      where: { householdId, source: "MANUAL", date: { gte: from, lte: to } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
    res.json({
      items: rows.map((j) => ({
        id: j.id, date: iso(j.date), description: j.description, reference: j.reference,
        lines: j.lines.map((l) => ({ accountCode: l.account.code, accountName: l.account.name, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo })),
        totalCents: j.lines.reduce((s, l) => s + l.debitCents, 0),
      })),
    });
  })
);

router.post(
  "/journals",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureBusinessSetup(householdId);
    const data = manualJournalSchema.parse(req.body);
    const accounts = await prisma.ledgerAccount.findMany({ where: { householdId, id: { in: data.lines.map((l) => l.accountId) }, isActive: true }, select: { id: true, systemKey: true, name: true } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const line of data.lines) {
      const a = byId.get(line.accountId);
      if (!a) throw new FriendlyError("One of the accounts in this entry isn't in your chart of accounts.", 400);
      // Receivables and payables are driven by sales and expenses — adjusting them by hand would stop the aged reports matching the ledger.
      if (a.systemKey === "ACCOUNTS_RECEIVABLE" || a.systemKey === "ACCOUNTS_PAYABLE") {
        throw new FriendlyError(`“${a.name}” changes when you record and pay sales and bills, so it can't be used in a manual entry.`, 400);
      }
    }
    try {
      assertBalanced(data.lines);
    } catch (err) {
      if (err instanceof PostingError) throw new FriendlyError(err.message, 400);
      throw err;
    }
    const created = await prisma.journalEntry.create({
      data: {
        householdId, date: data.date, description: data.description, reference: data.reference || null, source: "MANUAL", createdById: req.userId!,
        lines: { create: data.lines.map((l) => ({ accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo || null })) },
      },
    });
    res.status(201).json({ id: created.id });
  })
);

router.delete(
  "/journals/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const journal = await prisma.journalEntry.findFirst({ where: { id: req.params.id, householdId } });
    if (!journal) throw new FriendlyError("We couldn't find that entry.", 404);
    if (journal.source !== "MANUAL") throw new FriendlyError("This entry was created from a sale or bill. Edit or delete that instead.", 400);
    await prisma.journalEntry.delete({ where: { id: journal.id } });
    res.json({ message: "Deleted." });
  })
);

// --------------------------------------------------------------------------- reports
const reports = Router();
router.use("/reports", reports);

async function reportContext(req: AuthedRequest) {
  const householdId = householdOf(req);
  const profile = await ensureBusinessSetup(householdId);
  const accounts = await loadAccounts(householdId);
  return { householdId, profile, accounts };
}

const namedAccounts = (accounts: AccountRef[]) => accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }));

reports.get(
  "/income-statement",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, accounts } = await reportContext(req);
    const { from, to } = periodOf(req);
    const lines = await loadLines(householdId, { from, to });
    res.json({ from: from.toISOString(), to: to.toISOString(), statement: buildIncomeStatement(accounts, aggregate(lines)) });
  })
);

reports.get(
  "/balance-sheet",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, accounts } = await reportContext(req);
    const asAt = parseDay(req.query.asAt, true) ?? endOfDayUtc(new Date());
    const fyStart = new Date(Date.UTC(financialYearStartYearUtc(asAt), 6, 1));
    const upTo = await loadLines(householdId, { to: asAt });
    const thisYear = upTo.filter((l) => l.date >= fyStart);
    res.json({ asAt: asAt.toISOString(), financialYearStart: fyStart.toISOString(), sheet: buildBalanceSheet(accounts, aggregate(upTo), aggregate(thisYear)) });
  })
);

reports.get(
  "/trial-balance",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, accounts } = await reportContext(req);
    const asAt = parseDay(req.query.asAt, true) ?? endOfDayUtc(new Date());
    res.json({ asAt: asAt.toISOString(), trialBalance: buildTrialBalance(accounts, aggregate(await loadLines(householdId, { to: asAt }))) });
  })
);

reports.get(
  "/gst",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, profile, accounts } = await reportContext(req);
    const { from, to } = periodOf(req);
    const entries = await prisma.businessEntry.findMany({
      where: { householdId },
      select: { kind: true, date: true, paidDate: true, status: true, totalCents: true, gstCents: true, accountId: true },
    });
    const fixed = new Set(accounts.filter(isFixedAsset).map((a) => a.id));
    const basis = profile.gstBasis === "CASH" ? "CASH" : "ACCRUAL";
    const report = buildGstReport(
      entries.map((e) => ({ kind: e.kind as "INCOME" | "EXPENSE", date: e.date, paidDate: e.paidDate, status: e.status as "PAID" | "UNPAID", totalCents: e.totalCents, gstCents: e.gstCents, accountId: e.accountId })),
      basis, from, to, fixed
    );
    res.json({ from: from.toISOString(), to: to.toISOString(), gstRegistered: profile.gstRegistered, report });
  })
);

reports.get(
  "/aged",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId } = await reportContext(req);
    const asAt = parseDay(req.query.asAt, true) ?? endOfDayUtc(new Date());
    const type = req.query.type === "payables" ? "EXPENSE" : "INCOME";
    const entries = await prisma.businessEntry.findMany({
      where: { householdId, kind: type },
      select: { id: true, kind: true, date: true, dueDate: true, contactName: true, reference: true, description: true, totalCents: true, status: true, paidDate: true },
    });
    res.json({ asAt: asAt.toISOString(), type: type === "INCOME" ? "receivables" : "payables", report: buildAgedReport(entries.map((e) => ({ ...e, kind: e.kind as "INCOME" | "EXPENSE", status: e.status as "PAID" | "UNPAID" })), type, asAt) });
  })
);

reports.get(
  "/cash",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, accounts } = await reportContext(req);
    const { from, to } = periodOf(req);
    const lines = await loadLines(householdId, { to });
    const before = aggregate(lines.filter((l) => l.date < from));
    const period = aggregate(lines.filter((l) => l.date >= from));
    res.json({ from: from.toISOString(), to: to.toISOString(), summary: buildCashSummary(accounts, before, period) });
  })
);

reports.get(
  "/monthly",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, accounts } = await reportContext(req);
    const { from, to } = periodOf(req);
    res.json({ from: from.toISOString(), to: to.toISOString(), months: buildMonthly(accounts, await loadLines(householdId, { from, to }), from, to) });
  })
);

reports.get(
  "/ledger",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, accounts } = await reportContext(req);
    const account = accounts.find((a) => a.id === req.query.accountId);
    if (!account) throw new FriendlyError("Please choose an account.", 400);
    const { from, to } = periodOf(req);
    const [beforeLines, rows] = await Promise.all([
      loadLines(householdId, { to: new Date(from.getTime() - 1) }),
      prisma.journalLine.findMany({
        where: { accountId: account.id, entry: { householdId, date: { gte: from, lte: to } } },
        select: { debitCents: true, creditCents: true, memo: true, entry: { select: { date: true, description: true, reference: true } } },
      }),
    ]);
    const opening = naturalBalance(account, aggregate(beforeLines.filter((l) => l.accountId === account.id)).get(account.id));
    const ledger = buildLedger(account, opening, rows.map((r) => ({ date: r.entry.date, description: r.memo ? `${r.entry.description} — ${r.memo}` : r.entry.description, reference: r.entry.reference, debitCents: r.debitCents, creditCents: r.creditCents })));
    res.json({ from: from.toISOString(), to: to.toISOString(), account: { id: account.id, code: account.code, name: account.name, type: account.type }, ledger });
  })
);

reports.get(
  "/accounts",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { accounts } = await reportContext(req);
    res.json({ accounts: namedAccounts(accounts) });
  })
);

// --------------------------------------------------------------------------- dashboard summary
router.get(
  "/summary",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const profile = await ensureBusinessSetup(householdId);
    const accounts = await loadAccounts(householdId);
    const { from, to, financialYear } = periodOf(req);
    const now = endOfDayUtc(new Date());
    const asAt = now < to ? now : to;
    const lines = await loadLines(householdId, { to });
    const period = aggregate(lines.filter((l) => l.date >= from));
    const statement = buildIncomeStatement(accounts, period);
    const toDate = aggregate(lines.filter((l) => l.date <= asAt));
    const cash = buildCashSummary(accounts, new Map(), toDate);

    const entries = await prisma.businessEntry.findMany({
      where: { householdId },
      select: { id: true, kind: true, date: true, dueDate: true, paidDate: true, contactName: true, reference: true, description: true, totalCents: true, gstCents: true, status: true, accountId: true },
    });
    const asAgedEntries = entries.map((e) => ({ ...e, kind: e.kind as "INCOME" | "EXPENSE", status: e.status as "PAID" | "UNPAID" }));
    const receivables = buildAgedReport(asAgedEntries, "INCOME", asAt);
    const payables = buildAgedReport(asAgedEntries, "EXPENSE", asAt);
    const fixed = new Set(accounts.filter(isFixedAsset).map((a) => a.id));
    const gst = buildGstReport(asAgedEntries.map((e) => ({ ...e })), profile.gstBasis === "CASH" ? "CASH" : "ACCRUAL", from, to, fixed);
    const recent = await prisma.businessEntry.findMany({ where: { householdId }, include: entryInclude, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8 });

    res.json({
      financialYear,
      from: from.toISOString(),
      to: to.toISOString(),
      asAt: asAt.toISOString(),
      incomeCents: statement.revenue.totalCents + statement.otherIncome.totalCents,
      expensesCents: statement.totalExpensesCents,
      netProfitCents: netProfit(accounts, period),
      cashCents: cash.closingCents,
      receivablesCents: receivables.totalCents,
      receivablesOverdueCents: receivables.totalCents - receivables.totals.current,
      payablesCents: payables.totalCents,
      payablesOverdueCents: payables.totalCents - payables.totals.current,
      gstRegistered: profile.gstRegistered,
      netGstCents: gst.netGstCents,
      months: buildMonthly(accounts, lines.filter((l) => l.date >= from), from, to),
      recent: recent.map(entryDto),
      hasData: entries.length > 0 || lines.length > 0,
    });
  })
);

export default router;
