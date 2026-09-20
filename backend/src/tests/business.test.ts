import { describe, it, expect } from "vitest";
import { computeGst } from "../services/business/gst";
import { DEFAULT_CHART, GROUPS_BY_TYPE } from "../services/business/chart";
import { PostingError, assertBalanced, journalsForEntry, type JournalDraft, type PostingAccounts } from "../services/business/posting";
import {
  aggregate, bucketFor, buildAgedReport, buildBalanceSheet, buildCashSummary, buildGstReport, buildIncomeStatement, buildLedger, buildMonthly,
  buildTrialBalance, financialYearRangeUtc, financialYearStartYearUtc, monthsBetween, type AccountRef, type AgedEntry, type GstEntry,
} from "../services/business/reports";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dollars = (n: number) => Math.round(n * 100);

// A chart with ids equal to codes, built from the real default chart.
const accounts: AccountRef[] = DEFAULT_CHART.map((a) => ({ id: a.code, code: a.code, name: a.name, type: a.type, group: a.group, isBank: !!a.isBank, systemKey: a.systemKey ?? null }));
const acct: PostingAccounts = { receivable: "1100", payable: "2000", gstCollected: "2200", gstPaid: "1400" };

interface Doc { kind: "INCOME" | "EXPENSE"; date: string; dueDate?: string; account: string; amount: number; gst: "INCLUSIVE" | "EXCLUSIVE" | "FREE"; paid?: string; desc: string; contact?: string }

function post(docs: Doc[], manual: JournalDraft[] = [], gstRegistered = true) {
  const journals: JournalDraft[] = [];
  const entries: Array<GstEntry & AgedEntry> = [];
  docs.forEach((d, i) => {
    const g = computeGst(dollars(d.amount), d.gst, gstRegistered);
    const e = {
      kind: d.kind, date: D(d.date), description: d.desc, accountId: d.account, totalCents: g.totalCents, gstCents: g.gstCents,
      status: d.paid ? ("PAID" as const) : ("UNPAID" as const), paidDate: d.paid ? D(d.paid) : null, bankAccountId: d.paid ? "1000" : null,
    };
    journals.push(...journalsForEntry(e, acct));
    entries.push({ ...e, id: `e${i}`, dueDate: d.dueDate ? D(d.dueDate) : null, contactName: d.contact ?? null, reference: null });
  });
  journals.push(...manual);
  const lines = journals.flatMap((j) => j.lines.map((l) => ({ ...l, date: j.date, description: j.description })));
  return { journals, lines, entries };
}

const manual = (date: string, description: string, debit: [string, number], credit: [string, number]): JournalDraft => ({
  date: D(date), description, source: "MANUAL",
  lines: [{ accountId: debit[0], debitCents: dollars(debit[1]), creditCents: 0 }, { accountId: credit[0], debitCents: 0, creditCents: dollars(credit[1]) }],
});

// A year of trading, in dollars:
//  owner puts in 10,000; cash sale 11,000 inc GST; credit sale 5,500 inc GST (unpaid); rent 2,200 inc GST paid;
//  software 1,100 inc GST (unpaid); equipment 6,600 inc GST paid; depreciation 500; drawings 1,000.
const scenario = () =>
  post(
    [
      { kind: "INCOME", date: "2026-08-01", account: "4000", amount: 11000, gst: "INCLUSIVE", paid: "2026-08-01", desc: "Cash sale" },
      { kind: "INCOME", date: "2026-09-01", dueDate: "2026-10-01", account: "4100", amount: 5500, gst: "INCLUSIVE", desc: "Consulting", contact: "Acme Pty Ltd" },
      { kind: "EXPENSE", date: "2026-08-05", account: "6090", amount: 2200, gst: "INCLUSIVE", paid: "2026-08-05", desc: "Rent" },
      { kind: "EXPENSE", date: "2026-09-10", dueDate: "2026-10-10", account: "6030", amount: 1100, gst: "INCLUSIVE", desc: "Software", contact: "Cloud Co" },
      { kind: "EXPENSE", date: "2026-08-20", account: "1500", amount: 6600, gst: "INCLUSIVE", paid: "2026-08-20", desc: "New laptop and desk" },
    ],
    [
      manual("2026-07-01", "Owner contribution", ["1000", 10000], ["3000", 10000]),
      manual("2026-09-30", "Depreciation", ["6040", 500], ["1510", 500]),
      manual("2026-09-15", "Owner drawings", ["3200", 1000], ["1000", 1000]),
    ]
  );

