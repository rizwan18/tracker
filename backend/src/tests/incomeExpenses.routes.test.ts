/**
 * The simple income & expenses CSV end to end: the real routes against an in-memory stand-in for the database.
 * Personal households (h1, h2) and company households (b1 = GST registered, b2 = not).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { transactions: [] as Row[], entries: [] as Row[], journals: [] as Row[], lines: [] as Row[], reminders: [] as Row[], writes: 0 };
  const types: Record<string, string> = { h1: "PERSONAL", h2: "PERSONAL", b1: "COMPANY", b2: "COMPANY" };
  const personal = (hid: string) => ({
    categories: [
      { id: `${hid}-groc`, name: "Groceries", direction: "EXPENSE", householdId: hid },
      { id: `${hid}-sal`, name: "Salary", direction: "INCOME", householdId: hid },
      { id: `${hid}-dent`, name: "Insurance", direction: "EXPENSE", householdId: hid },
    ],
    accounts: [{ id: `${hid}-cba`, name: "CBA Everyday", householdId: hid }],
  });
  const chart = (hid: string) => [
    { id: `${hid}-bank`, code: "1000", name: "Business Bank Account", type: "ASSET", systemKey: null, isBank: true, isActive: true, householdId: hid },
    { id: `${hid}-ar`, code: "1100", name: "Accounts Receivable", type: "ASSET", systemKey: "ACCOUNTS_RECEIVABLE", isBank: false, isActive: true, householdId: hid },
    { id: `${hid}-ap`, code: "2000", name: "Accounts Payable", type: "LIABILITY", systemKey: "ACCOUNTS_PAYABLE", isBank: false, isActive: true, householdId: hid },
    { id: `${hid}-gstc`, code: "2100", name: "GST Collected", type: "LIABILITY", systemKey: "GST_COLLECTED", isBank: false, isActive: true, householdId: hid },
    { id: `${hid}-gstp`, code: "1200", name: "GST Paid", type: "ASSET", systemKey: "GST_PAID", isBank: false, isActive: true, householdId: hid },
    { id: `${hid}-sales`, code: "4000", name: "Sales", type: "INCOME", systemKey: null, isBank: false, isActive: true, householdId: hid },
    { id: `${hid}-office`, code: "6100", name: "Office Expenses", type: "EXPENSE", systemKey: null, isBank: false, isActive: true, householdId: hid },
  ];
  const inRange = (d: Date, r?: Row) => !r || ((!r.gte || d >= r.gte) && (!r.lte || d <= r.lte));
  let seq = 0;
  const prisma: Row = {
    household: { findUniqueOrThrow: async ({ where }: Row) => ({ portfolioType: types[where.id] }) },
    category: { findMany: async ({ where }: Row) => personal(where.householdId).categories },
    account: { findMany: async ({ where }: Row) => personal(where.householdId).accounts },
    property: { findMany: async () => [] },
    investment: { findMany: async () => [] },
    transaction: {
      findMany: async ({ where }: Row) => state.transactions.filter((t) => t.householdId === where.householdId && inRange(t.date, where.date)).sort((a, b) => a.date - b.date),
      createMany: async ({ data }: Row) => { state.writes++; state.transactions.push(...data.map((r: Row) => ({ createdAt: new Date(++seq), ...r }))); return { count: data.length }; },
    },
    reminder: {
      findFirst: async ({ where }: Row) => state.reminders.find((r) => r.transactionId === where.transactionId) ?? null,
      create: async ({ data }: Row) => { state.reminders.push(data); return data; },
      update: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
    ledgerAccount: { findMany: async ({ where }: Row) => chart(where.householdId) },
    businessEntry: {
      findMany: async ({ where }: Row) => state.entries.filter((e) => e.householdId === where.householdId && inRange(e.date, where.date)).sort((a, b) => a.date - b.date),
      createMany: async ({ data }: Row) => { state.writes++; state.entries.push(...data.map((r: Row) => ({ createdAt: new Date(++seq), ...r }))); return { count: data.length }; },
    },
    journalEntry: { createMany: async ({ data }: Row) => { state.journals.push(...data); return { count: data.length }; } },
    journalLine: { createMany: async ({ data }: Row) => { state.lines.push(...data); return { count: data.length }; } },
    $transaction: async (arg: any) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg)),
  };
  return { state, prisma, chart, personal };
});

vi.mock("../lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = "u1"; req.householdId = req.headers["x-test-household"] ?? "h1"; next(); },
}));
vi.mock("../services/business/ledgerStore", async (orig) => ({
  ...(await orig<typeof import("../services/business/ledgerStore")>()),
  ensureBusinessSetup: async (hid: string) => ({ gstRegistered: hid !== "b2" }),
  postingAccounts: async (hid: string) => ({ receivable: `${hid}-ar`, payable: `${hid}-ap`, gstCollected: `${hid}-gstc`, gstPaid: `${hid}-gstp` }),
}));

import { createApp } from "../app";
import { toCsv } from "../lib/csv";

let server: Server;
let base = "";
beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/data/income-expenses`;
});
afterAll(() => { server.close(); });
beforeEach(() => { Object.assign(h.state, { transactions: [], entries: [], journals: [], lines: [], reminders: [], writes: 0 }); });

const get = async (path: string, hid: string) => {
  const res = await fetch(`${base}${path}`, { headers: { "x-test-household": hid } });
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  return { status: res.status, headers: res.headers, text: await res.text(), startsWithBom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf };
};
const post = async (csv: string, hid: string, over: Record<string, unknown> = {}) => {
  const res = await fetch(`${base}/import`, { method: "POST", headers: { "content-type": "application/json", "x-test-household": hid }, body: JSON.stringify({ csv, dryRun: true, ...over }) });
  return { status: res.status, body: (await res.json()) as any };
};

const PH = ["Date", "Description", "Amount", "Type", "Category", "Account", "Notes"];
const personalCsv = (...rows: string[][]) => toCsv([PH, ...rows]);
const BH = ["Date", "Type", "Description", "Customer / Supplier", "Invoice Number", "Category", "Amount (incl. GST)", "GST Amount", "Status", "Date Paid", "Paid From", "Due Date", "Notes"];
const businessCsv = (...rows: string[][]) => toCsv([BH, ...rows]);
const exp = (over: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = { Date: "5/10/2026", Type: "Expense", Description: "Printer paper", "Customer / Supplier": "Officeworks", "Invoice Number": "INV-1", Category: "Office Expenses", "Amount (incl. GST)": "110.00", "GST Amount": "10.00", Status: "Paid", "Date Paid": "5/10/2026", "Paid From": "Business Bank Account", "Due Date": "", Notes: "", ...over };
  return BH.map((k) => base[k] ?? "");
};

describe("Personal Finance", () => {
  const seed = (hid: string, over: Record<string, unknown> = {}) =>
    h.state.transactions.push({ id: `t${h.state.transactions.length}`, householdId: hid, date: new Date("2026-10-01T00:00:00Z"), description: "Woolworths", amount: 85.4, direction: "EXPENSE", categoryId: `${hid}-groc`, accountId: `${hid}-cba`, propertyId: null, investmentId: null, notes: "Weekly shopping", isRecurring: false, recurrenceFrequency: null, createdAt: new Date(), ...over });

  it("exports a human-readable CSV (with a BOM for Excel) containing only this household's transactions", async () => {
    seed("h1");
    seed("h2", { description: "SECRET OTHER HOUSEHOLD" });
    const r = await get("/export", "h1");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/csv/);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="personal-income-and-expenses-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(r.startsWithBom).toBe(true);
    expect(r.text.replace("\uFEFF", "").split("\r\n").slice(0, 2)).toEqual(["Date,Description,Amount,Type,Category,Account,Repeats,Notes", "01/10/2026,Woolworths,85.40,Expense,Groceries,CBA Everyday,,Weekly shopping"]);
    expect(r.text).not.toMatch(/SECRET|h1-groc|h1-cba/);
  });

  it("offers a template with the headings and examples using this household's own category and account", async () => {
    const r = await get("/template", "h1");
    expect(r.headers.get("content-disposition")).toContain("personal-income-and-expenses-template.csv");
    const lines = r.text.replace("\uFEFF", "").split("\r\n");
    expect(lines[0]).toBe("Date,Description,Amount,Type,Category,Account,Repeats,Notes");
    expect(lines[1]).toMatch(/Weekly groceries,85.40,Expense,Groceries,CBA Everyday,,Example row - delete before importing/);
    expect(lines[2]).toMatch(/Salary,4500.00,Income,Salary,CBA Everyday/);
  });

  const file = personalCsv(
    ["1/10/2026", "Woolworths", "85.40", "Expense", "Groceries", "CBA Everyday", "Weekly shopping"],
    ["2/10/2026", "Salary", "4,500.00", "Income", "Salary", "CBA Everyday", "October salary"],
    ["32/09/2026", "Bad date", "10", "Expense", "Groceries", "", ""],
    ["3/10/2026", "Mystery", "10", "Expense", "Grocries", "", ""]
  );

  it("previews what will happen without saving anything", async () => {
    const r = await post(file, "h1");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ flavour: "PERSONAL", noun: "transaction", totals: { found: 4, ready: 2, duplicates: 0, errors: 2 }, willImport: 2, imported: null });
    expect(r.body.columns).toEqual(["Date", "Description", "Amount", "Type", "Category", "Account"]);
    const bad = r.body.rows.filter((x: any) => x.status === "error");
    expect(bad.map((x: any) => [x.rowNumber, x.messages[0].text])).toEqual([
      [4, "Date “32/09/2026” is not valid. Please use day/month/year, like 25/10/2026."],
      [5, "Category “Grocries” could not be found. Did you mean Groceries?"],
    ]);
    expect(h.state.writes).toBe(0);
    expect(h.state.transactions).toHaveLength(0);
  });

  it("imports the ready rows into this household only, filling in the financial year, and skips the rows that need attention", async () => {
    const r = await post(file, "h1", { dryRun: false });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(2);
    expect(h.state.transactions).toHaveLength(2);
    const [groc, sal] = h.state.transactions;
    expect(groc).toMatchObject({ householdId: "h1", userId: "u1", description: "Woolworths", amount: 85.4, direction: "EXPENSE", categoryId: "h1-groc", accountId: "h1-cba", financialYear: "2026-27", notes: "Weekly shopping", isRecurring: false });
    expect(sal).toMatchObject({ direction: "INCOME", amount: 4500, categoryId: "h1-sal" });
    expect(groc!.id).toBeTruthy();
    expect(h.state.transactions.some((t) => t.householdId !== "h1")).toBe(false);
  });

  it("importing into one household never touches another", async () => {
    seed("h2", { description: "Theirs" });
    await post(file, "h1", { dryRun: false });
    expect(h.state.transactions.filter((t) => t.householdId === "h2")).toHaveLength(1);
  });

  it("a second import of the same file finds everything already there and adds nothing", async () => {
    const clean = personalCsv(["1/10/2026", "Woolworths", "85.40", "Expense", "Groceries", "CBA Everyday", ""], ["2/10/2026", "Salary", "4500", "Income", "Salary", "CBA Everyday", ""]);
    await post(clean, "h1", { dryRun: false });
    const again = await post(clean, "h1");
    expect(again.body.totals).toMatchObject({ found: 2, ready: 0, duplicates: 2, errors: 0 });
    expect(again.body.willImport).toBe(0);
    const forced = await post(clean, "h1", { dryRun: false });
    expect(forced.status).toBe(400);
    expect(forced.body.error).toMatch(/nothing to import/i);
    expect(h.state.transactions).toHaveLength(2);
  });

  it("possible duplicates can be added on request", async () => {
    seed("h1");
    const dup = personalCsv(["1/10/2026", "WOOLWORTHS", "85.40", "Expense", "Groceries", "CBA Everyday", ""], ["4/10/2026", "New one", "5", "Expense", "", "", ""]);
    expect((await post(dup, "h1")).body.totals).toMatchObject({ ready: 1, duplicates: 1 });
    expect((await post(dup, "h1", { dryRun: false })).body.imported).toBe(1);
    expect(h.state.transactions).toHaveLength(2);
    expect((await post(dup, "h1", { dryRun: false, importDuplicates: true })).body.imported).toBe(2);
    expect(h.state.transactions).toHaveLength(4);
  });

  it("export → import round trip into an empty household recreates the transactions", async () => {
    seed("h1");
    seed("h1", { date: new Date("2026-10-02T00:00:00Z"), description: "Salary", amount: 4500, direction: "INCOME", categoryId: "h1-sal", notes: null, isRecurring: true, recurrenceFrequency: "FORTNIGHTLY" });
    const exported = (await get("/export", "h1")).text;
    h.state.transactions = [];
    const r = await post(exported, "h1", { dryRun: false });
    expect(r.body.imported).toBe(2);
    expect(h.state.transactions.map((t) => [t.description, t.amount, t.direction, t.isRecurring, t.recurrenceFrequency])).toEqual([["Woolworths", 85.4, "EXPENSE", false, null], ["Salary", 4500, "INCOME", true, "FORTNIGHTLY"]]);
  });

  it("future-dated expenses get a reminder, like adding them one at a time", async () => {
    const future = `15/06/${new Date().getUTCFullYear() + 2}`;
    await post(personalCsv([future, "Car registration", "800", "Expense", "", "", ""]), "h1", { dryRun: false });
    expect(h.state.reminders).toHaveLength(1);
    expect(h.state.reminders[0]).toMatchObject({ householdId: "h1" });
  });

  it("suggests the tax prompt for likely deductible categories, like the form does", async () => {
    await post(personalCsv(["1/10/2026", "Home insurance", "300", "Expense", "Insurance", "", ""]), "h1", { dryRun: false });
    const t = h.state.transactions[0]!;

    expect(t.categoryId).toBe("h1-dent");
  });

  it("explains what's wrong with files that aren't usable", async () => {
    expect((await post("Revenue Expense Tracker export,1\r\n[transactions]\r\n", "h1")).body.error).toMatch(/full backup file/);
    expect((await post("Date,Description\r\n1/1/2026,A\r\n", "h1")).body.error).toMatch(/missing the “Amount”, “Type” columns/);
    expect((await post(businessCsv(exp()), "h1")).body.error).toMatch(/missing the “Amount” column/); // a business file in a personal portfolio
    expect((await post("", "h1")).status).toBe(400);
  });
});

describe("Business Finance", () => {
  const seedEntry = (hid: string, over: Record<string, unknown> = {}) =>
    h.state.entries.push({ id: `e${h.state.entries.length}`, householdId: hid, kind: "EXPENSE", date: new Date("2026-10-05T00:00:00Z"), dueDate: null, description: "Printer paper", contactName: "Officeworks", reference: "INV-1", accountId: `${hid}-office`, totalCents: 11000, gstCents: 1000, status: "PAID", paidDate: new Date("2026-10-05T00:00:00Z"), bankAccountId: `${hid}-bank`, notes: null, createdAt: new Date(), ...over });

  it("exports sales & expenses with readable columns and GST, for this business only", async () => {
    seedEntry("b1");
    seedEntry("b2", { description: "OTHER BUSINESS" });
    const r = await get("/export", "b1");
    expect(r.headers.get("content-disposition")).toMatch(/business-sales-and-expenses-\d{4}/);
    const lines = r.text.replace("\uFEFF", "").split("\r\n");
    expect(lines[0]).toBe(BH.join(","));
    expect(lines[1]).toBe("05/10/2026,Expense,Printer paper,Officeworks,INV-1,Office Expenses,110.00,10.00,Paid,05/10/2026,Business Bank Account,,");
    expect(r.text).not.toMatch(/OTHER BUSINESS|b1-office/);
  });

  it("the template matches the headings", async () => {
    const r = await get("/template", "b1");
    expect(r.text.replace("\uFEFF", "").split("\r\n")[0]).toBe(BH.join(","));
    expect(r.headers.get("content-disposition")).toContain("business-sales-and-expenses-template.csv");
  });

  it("previews with counts, duplicates and plain-English problems", async () => {
    seedEntry("b1");
    const file = businessCsv(exp(), exp({ Description: "Stamps", "Invoice Number": "", "Amount (incl. GST)": "11.00", "GST Amount": "1.00" }), exp({ Category: "Advertisng", "Invoice Number": "INV-3" }));
    const r = await post(file, "b1");
    expect(r.body).toMatchObject({ flavour: "BUSINESS", noun: "sale or expense", totals: { found: 3, ready: 1, duplicates: 1, errors: 1 }, willImport: 1 });
    const err = r.body.rows.find((x: any) => x.status === "error");
    expect(err.messages[0].text).toMatch(/^Category “Advertisng” could not be found\./);
    expect(h.state.entries).toHaveLength(1);
  });

  it("imports through the same posting as the form: balanced ledger lines with GST split out, for this business only", async () => {
    const file = businessCsv(exp(), exp({ Type: "Income", Description: "Website design", "Customer / Supplier": "Acme", "Invoice Number": "1001", Category: "Sales", "Amount (incl. GST)": "1100.00", "GST Amount": "100.00", Status: "Unpaid", "Date Paid": "", "Paid From": "", "Due Date": "20/10/2026" }));
    const r = await post(file, "b1", { dryRun: false });
    expect(r.body.imported).toBe(2);
    expect(h.state.entries).toHaveLength(2);
    expect(h.state.entries.every((e) => e.householdId === "b1" && e.createdById === "u1")).toBe(true);
    const [bill, invoice] = h.state.entries;
    expect(bill).toMatchObject({ kind: "EXPENSE", totalCents: 11000, gstCents: 1000, gstMode: "MANUAL", status: "PAID", bankAccountId: "b1-bank", accountId: "b1-office" });
    expect(invoice).toMatchObject({ kind: "INCOME", totalCents: 110000, gstCents: 10000, status: "UNPAID", bankAccountId: null });

    // every posting belongs to one of the new entries, and the books balance
    expect(h.state.journals.length).toBeGreaterThanOrEqual(2);
    expect(h.state.journals.every((j) => j.householdId === "b1" && [bill!.id, invoice!.id].includes(j.sourceId))).toBe(true);
    const debit = h.state.lines.reduce((s, l) => s + l.debitCents, 0);
    const credit = h.state.lines.reduce((s, l) => s + l.creditCents, 0);
    expect(debit).toBe(credit);
    expect(h.state.lines.find((l) => l.accountId === "b1-gstp")).toMatchObject({ debitCents: 1000 }); // GST on the expense, claimable
    expect(h.state.lines.find((l) => l.accountId === "b1-gstc")).toMatchObject({ creditCents: 10000 }); // GST on the sale, payable
    expect(h.state.lines.find((l) => l.accountId === "b1-ar")).toMatchObject({ debitCents: 110000 }); // unpaid → receivable
    expect(h.state.lines.every((l) => h.state.journals.some((j) => j.id === l.entryId))).toBe(true);
  });

  it("a business not registered for GST never records GST", async () => {
    const r = await post(businessCsv(exp({ "Paid From": "Business Bank Account" })), "b2", { dryRun: false });
    expect(r.body.imported).toBe(1);
    expect(h.state.entries[0]).toMatchObject({ householdId: "b2", gstCents: 0, gstMode: "FREE", totalCents: 11000 });
    expect(h.state.lines.some((l) => l.accountId === "b2-gstp")).toBe(false);
  });

  it("a re-import adds nothing; the same entry from another business isn't a duplicate", async () => {
    const file = businessCsv(exp());
    await post(file, "b1", { dryRun: false });
    expect((await post(file, "b1")).body.totals).toMatchObject({ ready: 0, duplicates: 1 });
    expect((await post(file, "b2")).body.totals).toMatchObject({ ready: 1, duplicates: 0 });
  });

  it("export → import round trip recreates the entries", async () => {
    seedEntry("b1");
    seedEntry("b1", { kind: "INCOME", description: "Website design", contactName: "Acme", reference: "1001", accountId: "b1-sales", totalCents: 110000, gstCents: 10000, status: "UNPAID", paidDate: null, bankAccountId: null, dueDate: new Date("2026-10-20T00:00:00Z") });
    const exported = (await get("/export", "b1")).text;
    h.state.entries = [];
    expect((await post(exported, "b1", { dryRun: false })).body.imported).toBe(2);
    expect(h.state.entries.map((e) => [e.description, e.totalCents, e.gstCents, e.status])).toEqual([["Printer paper", 11000, 1000, "PAID"], ["Website design", 110000, 10000, "UNPAID"]]);
  });

  it("a personal file in a business portfolio gets a clear message", async () => {
    expect((await post(personalCsv(["1/10/2026", "x", "5", "Expense", "Groceries", "", ""]), "b1")).body.error).toMatch(/missing the “Category”|missing the “Status”|missing the/);
  });
});
