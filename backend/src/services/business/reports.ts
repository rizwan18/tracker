/**
 * Report builders for the small-business module. Pure functions: they take
 * account definitions plus ledger totals (whole cents) and return report data.
 */
import { isDebitNormal } from "./chart";

export interface AccountRef {
  id: string;
  code: string;
  name: string;
  type: string;
  group: string;
  isBank: boolean;
  systemKey?: string | null;
}

export interface BalanceRow {
  accountId: string;
  debitCents: number;
  creditCents: number;
}

export interface LedgerLineForReport {
  accountId: string;
  date: Date;
  debitCents: number;
  creditCents: number;
}

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amountCents: number;
}

export interface Section {
  lines: StatementLine[];
  totalCents: number;
}

/** Adds up ledger lines per account. */
export function aggregate(lines: Array<{ accountId: string; debitCents: number; creditCents: number }>): Map<string, BalanceRow> {
  const map = new Map<string, BalanceRow>();
  for (const l of lines) {
    const row = map.get(l.accountId) ?? { accountId: l.accountId, debitCents: 0, creditCents: 0 };
    row.debitCents += l.debitCents;
    row.creditCents += l.creditCents;
    map.set(l.accountId, row);
  }
  return map;
}

/** The account's balance in its natural direction (positive = normal). */
export function naturalBalance(account: Pick<AccountRef, "type">, row: { debitCents: number; creditCents: number } | undefined): number {
  if (!row) return 0;
  return isDebitNormal(account.type) ? row.debitCents - row.creditCents : row.creditCents - row.debitCents;
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

function sectionFor(accounts: AccountRef[], balances: Map<string, BalanceRow>, match: (a: AccountRef) => boolean): Section {
  const lines = accounts
    .filter(match)
    .sort(byCode)
    .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amountCents: naturalBalance(a, balances.get(a.id)) }))
    .filter((l) => l.amountCents !== 0);
  return { lines, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0) };
}

// ---------------------------------------------------------------------------
// Income statement (profit & loss)
// ---------------------------------------------------------------------------
export interface IncomeStatement {
  revenue: Section;
  costOfSales: Section;
  grossProfitCents: number;
  otherIncome: Section;
  operatingExpenses: Section;
  totalExpensesCents: number;
  netProfitCents: number;
}

export function buildIncomeStatement(accounts: AccountRef[], balances: Map<string, BalanceRow>): IncomeStatement {
  const revenue = sectionFor(accounts, balances, (a) => a.type === "INCOME" && a.group === "REVENUE");
  const costOfSales = sectionFor(accounts, balances, (a) => a.type === "EXPENSE" && a.group === "COST_OF_SALES");
  const otherIncome = sectionFor(accounts, balances, (a) => a.type === "INCOME" && a.group !== "REVENUE");
  const operatingExpenses = sectionFor(accounts, balances, (a) => a.type === "EXPENSE" && a.group !== "COST_OF_SALES");
  const grossProfitCents = revenue.totalCents - costOfSales.totalCents;
  return {
    revenue,
    costOfSales,
    grossProfitCents,
    otherIncome,
    operatingExpenses,
    totalExpensesCents: costOfSales.totalCents + operatingExpenses.totalCents,
    netProfitCents: grossProfitCents + otherIncome.totalCents - operatingExpenses.totalCents,
  };
}

/** Profit for a set of balances: income minus expenses. */
export function netProfit(accounts: AccountRef[], balances: Map<string, BalanceRow>): number {
  let total = 0;
  for (const a of accounts) {
    if (a.type === "INCOME") total += naturalBalance(a, balances.get(a.id));
    else if (a.type === "EXPENSE") total -= naturalBalance(a, balances.get(a.id));
  }
  return total;
}

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------
export interface BalanceSheet {
  currentAssets: Section;
  nonCurrentAssets: Section;
  totalAssetsCents: number;
  currentLiabilities: Section;
  nonCurrentLiabilities: Section;
  totalLiabilitiesCents: number;
  netAssetsCents: number;
  equity: Section;
  /** Assets − liabilities equals equity (it always should; false would indicate a bug or bad data). */
  balanced: boolean;
}

/**
 * @param balancesToDate    every ledger line up to the "as at" date
 * @param balancesThisYear  ledger lines from the start of the financial year to the "as at" date
 *
 * There are no year-end closing entries: profit from earlier years is worked out
 * from the ledger (all-time profit − this year's profit) and shown as retained earnings.
 */