describe("GST", () => {
  it("works out GST inclusive (1/11), exclusive (10%) and free — in whole cents", () => {
    expect(computeGst(11000, "INCLUSIVE", true)).toEqual({ totalCents: 11000, gstCents: 1000, netCents: 10000 });
    expect(computeGst(10000, "EXCLUSIVE", true)).toEqual({ totalCents: 11000, gstCents: 1000, netCents: 10000 });
    expect(computeGst(5000, "FREE", true)).toEqual({ totalCents: 5000, gstCents: 0, netCents: 5000 });
  });
  it("rounds to the nearest cent and never loses a cent", () => {
    const g = computeGst(1234, "INCLUSIVE", true); // 112.18… → 112
    expect(g.gstCents).toBe(112);
    expect(g.gstCents + g.netCents).toBe(1234);
    const e = computeGst(1005, "EXCLUSIVE", true); // 100.5 → 101 (rounds half up)
    expect(e.totalCents).toBe(1005 + e.gstCents);
  });
  it("charges no GST when the business isn't registered", () => {
    expect(computeGst(11000, "INCLUSIVE", false)).toEqual({ totalCents: 11000, gstCents: 0, netCents: 11000 });
    expect(computeGst(10000, "EXCLUSIVE", false).totalCents).toBe(10000);
  });
});

describe("chart of accounts", () => {
  it("has unique codes, valid groups, and the accounts the app posts to", () => {
    expect(new Set(DEFAULT_CHART.map((a) => a.code)).size).toBe(DEFAULT_CHART.length);
    for (const a of DEFAULT_CHART) expect(GROUPS_BY_TYPE[a.type]).toContain(a.group);
    const keys = DEFAULT_CHART.map((a) => a.systemKey).filter(Boolean);
    expect(keys.sort()).toEqual(["ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE", "GST_COLLECTED", "GST_PAID", "RETAINED_EARNINGS"]);
    expect(DEFAULT_CHART.some((a) => a.isBank && a.type === "ASSET")).toBe(true);
  });
});

