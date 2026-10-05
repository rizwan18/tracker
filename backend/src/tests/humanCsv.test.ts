import { describe, it, expect } from "vitest";
import { toCsv } from "../lib/csv";
import { closestNames, formatDate, formatMoney, notFoundMessage, parseDate, parseDirection, parseMoney, parseRepeats } from "../services/dataTransfer/humanCsv/format";
import { readTable } from "../services/dataTransfer/humanCsv/table";
import { PERSONAL_READ_COLUMNS, personalKey, planPersonal, renderPersonalCsv, renderPersonalTemplate, type PersonalContext } from "../services/dataTransfer/humanCsv/personal";
import { BUSINESS_COLUMNS, businessKey, planBusiness, renderBusinessCsv, renderBusinessTemplate, type BusinessContext, type LedgerAccountRow } from "../services/dataTransfer/humanCsv/business";
import { journalsForEntry } from "../services/business/posting";
import { entryData } from "../services/business/entryData";
import { businessEntrySchema } from "../lib/validation";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("dates are Australian (day/month/year) and never guessed", () => {
  it("writes day/month/year", () => expect(formatDate(d("2026-10-05"))).toBe("05/10/2026"));
  it("reads what people and Excel produce", () => {
    for (const s of ["5/10/2026", "05/10/2026", "5-10-2026", "05.10.2026", "5/10/26", "2026-10-05", "2026-10-05T00:00:00.000Z", "5 Oct 2026", "5-Oct-2026", "05 October 2026"]) {
      expect(parseDate(s)?.toISOString(), s).toBe("2026-10-05T00:00:00.000Z");
    }
  });
  it("never reads a US-style date: 10/25/2026 is refused, not turned into 10 Oct", () => {
    expect(parseDate("10/25/2026")).toBeNull();
    expect(parseDate("03/04/2026")?.toISOString()).toBe("2026-04-03T00:00:00.000Z"); // 3 April, always
  });
  it("refuses dates that don't exist", () => {
    for (const s of ["32/09/2026", "31/04/2026", "29/02/2027", "0/1/2026", "hello", "", "1/1/1800"]) expect(parseDate(s), s).toBeNull();
    expect(parseDate("29/02/2028")).not.toBeNull(); // a real leap day
  });
});

describe("money is a plain number", () => {
  it("writes two decimals, no $ or thousands separators", () => expect(formatMoney(450000)).toBe("4500.00"));
  it("reads common forms", () => {
    expect(parseMoney("85.40")).toBe(8540);
    expect(parseMoney("$4,500.00")).toBe(450000);
    expect(parseMoney("4500")).toBe(450000);
    expect(parseMoney("AUD 12.5")).toBe(1250);
    expect(parseMoney("0.29")).toBe(29);
    expect(parseMoney(" 1,234,567.89 ")).toBe(123456789);
    expect(parseMoney("-85.40")).toBe(-8540);
    expect(parseMoney("(85.40)")).toBe(-8540);
  });
  it("refuses what it can't be sure of", () => {
    for (const s of ["abc", "", "1,5", "12.345", "1.2.3", "$", "12 000", "1e3", "NaN"]) expect(parseMoney(s), s).toBeNull();
  });
});

describe("words", () => {
  it("types", () => {
    expect(parseDirection("Income")).toBe("INCOME");
    expect(parseDirection(" sale ")).toBe("INCOME");
    expect(parseDirection("EXPENSE")).toBe("EXPENSE");
    expect(parseDirection("Bill")).toBe("EXPENSE");
    expect(parseDirection("transfer")).toBeNull();
  });
  it("repeats", () => {
    expect(parseRepeats("")).toEqual({ repeats: false });
    expect(parseRepeats("No")).toEqual({ repeats: false });
    expect(parseRepeats("Monthly")).toEqual({ repeats: true, frequency: "MONTHLY" });
    expect(parseRepeats("Half-yearly")).toEqual({ repeats: true, frequency: "HALF_YEARLY" });
    expect(parseRepeats("yearly")).toEqual({ repeats: true, frequency: "ANNUALLY" });
    expect(parseRepeats("sometimes")).toBe("unknown");
  });
  it("suggests the closest names", () => {
    expect(closestNames("Grocries", ["Groceries", "Rent", "Utilities"])).toEqual(["Groceries"]);
    expect(closestNames("zzz", ["Groceries", "Rent"])).toEqual([]);
    expect(notFoundMessage("Category", "Grocries", ["Groceries", "Rent"])).toBe("Category “Grocries” could not be found. Did you mean Groceries?");
    expect(notFoundMessage("Account", "Nope", ["CBA Everyday", "Visa"])).toBe("Account “Nope” could not be found. Your account names are: CBA Everyday, Visa.");
  });
});