export function buildBalanceSheet(accounts: AccountRef[], balancesToDate: Map<string, BalanceRow>, balancesThisYear: Map<string, BalanceRow>): BalanceSheet {
  const currentAssets = sectionFor(accounts, balancesToDate, (a) => a.type === "ASSET" && a.group === "CURRENT_ASSET");
  const nonCurrentAssets = sectionFor(accounts, balancesToDate, (a) => a.type === "ASSET" && a.group === "NON_CURRENT_ASSET");
  const currentLiabilities = sectionFor(accounts, balancesToDate, (a) => a.type === "LIABILITY" && a.group === "CURRENT_LIABILITY");
  const nonCurrentLiabilities = sectionFor(accounts, balancesToDate, (a) => a.type === "LIABILITY" && a.group !== "CURRENT_LIABILITY");
  const equityAccounts = sectionFor(accounts, balancesToDate, (a) => a.type === "EQUITY");

  const allTime = netProfit(accounts, balancesToDate);
  const thisYear = netProfit(accounts, balancesThisYear);
  const priorYears = allTime - thisYear;

  const equityLines = [...equityAccounts.lines];
  if (priorYears !== 0) equityLines.push({ accountId: "prior-earnings", code: "", name: "Retained earnings (prior years)", amountCents: priorYears });
  equityLines.push({ accountId: "current-earnings", code: "", name: "Current year earnings", amountCents: thisYear });
  const equity: Section = { lines: equityLines, totalCents: equityLines.reduce((sum, l) => sum + l.amountCents, 0) };

  const totalAssetsCents = currentAssets.totalCents + nonCurrentAssets.totalCents;
  const totalLiabilitiesCents = currentLiabilities.totalCents + nonCurrentLiabilities.totalCents;
  const netAssetsCents = totalAssetsCents - totalLiabilitiesCents;
  return { currentAssets, nonCurrentAssets, totalAssetsCents, currentLiabilities, nonCurrentLiabilities, totalLiabilitiesCents, netAssetsCents, equity, balanced: netAssetsCents === equity.totalCents };
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------
export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debitCents: number;
  creditCents: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
}

export function buildTrialBalance(accounts: AccountRef[], balances: Map<string, BalanceRow>): TrialBalance {
  const rows: TrialBalanceRow[] = [];
  for (const a of [...accounts].sort(byCode)) {
    const row = balances.get(a.id);
    if (!row) continue;
    const net = row.debitCents - row.creditCents;
    if (net === 0) continue;
    rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, debitCents: net > 0 ? net : 0, creditCents: net < 0 ? -net : 0 });
  }
  const totalDebitCents = rows.reduce((s, r) => s + r.debitCents, 0);
  const totalCreditCents = rows.reduce((s, r) => s + r.creditCents, 0);
  return { rows, totalDebitCents, totalCreditCents, balanced: totalDebitCents === totalCreditCents };
}

// ---------------------------------------------------------------------------
// GST / BAS summary
// ---------------------------------------------------------------------------
export interface GstEntry {
  kind: "INCOME" | "EXPENSE";
  date: Date;
  paidDate?: Date | null;
  status: "PAID" | "UNPAID";
  totalCents: number;
  gstCents: number;
  accountId: string;
}

export interface GstReport {
  basis: "ACCRUAL" | "CASH";
  /** G1 — total sales including GST. */
  g1TotalSalesCents: number;
  /** G3 — GST-free sales. */
  g3GstFreeSalesCents: number;
  /** 1A — GST on sales. */
  oneAGstOnSalesCents: number;
  /** G10 — capital purchases (equipment, vehicles…), including GST. */
  g10CapitalPurchasesCents: number;
  /** G11 — other purchases, including GST. */
  g11NonCapitalPurchasesCents: number;
  /** 1B — GST on purchases. */
  oneBGstOnPurchasesCents: number;
  /** 1A − 1B: positive = pay the ATO, negative = refund due. */
  netGstCents: number;
  salesCount: number;
  purchaseCount: number;
}