describe("posting", () => {
  it("posts an unpaid sale to receivables, income and GST collected", () => {
    const [j, ...rest] = journalsForEntry({ kind: "INCOME", date: D("2026-09-01"), description: "x", accountId: "4000", totalCents: 11000, gstCents: 1000, status: "UNPAID" }, acct);
    expect(rest).toHaveLength(0);
    expect(j!.lines).toEqual([
      { accountId: "1100", debitCents: 11000, creditCents: 0, memo: undefined },
      { accountId: "4000", debitCents: 0, creditCents: 10000, memo: undefined },
      { accountId: "2200", debitCents: 0, creditCents: 1000, memo: undefined },
    ]);
  });
  it("posts a paid expense as the bill plus a separate payment on the paid date", () => {
    const js = journalsForEntry({ kind: "EXPENSE", date: D("2026-08-05"), description: "Rent", accountId: "6090", totalCents: 2200, gstCents: 200, status: "PAID", paidDate: D("2026-08-20"), bankAccountId: "1000" }, acct);
    expect(js).toHaveLength(2);
    expect(js[0]!.date).toEqual(D("2026-08-05"));
    expect(js[1]!.date).toEqual(D("2026-08-20"));
    expect(js[1]!.lines).toEqual([{ accountId: "2000", debitCents: 2200, creditCents: 0 }, { accountId: "1000", debitCents: 0, creditCents: 2200 }]);
    js.forEach((j) => expect(() => assertBalanced(j.lines)).not.toThrow());
  });
  it("omits the GST line when there is no GST", () => {
    const [j] = journalsForEntry({ kind: "INCOME", date: D("2026-09-01"), description: "x", accountId: "4000", totalCents: 5000, gstCents: 0, status: "UNPAID" }, acct);
    expect(j!.lines).toHaveLength(2);
  });
  it("refuses unbalanced or nonsense entries", () => {
    expect(() => assertBalanced([{ accountId: "a", debitCents: 100, creditCents: 0 }, { accountId: "b", debitCents: 0, creditCents: 99 }])).toThrow(PostingError);
    expect(() => assertBalanced([{ accountId: "a", debitCents: 0, creditCents: 0 }])).toThrow(/no amounts/);
    expect(() => assertBalanced([{ accountId: "a", debitCents: 1.5, creditCents: 0 }])).toThrow(/whole cents/);
    expect(() => assertBalanced([{ accountId: "a", debitCents: 5, creditCents: 5 }])).toThrow(/not both/);
    expect(() => journalsForEntry({ kind: "INCOME", date: D("2026-09-01"), description: "x", accountId: "4000", totalCents: 0, gstCents: 0, status: "UNPAID" }, acct)).toThrow(PostingError);
    expect(() => journalsForEntry({ kind: "INCOME", date: D("2026-09-01"), description: "x", accountId: "4000", totalCents: 100, gstCents: 0, status: "PAID", paidDate: D("2026-09-01") }, acct)).toThrow(/bank account/);
    expect(() => journalsForEntry({ kind: "INCOME", date: D("2026-09-01"), description: "x", accountId: "4000", totalCents: 100, gstCents: 0, status: "PAID", bankAccountId: "1000" }, acct)).toThrow(/date it was paid/);
  });
});