describe("reading the file", () => {
  const spec = PERSONAL_READ_COLUMNS;
  it("understands headings however they're typed, and ignores extra columns (telling you)", () => {
    const t = readTable(toCsv([["DATE", "details", "Amount ", "type", "My Own Column"], ["5/10/2026", "Coffee", "4.50", "expense", "x"]]), spec, "x");
    expect(t.rows[0]!.cells).toMatchObject({ date: "5/10/2026", description: "Coffee", amount: "4.50", type: "expense" });
    expect(t.ignoredColumns).toEqual(["My Own Column"]);
  });
  it("row numbers match Excel (heading = row 1), skipping blank lines but counting them", () => {
    const t = readTable("Date,Description,Amount,Type\r\n5/10/2026,A,1,Expense\r\n\r\n,,,\r\n6/10/2026,B,2,Expense\r\n", spec, "x");
    expect(t.rows.map((r) => r.rowNumber)).toEqual([2, 5]);
  });
  it("handles a UTF-8 BOM, commas, quotes and line breaks inside cells, and Excel's trailing commas", () => {
    const t = readTable("\uFEFFDate,Description,Amount,Type,,\r\n5/10/2026,\"Smith, J \"\"Jr\"\"\nline two\",4.50,Expense,,\r\n", spec, "x");
    expect(t.rows[0]!.cells.description).toBe('Smith, J "Jr"\nline two');
  });
  it("says plainly when a needed column is missing", () => {
    expect(() => readTable("Date,Description,Type\r\n1/1/2026,A,Expense\r\n", spec, "x")).toThrow(/missing the “Amount” column.*Download the template/);
    expect(() => readTable("Description\r\nA\r\n", spec, "x")).toThrow(/missing the “Date”, “Amount”, “Type” columns/);
  });
  it("recognises the technical backup file and points to Restore", () => {
    expect(() => readTable("Revenue Expense Tracker export,1\r\nExported at,2026\r\n", spec, "x")).toThrow(/full backup file.*Restore from a backup/);
    expect(() => readTable("[transactions]\r\nid,date\r\n", spec, "x")).toThrow(/full backup file/);
  });
  it("an empty file, or headings with no rows, is explained", () => {
    expect(() => readTable("", spec, "x")).toThrow(/empty/);
    expect(() => readTable("Date,Description,Amount,Type\r\n", spec, "x")).toThrow(/no transactions/);
  });
  it("limits one import to 2,000 rows", () => {
    const rows = Array.from({ length: 2001 }, () => "1/1/2026,A,1,Expense").join("\r\n");
    expect(() => readTable(`Date,Description,Amount,Type\r\n${rows}\r\n`, spec, "x")).toThrow(/2,001 rows.*up to 2,000/);
  });
});

// ============================================================== Personal
const personalCtx = (over: Partial<PersonalContext> = {}): PersonalContext => ({
  categories: [
    { id: "c-groc", name: "Groceries", direction: "EXPENSE" },
    { id: "c-util", name: "Utilities", direction: "EXPENSE" },
    { id: "c-sal", name: "Salary", direction: "INCOME" },
  ],
  accounts: [{ id: "a-cba", name: "CBA Everyday" }, { id: "a-visa", name: "Visa Credit Card" }],
  properties: [],
  investments: [],
  existing: new Map(),
  ...over,
});
const plan = (rows: string[][], ctx = personalCtx(), header = ["Date", "Description", "Amount", "Type", "Category", "Account", "Notes"]) =>
  planPersonal(readTable(toCsv([header, ...rows]), PERSONAL_READ_COLUMNS, "x"), ctx).rows;