export function buildGstReport(entries: GstEntry[], basis: "ACCRUAL" | "CASH", from: Date, to: Date, fixedAssetAccountIds: Set<string>): GstReport {
  const r: GstReport = {
    basis,
    g1TotalSalesCents: 0,
    g3GstFreeSalesCents: 0,
    oneAGstOnSalesCents: 0,
    g10CapitalPurchasesCents: 0,
    g11NonCapitalPurchasesCents: 0,
    oneBGstOnPurchasesCents: 0,
    netGstCents: 0,
    salesCount: 0,
    purchaseCount: 0,
  };
  for (const e of entries) {
    // Accrual: GST belongs to the period of the invoice. Cash: to the period the money moved.
    const when = basis === "CASH" ? (e.status === "PAID" ? e.paidDate ?? null : null) : e.date;
    if (!when || when < from || when > to) continue;
    if (e.kind === "INCOME") {
      r.salesCount++;
      r.g1TotalSalesCents += e.totalCents;
      if (e.gstCents === 0) r.g3GstFreeSalesCents += e.totalCents;
      r.oneAGstOnSalesCents += e.gstCents;
    } else {
      r.purchaseCount++;
      if (fixedAssetAccountIds.has(e.accountId)) r.g10CapitalPurchasesCents += e.totalCents;
      else r.g11NonCapitalPurchasesCents += e.totalCents;
      r.oneBGstOnPurchasesCents += e.gstCents;
    }
  }
  r.netGstCents = r.oneAGstOnSalesCents - r.oneBGstOnPurchasesCents;
  return r;
}

// ---------------------------------------------------------------------------
// Aged receivables / payables
// ---------------------------------------------------------------------------
export interface AgedEntry {
  id: string;
  kind: "INCOME" | "EXPENSE";
  date: Date;
  dueDate?: Date | null;
  contactName?: string | null;
  reference?: string | null;
  description: string;
  totalCents: number;
  status: "PAID" | "UNPAID";
  paidDate?: Date | null;
}

export const AGED_BUCKETS = ["current", "days1to30", "days31to60", "days61to90", "over90"] as const;
export type AgedBucket = (typeof AGED_BUCKETS)[number];

export interface AgedRow {
  id: string;
  contactName: string;
  reference: string | null;
  description: string;
  date: Date;
  dueDate: Date;
  daysOverdue: number;
  bucket: AgedBucket;
  totalCents: number;
}

export interface AgedReport {
  rows: AgedRow[];
  contacts: Array<{ contactName: string; totals: Record<AgedBucket, number>; totalCents: number }>;
  totals: Record<AgedBucket, number>;
  totalCents: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function bucketFor(daysOverdue: number): AgedBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "days1to30";
  if (daysOverdue <= 60) return "days31to60";
  if (daysOverdue <= 90) return "days61to90";
  return "over90";
}

const emptyBuckets = (): Record<AgedBucket, number> => ({ current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 });

export function buildAgedReport(entries: AgedEntry[], kind: "INCOME" | "EXPENSE", asAt: Date): AgedReport {
  const rows: AgedRow[] = [];
  for (const e of entries) {
    if (e.kind !== kind || e.date > asAt) continue;
    const settledByThen = e.status === "PAID" && !!e.paidDate && e.paidDate <= asAt;
    if (settledByThen) continue;
    const due = e.dueDate ?? e.date;
    const daysOverdue = Math.floor((asAt.getTime() - due.getTime()) / DAY_MS);
    rows.push({
      id: e.id,
      contactName: e.contactName?.trim() || "(No name)",
      reference: e.reference ?? null,
      description: e.description,
      date: e.date,
      dueDate: due,
      daysOverdue,
      bucket: bucketFor(daysOverdue),
      totalCents: e.totalCents,
    });
  }
  rows.sort((a, b) => a.contactName.localeCompare(b.contactName) || a.dueDate.getTime() - b.dueDate.getTime());
  const totals = emptyBuckets();
  const byContact = new Map<string, Record<AgedBucket, number>>();
  for (const r of rows) {
    totals[r.bucket] += r.totalCents;
    const c = byContact.get(r.contactName) ?? emptyBuckets();
    c[r.bucket] += r.totalCents;
    byContact.set(r.contactName, c);
  }
  const contacts = [...byContact.entries()].map(([contactName, t]) => ({ contactName, totals: t, totalCents: AGED_BUCKETS.reduce((s, b) => s + t[b], 0) }));
  return { rows, contacts, totals, totalCents: AGED_BUCKETS.reduce((s, b) => s + totals[b], 0) };
}

// ---------------------------------------------------------------------------
// Cash & bank summary
// ---------------------------------------------------------------------------
export interface CashSummary {
  accounts: Array<{ accountId: string; code: string; name: string; openingCents: number; moneyInCents: number; moneyOutCents: number; closingCents: number }>;
  openingCents: number;
  moneyInCents: number;
  moneyOutCents: number;
  closingCents: number;
}