describe("a year of trading → the reports", () => {
  const { journals, lines, entries } = scenario();
  const fy = financialYearRangeUtc("2026-27");
  const all = aggregate(lines);

  it("every journal balances, so the trial balance balances", () => {
    journals.forEach((j) => expect(() => assertBalanced(j.lines)).not.toThrow());
    const tb = buildTrialBalance(accounts, all);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
  });

  it("income statement", () => {
    const is = buildIncomeStatement(accounts, all);
    expect(is.revenue.totalCents).toBe(dollars(15000));            // 10,000 sales + 5,000 services (ex GST)
    expect(is.revenue.lines.map((l) => [l.name, l.amountCents])).toEqual([["Sales", dollars(10000)], ["Service Revenue", dollars(5000)]]);
    expect(is.costOfSales.totalCents).toBe(0);
    expect(is.grossProfitCents).toBe(dollars(15000));
    expect(is.operatingExpenses.lines.map((l) => [l.name, l.amountCents])).toEqual([["Computer & Software", dollars(1000)], ["Depreciation", dollars(500)], ["Rent", dollars(2000)]]);
    expect(is.totalExpensesCents).toBe(dollars(3500));
    expect(is.netProfitCents).toBe(dollars(11500));
  });

  it("balance sheet balances: assets − liabilities = equity", () => {
    const thisYear = aggregate(lines.filter((l) => l.date >= fy.from && l.date <= fy.to));
    const bs = buildBalanceSheet(accounts, all, thisYear);
    expect(bs.currentAssets.lines.map((l) => [l.name, l.amountCents])).toEqual([
      ["Cash at Bank", dollars(11200)], ["Accounts Receivable", dollars(5500)], ["GST Paid on Purchases", dollars(900)],
    ]);
    expect(bs.nonCurrentAssets.lines.map((l) => [l.name, l.amountCents])).toEqual([["Equipment & Plant", dollars(6000)], ["Accumulated Depreciation – Equipment", dollars(-500)]]);
    expect(bs.totalAssetsCents).toBe(dollars(23100));
    expect(bs.currentLiabilities.lines.map((l) => [l.name, l.amountCents])).toEqual([["Accounts Payable", dollars(1100)], ["GST Collected on Sales", dollars(1500)]]);
    expect(bs.totalLiabilitiesCents).toBe(dollars(2600));
    expect(bs.netAssetsCents).toBe(dollars(20500));
    expect(bs.equity.lines.map((l) => [l.name, l.amountCents])).toEqual([
      ["Owner's Contributions / Share Capital", dollars(10000)], ["Owner's Drawings / Dividends", dollars(-1000)], ["Current year earnings", dollars(11500)],
    ]);
    expect(bs.equity.totalCents).toBe(dollars(20500));
    expect(bs.balanced).toBe(true);
  });

  it("splits earlier years' profit into retained earnings, and still balances", () => {
    const extra = post([{ kind: "INCOME", date: "2025-10-01", account: "4000", amount: 2200, gst: "INCLUSIVE", paid: "2025-10-01", desc: "Last year" }]);
    const both = [...lines, ...extra.lines];
    const bs = buildBalanceSheet(accounts, aggregate(both), aggregate(both.filter((l) => l.date >= fy.from && l.date <= fy.to)));
    expect(bs.equity.lines.find((l) => l.name === "Retained earnings (prior years)")!.amountCents).toBe(dollars(2000));
    expect(bs.equity.lines.find((l) => l.name === "Current year earnings")!.amountCents).toBe(dollars(11500));
    expect(bs.balanced).toBe(true);
  });

  it("a balance sheet at an earlier date only sees what had happened by then", () => {
    const asAt = D("2026-08-31");
    const upTo = lines.filter((l) => l.date <= asAt);
    const bs = buildBalanceSheet(accounts, aggregate(upTo), aggregate(upTo.filter((l) => l.date >= fy.from)));
    expect(bs.balanced).toBe(true);
    expect(bs.currentAssets.lines.find((l) => l.name === "Accounts Receivable")).toBeUndefined();  // the credit sale is 1 Sep
    expect(bs.currentAssets.lines.find((l) => l.name === "Cash at Bank")!.amountCents).toBe(dollars(10000 + 11000 - 2200 - 6600));
  });

  it("GST/BAS on an accrual basis", () => {
    const fixed = new Set(["1500", "1600"]);
    const g = buildGstReport(entries, "ACCRUAL", fy.from, fy.to, fixed);
    expect(g.g1TotalSalesCents).toBe(dollars(16500));
    expect(g.oneAGstOnSalesCents).toBe(dollars(1500));
    expect(g.g10CapitalPurchasesCents).toBe(dollars(6600));
    expect(g.g11NonCapitalPurchasesCents).toBe(dollars(3300));
    expect(g.oneBGstOnPurchasesCents).toBe(dollars(900));
    expect(g.netGstCents).toBe(dollars(600));
  });
  it("GST/BAS on a cash basis only counts what has been paid", () => {
    const g = buildGstReport(entries, "CASH", fy.from, fy.to, new Set(["1500"]));
    expect(g.g1TotalSalesCents).toBe(dollars(11000));
    expect(g.oneAGstOnSalesCents).toBe(dollars(1000));
    expect(g.oneBGstOnPurchasesCents).toBe(dollars(800));
    expect(g.netGstCents).toBe(dollars(200));
  });
  it("GST/BAS respects the period", () => {
    const q1 = buildGstReport(entries, "ACCRUAL", D("2026-07-01"), D("2026-08-31"), new Set(["1500"]));
    expect(q1.g1TotalSalesCents).toBe(dollars(11000));
    expect(q1.salesCount).toBe(1);
  });

  it("aged receivables and payables by how overdue", () => {
    const ar = buildAgedReport(entries, "INCOME", D("2026-11-15"));
    expect(ar.totalCents).toBe(dollars(5500));
    expect(ar.rows).toHaveLength(1);
    expect(ar.rows[0]).toMatchObject({ contactName: "Acme Pty Ltd", daysOverdue: 45, bucket: "days31to60" });
    const ap = buildAgedReport(entries, "EXPENSE", D("2026-10-05"));
    expect(ap.rows[0]).toMatchObject({ contactName: "Cloud Co", bucket: "current" });
    expect(ap.totalCents).toBe(dollars(1100));
    expect(buildAgedReport(entries, "INCOME", D("2026-08-31")).totalCents).toBe(0); // not yet invoiced
  });
  it("an invoice paid after the 'as at' date still counts as outstanding then", () => {
    const e: AgedEntry[] = [{ id: "x", kind: "INCOME", date: D("2026-09-01"), description: "d", totalCents: 1000, status: "PAID", paidDate: D("2026-10-20") }];
    expect(buildAgedReport(e, "INCOME", D("2026-10-01")).totalCents).toBe(1000);
    expect(buildAgedReport(e, "INCOME", D("2026-10-20")).totalCents).toBe(0);
  });
  it("ages buckets correctly at the boundaries", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, -5].map(bucketFor)).toEqual(["current", "days1to30", "days1to30", "days31to60", "days31to60", "days61to90", "days61to90", "over90", "current"]);
  });

  it("cash & bank summary", () => {
    const before = aggregate(lines.filter((l) => l.date < D("2026-09-01")));
    const period = aggregate(lines.filter((l) => l.date >= D("2026-09-01")));
    const cs = buildCashSummary(accounts, before, period);
    expect(cs.accounts).toHaveLength(1);
    expect(cs.openingCents).toBe(dollars(10000 + 11000 - 2200 - 6600));
    expect(cs.moneyInCents).toBe(0);
    expect(cs.moneyOutCents).toBe(dollars(1000));
    expect(cs.closingCents).toBe(dollars(11200));
  });

  it("monthly profit and loss, including quiet months", () => {
    const m = buildMonthly(accounts, lines, fy.from, fy.to);
    expect(m).toHaveLength(12);
    expect(m[0]!.month).toBe("2026-07");
    expect(m.find((r) => r.month === "2026-08")).toMatchObject({ incomeCents: dollars(10000), expensesCents: dollars(2000) });
    expect(m.find((r) => r.month === "2026-09")).toMatchObject({ incomeCents: dollars(5000), expensesCents: dollars(1500) });
    expect(m.find((r) => r.month === "2026-12")).toMatchObject({ incomeCents: 0, expensesCents: 0, netCents: 0 });
    expect(m.reduce((s, r) => s + r.netCents, 0)).toBe(dollars(11500));
  });

  it("general ledger with a running balance", () => {
    const bankLines = lines.filter((l) => l.accountId === "1000").map((l) => ({ date: l.date, description: l.description, debitCents: l.debitCents, creditCents: l.creditCents }));
    const gl = buildLedger({ type: "ASSET" }, 0, bankLines);
    expect(gl.rows.map((r) => r.balanceCents)).toEqual([10000, 21000, 18800, 12200, 11200].map(dollars));
    expect(gl.closingCents).toBe(dollars(11200));
    // a liability grows with credits
    const gst = buildLedger({ type: "LIABILITY" }, 0, lines.filter((l) => l.accountId === "2200").map((l) => ({ date: l.date, description: l.description, debitCents: l.debitCents, creditCents: l.creditCents })));
    expect(gst.closingCents).toBe(dollars(1500));
  });
});