describe("Personal: export reads like a spreadsheet, not a database", () => {
  const data = {
    transactions: [
      { date: d("2026-10-01"), description: "Woolworths", amount: 85.4, direction: "EXPENSE", categoryId: "c-groc", accountId: "a-cba", propertyId: null, investmentId: null, notes: "Weekly shopping", isRecurring: false, recurrenceFrequency: null },
      { date: d("2026-10-02"), description: "Salary", amount: 4500, direction: "INCOME", categoryId: "c-sal", accountId: "a-cba", propertyId: null, investmentId: null, notes: null, isRecurring: true, recurrenceFrequency: "FORTNIGHTLY" },
    ],
    categories: [{ id: "c-groc", name: "Groceries" }, { id: "c-sal", name: "Salary" }],
    accounts: [{ id: "a-cba", name: "CBA Everyday" }],
    properties: [],
    investments: [],
  };
  const csv = renderPersonalCsv(data);
  it("uses plain headings and no technical columns", () => {
    const header = csv.split("\r\n")[0]!;
    expect(header).toBe("Date,Description,Amount,Type,Category,Account,Repeats,Notes");
    expect(header).not.toMatch(/_id|\bid\b|direction|is_recurring|financial_year/i);
  });
  it("writes names, Australian dates and plain amounts — no IDs", () => {
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("01/10/2026,Woolworths,85.40,Expense,Groceries,CBA Everyday,,Weekly shopping");
    expect(lines[2]).toBe("02/10/2026,Salary,4500.00,Income,Salary,CBA Everyday,Fortnightly,");
    expect(csv).not.toMatch(/c-groc|a-cba|T00:00:00|true|false/);
  });
  it("Property / Investment columns only appear when there are some", () => {
    const withProp = renderPersonalCsv({ ...data, properties: [{ id: "p1", name: "12 Smith St" }] });
    expect(withProp.split("\r\n")[0]).toBe("Date,Description,Amount,Type,Category,Account,Property,Repeats,Notes");
  });
  it("protects text that would run as a spreadsheet formula, and gets it back on import", () => {
    const evil = renderPersonalCsv({ ...data, transactions: [{ ...data.transactions[0]!, description: "=HYPERLINK(\"http://x\")" }] });
    expect(evil).toContain("'=HYPERLINK");
    const rows = plan(evil.split("\r\n").slice(1, 2).map((l) => l.split(",")), personalCtx(), ["Date", "Description", "Amount", "Type", "Category", "Account", "Repeats", "Notes"]);
    expect(rows.length).toBe(1);
  });
  it("round trip: export → read back → every row is ready and identical", () => {
    const rows = planPersonal(readTable(csv, PERSONAL_READ_COLUMNS, "x"), personalCtx()).rows;
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[0]!.record).toMatchObject({ description: "Woolworths", amountCents: 8540, direction: "EXPENSE", categoryId: "c-groc", accountId: "a-cba", notes: "Weekly shopping", isRecurring: false });
    expect(rows[1]!.record).toMatchObject({ direction: "INCOME", isRecurring: true, recurrenceFrequency: "FORTNIGHTLY", amountCents: 450000 });
    expect(rows[1]!.record!.date.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });
  it("a hand-edited, Excel-saved version still imports (unpadded dates, $ and thousands separators, odd capitals)", () => {
    const rows = plan([["1/10/2026", "Woolworths", "$85.40", "EXPENSE", "groceries", "cba everyday", ""], ["2/10/26", "Salary", "$4,500.00", "income", "SALARY", "", ""]]);
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[1]!.record).toMatchObject({ amountCents: 450000, categoryId: "c-sal", accountId: null });
  });
});