/** Bank and cash accounts (not credit cards): opening balance, money in, money out and closing balance for a period. */
export function buildCashSummary(accounts: AccountRef[], openingBalances: Map<string, BalanceRow>, periodBalances: Map<string, BalanceRow>): CashSummary {
  const rows = accounts
    .filter((a) => a.isBank && a.type === "ASSET")
    .sort(byCode)
    .map((a) => {
      const openingCents = naturalBalance(a, openingBalances.get(a.id));
      const period = periodBalances.get(a.id);
      const moneyInCents = period?.debitCents ?? 0;
      const moneyOutCents = period?.creditCents ?? 0;
      return { accountId: a.id, code: a.code, name: a.name, openingCents, moneyInCents, moneyOutCents, closingCents: openingCents + moneyInCents - moneyOutCents };
    })
    .filter((r) => r.openingCents !== 0 || r.moneyInCents !== 0 || r.moneyOutCents !== 0 || r.closingCents !== 0);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  return { accounts: rows, openingCents: sum((r) => r.openingCents), moneyInCents: sum((r) => r.moneyInCents), moneyOutCents: sum((r) => r.moneyOutCents), closingCents: sum((r) => r.closingCents) };
}

// ---------------------------------------------------------------------------
// Monthly profit & loss
// ---------------------------------------------------------------------------
export interface MonthlyRow {
  month: string; // YYYY-MM
  incomeCents: number;
  expensesCents: number;
  netCents: number;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Every month between two dates (inclusive), so quiet months still appear. */
export function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  const endKey = monthKey(to);
  for (let i = 0; i < 240; i++) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    out.push(key);
    if (key >= endKey) break;
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

export function buildMonthly(accounts: AccountRef[], lines: LedgerLineForReport[], from: Date, to: Date): MonthlyRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows = new Map(monthsBetween(from, to).map((m) => [m, { month: m, incomeCents: 0, expensesCents: 0, netCents: 0 } as MonthlyRow]));
  for (const l of lines) {
    const a = byId.get(l.accountId);
    if (!a || (a.type !== "INCOME" && a.type !== "EXPENSE")) continue;
    const row = rows.get(monthKey(l.date));
    if (!row) continue;
    if (a.type === "INCOME") row.incomeCents += l.creditCents - l.debitCents;
    else row.expensesCents += l.debitCents - l.creditCents;
  }
  for (const r of rows.values()) r.netCents = r.incomeCents - r.expensesCents;
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// General ledger for one account
// ---------------------------------------------------------------------------
export interface LedgerRow {
  date: Date;
  description: string;
  reference: string | null;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

export function buildLedger(
  account: Pick<AccountRef, "type">,
  openingBalanceCents: number,
  lines: Array<{ date: Date; description: string; reference?: string | null; debitCents: number; creditCents: number }>
): { openingCents: number; rows: LedgerRow[]; closingCents: number; totalDebitCents: number; totalCreditCents: number } {
  const sign = isDebitNormal(account.type) ? 1 : -1;
  let running = openingBalanceCents;
  let totalDebitCents = 0;
  let totalCreditCents = 0;
  const rows = [...lines]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((l) => {
      running += sign * (l.debitCents - l.creditCents);
      totalDebitCents += l.debitCents;
      totalCreditCents += l.creditCents;
      return { date: l.date, description: l.description, reference: l.reference ?? null, debitCents: l.debitCents, creditCents: l.creditCents, balanceCents: running };
    });
  return { openingCents: openingBalanceCents, rows, closingCents: running, totalDebitCents, totalCreditCents };
}

// ---------------------------------------------------------------------------
// Date helpers (entries are stored as UTC midnight of the calendar date chosen)
// ---------------------------------------------------------------------------
/** Start and end of an Australian financial year id like "2026-27", as UTC instants. */
export function financialYearRangeUtc(id: string): { from: Date; to: Date; startYear: number } {
  const startYear = Number(id.slice(0, 4));
  return { startYear, from: new Date(Date.UTC(startYear, 6, 1)), to: new Date(Date.UTC(startYear + 1, 5, 30, 23, 59, 59, 999)) };
}

/** The financial year (start year) that a date falls in. */
export function financialYearStartYearUtc(d: Date): number {
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export function endOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}