describe("not registered for GST", () => {
  it("posts no GST lines and the reports still balance", () => {
    const { lines, entries } = post([{ kind: "INCOME", date: "2026-08-01", account: "4000", amount: 1100, gst: "INCLUSIVE", paid: "2026-08-01", desc: "sale" }], [], false);
    expect(lines.some((l) => l.accountId === "2200")).toBe(false);
    expect(buildTrialBalance(accounts, aggregate(lines)).balanced).toBe(true);
    expect(buildGstReport(entries, "ACCRUAL", D("2026-07-01"), D("2027-06-30"), new Set()).netGstCents).toBe(0);
  });
});

describe("date helpers", () => {
  it("Australian financial year boundaries in UTC", () => {
    const r = financialYearRangeUtc("2026-27");
    expect(r.from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2027-06-30T23:59:59.999Z");
    expect(financialYearStartYearUtc(D("2026-06-30"))).toBe(2025);
    expect(financialYearStartYearUtc(D("2026-07-01"))).toBe(2026);
    expect(monthsBetween(r.from, r.to)).toHaveLength(12);
    expect(monthsBetween(D("2026-11-15"), D("2027-02-02"))).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

import { isValidAbn, formatAbn, normaliseAbn } from "../lib/abn";
import { businessEntrySchema, businessProfileSchema, ledgerAccountSchema, manualJournalSchema, MAX_ENTRY_CENTS } from "../lib/validation";

describe("ABN", () => {
  it("accepts a valid ABN (with or without spaces) and rejects wrong ones", () => {
    expect(isValidAbn("51 824 753 556")).toBe(true);
    expect(isValidAbn("51824753556")).toBe(true);
    expect(isValidAbn("51 824 753 557")).toBe(false);
    expect(isValidAbn("1234")).toBe(false);
    expect(isValidAbn("abcdefghijk")).toBe(false);
  });
  it("formats for display", () => {
    expect(normaliseAbn("51 824 753 556")).toBe("51824753556");
    expect(formatAbn("51824753556")).toBe("51 824 753 556");
  });
});

describe("business validation", () => {
  it("profile: ABN is optional but checked, and is stored without spaces", () => {
    expect(businessProfileSchema.parse({ businessName: "Citizen Pty Ltd", abn: "51 824 753 556", gstRegistered: true }).abn).toBe("51824753556");
    expect(businessProfileSchema.parse({ businessName: "X", abn: "" }).abn).toBeNull();
    expect(businessProfileSchema.safeParse({ businessName: "X", abn: "11 111 111 111" }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ businessName: " " }).success).toBe(false);
  });

  const base = { kind: "INCOME", date: "2026-09-01", description: "Sale", accountId: "a1", amountCents: 11000 };
  it("entries: amounts are whole positive cents within the limit", () => {
    expect(businessEntrySchema.safeParse({ ...base, status: "UNPAID" }).success).toBe(true);
    expect(businessEntrySchema.safeParse({ ...base, amountCents: 0, status: "UNPAID" }).success).toBe(false);
    expect(businessEntrySchema.safeParse({ ...base, amountCents: 10.5, status: "UNPAID" }).success).toBe(false);
    expect(businessEntrySchema.safeParse({ ...base, amountCents: MAX_ENTRY_CENTS + 1, status: "UNPAID" }).success).toBe(false);
  });
  it("entries: a paid entry needs a bank account and a paid date", () => {
    expect(businessEntrySchema.safeParse({ ...base, status: "PAID" }).success).toBe(false);
    expect(businessEntrySchema.safeParse({ ...base, status: "PAID", bankAccountId: "b1", paidDate: "2026-09-01" }).success).toBe(true);
  });
  it("accounts: the group has to fit the type", () => {
    expect(ledgerAccountSchema.safeParse({ code: "6200", name: "Pest control", type: "EXPENSE", group: "OPERATING_EXPENSE" }).success).toBe(true);
    expect(ledgerAccountSchema.safeParse({ code: "6200", name: "Pest control", type: "EXPENSE", group: "REVENUE" }).success).toBe(false);
    expect(ledgerAccountSchema.safeParse({ code: "bad code!", name: "X", type: "ASSET", group: "CURRENT_ASSET" }).success).toBe(false);
  });
  it("manual journals need two or more lines", () => {
    expect(manualJournalSchema.safeParse({ date: "2026-09-01", description: "x", lines: [{ accountId: "a", debitCents: 5, creditCents: 0 }] }).success).toBe(false);
    expect(manualJournalSchema.safeParse({ date: "2026-09-01", description: "x", lines: [{ accountId: "a", debitCents: 5, creditCents: 0 }, { accountId: "b", debitCents: 0, creditCents: 5 }] }).success).toBe(true);
  });
});