describe("Personal: validation says what to fix, in plain English", () => {
  const msg = (row: string[], ctx = personalCtx()) => plan([row], ctx)[0]!.messages.filter((m) => m.level === "error").map((m) => m.text);
  it("an invalid date", () => expect(msg(["32/09/2026", "x", "5", "Expense", "", "", ""])).toEqual(["Date “32/09/2026” is not valid. Please use day/month/year, like 25/10/2026."]));
  it("a missing date / description / type / amount", () => {
    expect(msg(["", "", "", "", "", "", "just a note"])).toEqual(["Please enter a Date.", "Please enter a Description.", "Please enter the Type (Income or Expense).", "Please enter an Amount."]);
  });
  it("an unknown category, with a suggestion", () => expect(msg(["1/10/2026", "x", "5", "Expense", "Grocries", "", ""])).toEqual(["Category “Grocries” could not be found. Did you mean Groceries?"]));
  it("an unknown account, listing the real ones", () => expect(msg(["1/10/2026", "x", "5", "Expense", "", "Nowhere Bank", ""])).toEqual(["Account “Nowhere Bank” could not be found. Your account names are: CBA Everyday, Visa Credit Card."]));
  it("an income category used on an expense", () => expect(msg(["1/10/2026", "x", "5", "Expense", "Salary", "", ""])[0]).toMatch(/Category “Salary” is an income category, so it can't be used for an Expense row/));
  it("a bad amount", () => {
    expect(msg(["1/10/2026", "x", "abc", "Expense", "", "", ""])).toEqual(["Amount “abc” is not a valid number. Use a plain number like 85.40."]);
    expect(msg(["1/10/2026", "x", "-5", "Expense", "", "", ""])[0]).toMatch(/positive number — use the Type column/);
    expect(msg(["1/10/2026", "x", "0", "Expense", "", "", ""])).toEqual(["The Amount must be more than zero."]);
  });
  it("an unknown type", () => expect(msg(["1/10/2026", "x", "5", "Transfer", "", "", ""])).toEqual(["Type “Transfer” isn't recognised. Please use Income or Expense."]));
  it("reports every problem in a row at once, and no technical wording", () => {
    const all = msg(["99/99/2026", "x", "abc", "Nope", "Zzz", "Qqq", ""]);
    expect(all.length).toBe(5);
    for (const m of all) expect(m).not.toMatch(/_id|invalid_|undefined|null|required$/i);
  });
  it("one bad row doesn't stop the others", () => {
    const rows = plan([["1/10/2026", "Good", "5", "Expense", "", "", ""], ["bad", "Bad", "5", "Expense", "", "", ""], ["3/10/2026", "Good 2", "6", "Expense", "", "", ""]]);
    expect(rows.map((r) => [r.rowNumber, r.status])).toEqual([[2, "ready"], [3, "error"], [4, "ready"]]);
  });
  it("a Repeats value that isn't a frequency", () => {
    const r = plan([["1/10/2026", "Rent", "500", "Expense", "", "", "Sometimes"]], personalCtx(), ["Date", "Description", "Amount", "Type", "Category", "Account", "Repeats"])[0]!;
    expect(r.messages[0]!.text).toBe("Repeats “Sometimes” isn't recognised. Please use Weekly, Fortnightly, Monthly, Quarterly, Half-yearly, Yearly, Custom — or leave it blank if it doesn't repeat.");
    const ok = plan([["1/10/2026", "Rent", "500", "Expense", "", "", "Monthly"]], personalCtx(), ["Date", "Description", "Amount", "Type", "Category", "Account", "Repeats"])[0]!;
    expect(ok.record).toMatchObject({ isRecurring: true, recurrenceFrequency: "MONTHLY" });
  });
  it("example rows from the template are not imported by accident", () => {
    const tpl = renderPersonalTemplate({ categories: personalCtx().categories, accounts: personalCtx().accounts, properties: [], investments: [] }, d("2026-10-05"));
    const rows = planPersonal(readTable(tpl, PERSONAL_READ_COLUMNS, "x"), personalCtx()).rows;
    expect(rows.every((r) => r.status === "error")).toBe(true);
    expect(rows[0]!.messages[0]!.text).toMatch(/example row from the template/);
  });
});

describe("Personal: duplicates", () => {
  const key = (date: string, dir: string, cents: number, desc: string) => personalKey(d(date), dir, cents, desc);
  it("flags a row matching something you already have (ignoring case and spacing), but not different ones", () => {
    const ctx = personalCtx({ existing: new Map([[key("2026-10-01", "EXPENSE", 8540, "woolworths"), 1]]) });
    const rows = plan([["1/10/2026", "  WOOLWORTHS ", "85.40", "Expense", "", "", ""], ["1/10/2026", "Woolworths", "85.41", "Expense", "", "", ""], ["2/10/2026", "Woolworths", "85.40", "Expense", "", "", ""]], ctx);
    expect(rows.map((r) => r.status)).toEqual(["duplicate", "ready", "ready"]);
    expect(rows[0]!.messages[0]!.text).toMatch(/already have this transaction/);
  });
  it("counts: two coffees in the file and one already saved → one duplicate, one new", () => {
    const ctx = personalCtx({ existing: new Map([[key("2026-10-01", "EXPENSE", 450, "coffee"), 1]]) });
    const rows = plan([["1/10/2026", "Coffee", "4.50", "Expense", "", "", ""], ["1/10/2026", "Coffee", "4.50", "Expense", "", "", ""]], ctx);
    expect(rows.map((r) => r.status)).toEqual(["duplicate", "ready"]);
  });
  it("re-importing a whole export finds everything already there", () => {
    const ctx = personalCtx({ existing: new Map([[key("2026-10-01", "EXPENSE", 8540, "woolworths"), 1], [key("2026-10-02", "INCOME", 450000, "salary"), 1]]) });
    expect(plan([["01/10/2026", "Woolworths", "85.40", "Expense", "", "", ""], ["02/10/2026", "Salary", "4500.00", "Income", "", "", ""]], ctx).map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
  });
  it("identical rows inside one file are imported, with a heads-up (they may be genuine)", () => {
    const rows = plan([["1/10/2026", "Coffee", "4.50", "Expense", "", "", ""], ["1/10/2026", "Coffee", "4.50", "Expense", "", "", ""]]);
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[1]!.messages[0]).toMatchObject({ level: "warning" });
    expect(rows[1]!.messages[0]!.text).toMatch(/identical to row 2/);
  });
});

// ============================================================== Business
const acc = (id: string, code: string, name: string, type: string, over: Partial<LedgerAccountRow> = {}): LedgerAccountRow => ({ id, code, name, type, systemKey: null, isBank: false, isActive: true, ...over });
const chart: LedgerAccountRow[] = [
  acc("l-bank", "1000", "Business Bank Account", "ASSET", { isBank: true }),
  acc("l-card", "1010", "Business Credit Card", "LIABILITY", { isBank: true }),
  acc("l-ar", "1100", "Accounts Receivable", "ASSET", { systemKey: "ACCOUNTS_RECEIVABLE" }),
  acc("l-ap", "2000", "Accounts Payable", "LIABILITY", { systemKey: "ACCOUNTS_PAYABLE" }),
  acc("l-gstc", "2100", "GST Collected", "LIABILITY", { systemKey: "GST_COLLECTED" }),
  acc("l-gstp", "1200", "GST Paid", "ASSET", { systemKey: "GST_PAID" }),
  acc("l-sales", "4000", "Sales", "INCOME"),
  acc("l-office", "6100", "Office Expenses", "EXPENSE"),
  acc("l-ad", "6200", "Advertising", "EXPENSE"),
  acc("l-equip", "1500", "Equipment", "ASSET"),
  acc("l-old", "6999", "Old Expenses", "EXPENSE", { isActive: false }),
];
const bctx = (over: Partial<BusinessContext> = {}): BusinessContext => ({ gstRegistered: true, accounts: chart, existing: new Map(), ...over });
const BH = ["Date", "Type", "Description", "Customer / Supplier", "Invoice Number", "Category", "Amount (incl. GST)", "GST Amount", "Status", "Date Paid", "Paid From", "Due Date", "Notes"];
const bplan = (rows: string[][], ctx = bctx(), header = BH) => planBusiness(readTable(toCsv([header, ...rows]), BUSINESS_COLUMNS, "x"), ctx).rows;
const expenseRow = (over: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = { Date: "5/10/2026", Type: "Expense", Description: "Printer paper", "Customer / Supplier": "Officeworks", "Invoice Number": "INV-1", Category: "Office Expenses", "Amount (incl. GST)": "110.00", "GST Amount": "10.00", Status: "Paid", "Date Paid": "5/10/2026", "Paid From": "Business Bank Account", "Due Date": "", Notes: "", ...over };
  return BH.map((h) => base[h] ?? "");
};
const berrors = (row: string[], ctx = bctx()) => bplan([row], ctx)[0]!.messages.filter((m) => m.level === "error").map((m) => m.text);

describe("Business: export is readable and shows GST clearly", () => {
  const csv = renderBusinessCsv({
    entries: [
      { kind: "EXPENSE", date: d("2026-10-05"), dueDate: null, description: "Printer paper", contactName: "Officeworks", reference: "INV-1", accountId: "l-office", totalCents: 11000, gstCents: 1000, status: "PAID", paidDate: d("2026-10-05"), bankAccountId: "l-bank", notes: null },
      { kind: "INCOME", date: d("2026-10-06"), dueDate: d("2026-10-20"), description: "Website design", contactName: "Acme", reference: "1001", accountId: "l-sales", totalCents: 110000, gstCents: 10000, status: "UNPAID", paidDate: null, bankAccountId: null, notes: "Deposit" },
    ],
    accounts: chart,
  });
  it("has plain headings and no IDs", () => {
    expect(csv.split("\r\n")[0]).toBe(BH.join(","));
    expect(csv).not.toMatch(/l-office|l-bank|_id|T00:00/);
  });
  it("shows the total and the GST part as plain numbers", () => {
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("05/10/2026,Expense,Printer paper,Officeworks,INV-1,Office Expenses,110.00,10.00,Paid,05/10/2026,Business Bank Account,,");
    expect(lines[2]).toBe("06/10/2026,Income,Website design,Acme,1001,Sales,1100.00,100.00,Unpaid,,,20/10/2026,Deposit");
  });
  it("round trip: every row reads back ready and produces the same stored amounts", () => {
    const rows = planBusiness(readTable(csv, BUSINESS_COLUMNS, "x"), bctx()).rows;
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[0]!.record!.data).toMatchObject({ kind: "EXPENSE", totalCents: 11000, gstCents: 1000, accountId: "l-office", bankAccountId: "l-bank", status: "PAID", contactName: "Officeworks", reference: "INV-1" });
    expect(rows[1]!.record!.data).toMatchObject({ kind: "INCOME", totalCents: 110000, gstCents: 10000, status: "UNPAID", bankAccountId: null, paidDate: null });
    expect(rows[1]!.record!.data.dueDate!.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });
  it("the template has the same headings plus two example rows that won't import by accident", () => {
    const tpl = renderBusinessTemplate({ accounts: chart, gstRegistered: true }, d("2026-10-05"));
    expect(tpl.split("\r\n")[0]).toBe(BH.join(","));
    const rows = planBusiness(readTable(tpl, BUSINESS_COLUMNS, "x"), bctx()).rows;
    expect(rows.every((r) => r.status === "error" && r.messages[0]!.text.includes("example row"))).toBe(true);
    // …and without the example marker they are valid, so the template really is a working example
    const cleaned = tpl.replaceAll("Example row - delete before importing", "");
    expect(planBusiness(readTable(cleaned, BUSINESS_COLUMNS, "x"), bctx()).rows.map((r) => r.status)).toEqual(["ready", "ready"]);
  });
});

describe("Business: GST", () => {
  it("stores the GST exactly as entered, with the amount as the total (so BAS sees what's on the tax invoice)", () => {
    const rec = bplan([expenseRow({ "Amount (incl. GST)": "110.00", "GST Amount": "10.00" })])[0]!.record!.data;
    expect(rec).toMatchObject({ totalCents: 11000, gstCents: 1000, gstMode: "MANUAL" });
  });
  it("accepts unusual GST that isn't 1/11 (e.g. part GST-free invoices)", () => {
    expect(bplan([expenseRow({ "Amount (incl. GST)": "150.00", "GST Amount": "7.27" })])[0]!.record!.data).toMatchObject({ totalCents: 15000, gstCents: 727 });
  });
  it("0 or blank means no GST — blank gets a gentle warning for a GST-registered business", () => {
    const zero = bplan([expenseRow({ "GST Amount": "0" })])[0]!;
    expect(zero.record!.data.gstCents).toBe(0);
    expect(zero.messages).toEqual([]);
    const blank = bplan([expenseRow({ "GST Amount": "" })])[0]!;
    expect(blank.status).toBe("ready");
    expect(blank.messages[0]).toMatchObject({ level: "warning" });
    expect(blank.messages[0]!.text).toMatch(/GST Amount is blank/);
  });
  it("can't be negative or more than the amount", () => {
    expect(berrors(expenseRow({ "GST Amount": "-1" }))).toEqual(["The GST Amount can't be negative."]);
    expect(berrors(expenseRow({ "GST Amount": "111" }))).toEqual(["The GST Amount can't be more than the Amount."]);
    expect(berrors(expenseRow({ "GST Amount": "ten" }))[0]).toMatch(/GST Amount “ten” is not a valid number/);
  });
  it("a business that isn't registered for GST never records any (warned, not an error)", () => {
    const r = bplan([expenseRow()], bctx({ gstRegistered: false }))[0]!;
    expect(r.record!.data).toMatchObject({ gstCents: 0, gstMode: "FREE", totalCents: 11000 });
    expect(r.messages[0]!.text).toMatch(/isn't registered for GST/);
  });
  it("produces exactly the stored record the entry form would — and balanced ledger postings with GST split out", () => {
    const parsed = businessEntrySchema.parse({ kind: "EXPENSE", date: d("2026-10-05"), description: "Printer paper", accountId: "l-office", amountCents: 11000, gstMode: "MANUAL", gstCents: 1000, status: "PAID", paidDate: d("2026-10-05"), bankAccountId: "l-bank" });
    const viaForm = entryData(parsed, true);
    const viaImport = bplan([expenseRow({ "Customer / Supplier": "", "Invoice Number": "" })])[0]!.record!.data;
    expect(viaImport).toEqual(viaForm);

    const posting = { receivable: "l-ar", payable: "l-ap", gstCollected: "l-gstc", gstPaid: "l-gstp" };
    const drafts = journalsForEntry({ kind: "EXPENSE", date: viaImport.date, description: viaImport.description, reference: viaImport.reference, accountId: viaImport.accountId, totalCents: viaImport.totalCents, gstCents: viaImport.gstCents, status: "PAID", paidDate: viaImport.paidDate, bankAccountId: viaImport.bankAccountId }, posting);
    const lines = drafts.flatMap((x) => x.lines);
    expect(lines.reduce((s, l) => s + l.debitCents, 0)).toBe(lines.reduce((s, l) => s + l.creditCents, 0));
    expect(lines.find((l) => l.accountId === "l-gstp")).toMatchObject({ debitCents: 1000 }); // GST Paid, claimable on the BAS
    expect(lines.find((l) => l.accountId === "l-office")).toMatchObject({ debitCents: 10000 });
  });
});

describe("Business: validation in plain English", () => {
  it("category not found, with a suggestion", () => expect(berrors(expenseRow({ Category: "Advertisng" }))).toEqual(["Category “Advertisng” could not be found. Did you mean Advertising?"]));
  it("accepts a category by its code too, but not an inactive one", () => {
    expect(bplan([expenseRow({ Category: "6200" })])[0]!.record!.data.accountId).toBe("l-ad");
    expect(berrors(expenseRow({ Category: "Old Expenses" }))[0]).toMatch(/could not be found/);
  });
  it("an income category on an expense (and the reverse)", () => {
    expect(berrors(expenseRow({ Category: "Sales" }))[0]).toMatch(/Category “Sales” can't be used for an Expense row/);
    expect(berrors(expenseRow({ Type: "Income", Category: "Office Expenses" }))[0]).toMatch(/can't be used for an Income row — a sale needs an income category/);
  });
  it("an asset such as Equipment is allowed for an expense (as on the form)", () => expect(bplan([expenseRow({ Category: "Equipment" })])[0]!.status).toBe("ready"));
  it("Paid needs a bank account; the message lists the real ones", () => {
    expect(berrors(expenseRow({ "Paid From": "" }))).toEqual(["Please enter Paid From — the bank account it was paid from. Your bank accounts are: Business Bank Account, Business Credit Card."]);
    expect(berrors(expenseRow({ "Paid From": "Westpac" }))[0]).toMatch(/Paid From “Westpac” could not be found/);
    expect(berrors(expenseRow({ "Paid From": "Accounts Receivable" }))[0]).toMatch(/could not be found/); // not a bank account
  });
  it("Date Paid defaults to the Date (with a note), and must be a real date", () => {
    const r = bplan([expenseRow({ "Date Paid": "" })])[0]!;
    expect(r.status).toBe("ready");
    expect(r.messages[0]!.text).toBe("Date Paid is blank, so the Date was used.");
    expect(berrors(expenseRow({ "Date Paid": "31/02/2026" }))[0]).toMatch(/Date Paid “31\/02\/2026” is not valid/);
  });
  it("Unpaid needs no bank account; payment details given anyway are ignored, with a note", () => {
    const ok = bplan([expenseRow({ Status: "Unpaid", "Date Paid": "", "Paid From": "", "Due Date": "20/10/2026" })])[0]!;
    expect(ok.status).toBe("ready");
    expect(ok.record!.data).toMatchObject({ status: "UNPAID", bankAccountId: null, paidDate: null });
    const ignored = bplan([expenseRow({ Status: "Unpaid" })])[0]!;
    expect(ignored.record!.data).toMatchObject({ status: "UNPAID", bankAccountId: null });
    expect(ignored.messages[0]!.text).toMatch(/ignored because the Status is Unpaid/);
  });
  it("a blank Status is an error unless a bank account makes it clearly Paid", () => {
    expect(berrors(expenseRow({ Status: "", "Paid From": "" , "Date Paid": ""}))).toEqual(["Please enter the Status (Paid or Unpaid)."]);
    expect(bplan([expenseRow({ Status: "" })])[0]!.record!.data.status).toBe("PAID");
    expect(berrors(expenseRow({ Status: "maybe" }))).toEqual(["Status “maybe” isn't recognised. Please use Paid or Unpaid."]);
  });
  it("amount rules and required fields", () => {
    expect(berrors(expenseRow({ "Amount (incl. GST)": "" }))).toEqual(["Please enter the Amount (including GST)."]);
    expect(berrors(expenseRow({ "Amount (incl. GST)": "0", "GST Amount": "" }))).toEqual(["The Amount must be more than zero."]);
    expect(berrors(expenseRow({ Description: "", Category: "" }))).toEqual(["Please enter a Description.", "Please enter a Category."]);
  });
  it("understands 'Amount' and 'GST' as headings too", () => {
    const rows = planBusiness(readTable(toCsv([["Date", "Type", "Description", "Category", "Amount", "GST", "Status", "Paid From"], ["5/10/2026", "Sale", "Job", "Sales", "$1,100.00", "100", "Paid", "Business Bank Account"]]), BUSINESS_COLUMNS, "x"), bctx()).rows;
    expect(rows[0]!.status).toBe("ready");
    expect(rows[0]!.record!.data).toMatchObject({ kind: "INCOME", totalCents: 110000, gstCents: 10000 });
  });
  it("duplicates use date, type, total, description and invoice number", () => {
    const k = businessKey(d("2026-10-05"), "EXPENSE", 11000, "printer paper", "inv-1");
    const dup = bplan([expenseRow()], bctx({ existing: new Map([[k, 1]]) }))[0]!;
    expect(dup.status).toBe("duplicate");
    expect(dup.messages.at(-1)!.text).toMatch(/already have this entry/);
    expect(bplan([expenseRow({ "Invoice Number": "INV-2" })], bctx({ existing: new Map([[k, 1]]) }))[0]!.status).toBe("ready"); // different invoice → different entry
  });
});
