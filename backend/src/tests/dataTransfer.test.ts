import { describe, it, expect } from "vitest";
import { renderExportCsv, type ExportData } from "../services/dataTransfer/renderExport";
import { parseExportFile } from "../services/dataTransfer/parseExport";
import { collectCandidateIds, emptyExistence, planImport, type ImportContext } from "../services/dataTransfer/planImport";
import { parseDateCell } from "../services/dataTransfer/rowReader";

const D = (s: string) => new Date(s);
const base = { createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") };

function sampleData(): ExportData {
  return {
    profile: { fullName: "Sam Citizen", email: "sam@example.com", timezone: "Australia/Melbourne", easyViewEnabled: true, householdName: "Sam's household" },
    accounts: [{ id: "acc1", householdId: "hA", name: "Everyday", type: "BANK", ...base }],
    categories: [
      { id: "catRent", householdId: "hA", name: "Rental Income", direction: "INCOME", isCustom: false, createdAt: base.createdAt },
      { id: "catCouncil", householdId: "hA", name: "Council Rates", direction: "EXPENSE", isCustom: false, createdAt: base.createdAt },
      { id: "catCustom", householdId: "hA", name: "=Pest control", direction: "EXPENSE", isCustom: true, createdAt: base.createdAt },
    ],
    properties: [
      { id: "propInv", householdId: "hA", name: "Maple Street", address: "12 Maple St, \"Unit 3\"", propertyType: "INVESTMENT", purchaseDate: D("2013-04-21"), purchasePrice: 400000, currentEstimatedValue: 480000, loanBalance: 210000, loanInterestRate: 6.1, rentalAgent: "Ray White", tenantName: null, rentAmount: 420, rentFrequency: "WEEKLY", rentalStartDate: D("2013-05-01"), availableForRentDate: D("2013-04-21"), scheduleInitialised: true, notes: "Line one\nLine two", managerName: "Jo Agent", managerCompany: "Ray White", managerEmail: "jo@raywhite.example", managerPhone: "03 9999 0000", managerMobile: "0412 345 678", managerWebsite: "https://raywhite.com.au", managerAbn: "51824753556", managerAddress: "1 High St, Hawthorn", managerNotes: "=call first", ...base },
      { id: "propHome", householdId: "hA", name: "Family Home", address: null, propertyType: "PPR", purchaseDate: null, purchasePrice: null, currentEstimatedValue: 610000, loanBalance: 95000, loanInterestRate: null, rentalAgent: null, tenantName: null, rentAmount: null, rentFrequency: null, rentalStartDate: null, availableForRentDate: null, scheduleInitialised: false, notes: null, ...base },
    ],
    owners: [{ propertyId: "propInv", email: "sam@example.com", percentage: 60 }, { propertyId: "propHome", email: "sam@example.com", percentage: 100 }, { propertyId: "propInv", email: "partner@example.com", percentage: 40 }],
    scheduleLines: [{ id: "sl1", propertyId: "propInv", categoryId: "catCouncil", label: "Council rates", isManual: false, sortOrder: 1, createdAt: base.createdAt }],
    yearDetails: [{ id: "yd1", propertyId: "propInv", financialYear: "2026-27", weeksRented: 52, updatedAt: base.updatedAt }],
    photos: [
      { id: "ph1", propertyId: "propInv", fileName: "front.jpg", contentType: "image/jpeg", filePath: "https://x.public.blob.vercel-storage.com/front.jpg", thumbPath: "https://x.public.blob.vercel-storage.com/thumb-front.jpg", isPrimary: true, createdAt: base.createdAt },
      { id: "ph2", propertyId: "propInv", fileName: "back.jpg", contentType: "image/jpeg", filePath: "https://x.public.blob.vercel-storage.com/back.jpg", thumbPath: null, isPrimary: true, createdAt: base.createdAt },
    ],
    investments: [{ id: "inv1", householdId: "hA", name: "Vanguard VAS", ticker: "VAS", type: "ETF", notes: null, currentValueOverride: null, market: "ASX", currency: "AUD", ...base }],
    valuations: [
      { id: "iv1", investmentId: "inv1", asAt: D("2026-03-31"), units: 100, marketPrice: 95.5, marketValue: 9550, marketValueAud: 9550, currency: "AUD", source: "STAKE", createdAt: base.createdAt },
      { id: "iv2", investmentId: "inv1", asAt: D("2026-06-30"), units: 120, marketPrice: 100, marketValue: 12000, marketValueAud: 12000, currency: "AUD", source: "MANUAL", createdAt: base.createdAt },
    ],
    investmentTransactions: [{ id: "it1", investmentId: "inv1", type: "BUY", date: D("2024-02-01"), quantity: 100, pricePerUnit: 90.5, brokerage: 9.95, notes: null, ...base }],
    dividends: [{ id: "dv1", investmentId: "inv1", exDividendDate: D("2026-03-20"), paymentDate: D("2026-04-05"), grossAmount: 100, frankingCredit: 20, frankedAmount: 100, unfrankedAmount: 0, taxWithheld: 0, netAmount: 100, status: "RECEIVED", notes: null, financialYear: "2025-26", ...base }],
    disposals: [{ id: "cg1", householdId: "hA", investmentId: "inv1", purchaseDate: D("2020-01-01"), purchasePrice: 10, purchaseCosts: 1, saleDate: D("2026-01-15"), salePrice: 15, saleCosts: 1, quantity: 100, ownershipPercentage: 100, costBase: 1001, proceeds: 1499, grossGainLoss: 498, holdingPeriodDays: 2205, financialYear: "2025-26", notes: null, ...base }],
    transactions: [
      { id: "tx1", householdId: "hA", userId: "uA", date: D("2026-07-15"), description: "Rent — July", amount: 1815, direction: "INCOME", categoryId: "catRent", accountId: "acc1", propertyId: "propInv", investmentId: null, notes: null, isRecurring: true, recurrenceFrequency: "MONTHLY", potentialTaxCategory: null, financialYear: "2026-27", ...base },
      { id: "tx2", householdId: "hA", userId: "uA", date: D("2026-08-01"), description: "-Council rates, Q1 \"2026\"", amount: 620.5, direction: "EXPENSE", categoryId: "catCouncil", accountId: null, propertyId: "propInv", investmentId: null, notes: "paid", isRecurring: false, recurrenceFrequency: null, potentialTaxCategory: "Rental deduction", financialYear: "2026-27", ...base },
    ],
    bills: [{ id: "bl1", householdId: "hA", name: "Water", provider: "Yarra Valley", amount: 180, frequency: "QUARTERLY", nextDueDate: D("2026-10-01"), accountId: "acc1", categoryId: null, propertyId: "propInv", autoRenew: false, reminderDaysBefore: 7, status: "UPCOMING", notes: null, ...base }],
    reminders: [{ id: "rm1", householdId: "hA", billId: "bl1", transactionId: null, dividendId: null, title: "Water due", dueDate: D("2026-09-24"), daysBefore: 7, status: "PENDING", notes: null, ...base }],
    documents: [{ id: "doc1", householdId: "hA", fileName: "receipt.pdf", fileType: "application/pdf", filePath: "https://x.public.blob.vercel-storage.com/receipt.pdf", transactionId: "tx2", propertyId: null, investmentId: null, dividendId: null, capitalGainDisposalId: null, createdAt: base.createdAt }],
  } as unknown as ExportData;
}

function ctxFor(overrides: Partial<ImportContext> = {}): ImportContext {
  return { householdId: "hB", userId: "uB", userEmail: "sam@example.com", portfolioType: "PERSONAL", categories: [], accounts: [], ppr: null, exists: emptyExistence(), ...overrides };
}

function plan(csv: string, ctx = ctxFor(), includeProfile = true) {
  const parsed = parseExportFile(csv);
  return { parsed, plan: planImport(parsed, ctx, { includeProfile }) };
}

describe("export → import round trip", () => {
  const csv = renderExportCsv(sampleData(), D("2026-09-19T00:00:00Z"));

  it("writes a single sectioned file with a recognisable header", () => {
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Revenue Expense Tracker export,1");
    expect(csv).toContain("[transactions]");
    expect(csv).toContain("[properties]");
    // formula-looking text is protected in the file
    expect(csv).toContain("'=Pest control");
    expect(csv).toContain("'-Council rates");
  });

  it("restores everything into an empty account", () => {
    const { plan: p } = plan(csv);
    expect(p.errors).toEqual([]);
    const s = p.summary;
    expect(s.accounts.toAdd).toBe(1);
    expect(s.categories.toAdd).toBe(3);
    expect(s.properties.toAdd).toBe(2);
    expect(s.property_schedule_lines.toAdd).toBe(1);
    expect(s.property_year_details.toAdd).toBe(1);
    expect(s.investments.toAdd).toBe(1);
    expect(s.investment_transactions.toAdd).toBe(1);
    expect(s.dividends.toAdd).toBe(1);
    expect(s.capital_gain_disposals.toAdd).toBe(1);
    expect(s.transactions.toAdd).toBe(2);
    expect(s.bills.toAdd).toBe(1);
    expect(s.reminders.toAdd).toBe(1); // the bill's own reminder is in the file, so no extra one is made
    expect(s.documents.toAdd).toBe(1);
    expect(p.profile).toEqual({ fullName: "Sam Citizen", timezone: "Australia/Melbourne", easyViewEnabled: true, householdName: "Sam's household" });
  });

  it("restores share holdings: market, currency and every dated valuation", () => {
    const { plan: p } = plan(csv);
    expect(p.creates.investments.find((i) => i.name === "Vanguard VAS")).toMatchObject({ market: "ASX", currency: "AUD" });
    expect(p.summary.investment_valuations.toAdd).toBe(2);
    expect(p.creates.valuations.map((v) => [v.asAt, v.units, v.marketPrice, v.marketValueAud, v.source])).toEqual([[D("2026-03-31"), 100, 95.5, 9550, "STAKE"], [D("2026-06-30"), 120, 100, 12000, "MANUAL"]]);
    expect(p.creates.valuations.every((v) => v.investmentId === "inv1")).toBe(true);
    // a valuation for an investment that isn't in the file is skipped, not guessed
    const orphan = "Revenue Expense Tracker export,1\r\n\r\n[investment_valuations]\r\nid,investment_id,as_at,units,market_price,market_value,market_value_aud\r\nz1,nope,2026-06-30,1,1,1,1\r\n";
    expect(plan(orphan).plan.errors.join(" ")).toContain("isn't in the file");
  });

  it("restores property manager details and picture links, with a single main picture", () => {
    const { plan: p } = plan(csv);
    const maple = p.creates.properties.find((x) => x.name === "Maple Street")!;
    expect(maple).toMatchObject({ managerName: "Jo Agent", managerCompany: "Ray White", managerEmail: "jo@raywhite.example", managerPhone: "03 9999 0000", managerMobile: "0412 345 678", managerWebsite: "https://raywhite.com.au", managerAbn: "51824753556", managerAddress: "1 High St, Hawthorn", managerNotes: "=call first" });
    expect(p.summary.property_photos.toAdd).toBe(2);
    expect(p.creates.photos.map((x) => [x.fileName, x.isPrimary, x.thumbPath])).toEqual([["front.jpg", true, "https://x.public.blob.vercel-storage.com/thumb-front.jpg"], ["back.jpg", false, null]]);
    expect(p.creates.photos.every((x) => x.propertyId === "propInv" && x.contentType === "image/jpeg")).toBe(true);
  });

  it("keeps the rest of a property when its manager website or ABN is unusable, and says so", () => {
    const bad = "Revenue Expense Tracker export,1\r\n\r\n[properties]\r\nid,name,manager_name,manager_website,manager_abn,manager_mobile\r\np1,House,Jo,javascript:alert(1),123,0400 000 000\r\np2,Unit,Al,agency.com.au,51 824 753 556,\r\n";
    const { plan: q } = plan(bad);
    expect(q.errors).toEqual([]);
    const [house, unit] = q.creates.properties;
    expect(house).toMatchObject({ name: "House", managerName: "Jo", managerWebsite: null, managerAbn: null, managerMobile: "0400 000 000" });
    expect(unit).toMatchObject({ managerWebsite: "https://agency.com.au", managerAbn: "51824753556" });
    expect(q.warnings.filter((w) => w.includes("left out"))).toHaveLength(2);
  });

  it("won't import picture links that aren't https, and doesn't steal the main-picture role on an existing property", () => {
    const ctx = ctxFor();
    ctx.exists.properties.anywhere.add("propInv"); ctx.exists.properties.inHousehold.add("propInv");
    const { plan: p } = plan(csv, ctx);
    expect(p.creates.photos.every((x) => x.isPrimary === false)).toBe(true);
    const bad = "Revenue Expense Tracker export,1\r\n\r\n[properties]\r\nid,name\r\np1,House\r\n\r\n[property_photos]\r\nid,property_id,file_name,content_type,file_path\r\nx1,p1,a.jpg,image/jpeg,javascript:alert(1)\r\nx2,p1,b.svg,image/svg+xml,https://example.com/b.svg\r\n";
    const { plan: q } = plan(bad);
    expect(q.creates.photos).toHaveLength(0);
    expect(q.errors.join(" ")).toContain("https://");
    expect(q.errors.join(" ")).toContain("content_type");
  });

  it("keeps values exactly (text, numbers, dates, line breaks, quotes, formula-like text)", () => {
    const { plan: p } = plan(csv);
    const maple = p.creates.properties.find((x) => x.name === "Maple Street")!;
    expect(maple.address).toBe('12 Maple St, "Unit 3"');
    expect(maple.notes).toBe("Line one\nLine two");
    expect(maple.purchasePrice).toBe(400000);
    expect(maple.availableForRentDate).toEqual(D("2013-04-21"));
    const council = p.creates.transactions.find((x) => x.amount === 620.5)!;
    expect(council.description).toBe('-Council rates, Q1 "2026"');
    expect(council.direction).toBe("EXPENSE");
    expect(council.userId).toBe("uB");
    expect(council.householdId).toBe("hB");
    expect(council.financialYear).toBe("2026-27");
    expect(p.creates.categories.find((c) => c.name === "=Pest control")).toBeTruthy();
  });

  it("links records together (transactions → property/category/account, children → parents)", () => {
    const { plan: p } = plan(csv);
    const tx = p.creates.transactions.find((x) => x.amount === 1815)!;
    expect(tx.propertyId).toBe("propInv"); // ids are kept when free
    expect(tx.categoryId).toBe("catRent");
    expect(tx.accountId).toBe("acc1");
    expect(p.creates.investmentTransactions[0]!.investmentId).toBe("inv1");
    expect(p.creates.documents[0]!.transactionId).toBe("tx2");
    expect(p.creates.reminders[0]!.billId).toBe("bl1");
  });

  it("makes the person importing the owner, using their own share", () => {
    const { plan: p } = plan(csv);
    const owners = p.creates.propertyOwnerships;
    expect(owners).toHaveLength(2);
    expect(owners.every((o) => o.userId === "uB")).toBe(true);
    expect(owners.find((o) => o.propertyId === "propInv")!.percentage).toBe(60);
    expect(p.warnings.some((w) => w.includes("other people"))).toBe(true);
  });

  it("is idempotent: importing the same file again adds nothing", () => {
    const first = plan(csv);
    // pretend the first import has been written: every id it used now exists in this household
    const ctx = ctxFor();
    for (const [table, list] of Object.entries(collectCandidateIds(first.parsed, "hB"))) {
      void list;
      void table;
    }
    const created = first.plan.creates;
    const put = (t: keyof ImportContext["exists"], rows: Array<{ id?: string }>) => rows.forEach((r) => r.id && (ctx.exists[t].anywhere.add(r.id), ctx.exists[t].inHousehold.add(r.id)));
    put("accounts", created.accounts); put("categories", created.categories); put("properties", created.properties);
    put("property_photos", created.photos); put("property_schedule_lines", created.scheduleLines); put("property_year_details", created.yearDetails); put("investments", created.investments); put("investment_valuations", created.valuations);
    put("investment_transactions", created.investmentTransactions); put("dividends", created.dividends); put("capital_gain_disposals", created.disposals);
    put("transactions", created.transactions); put("bills", created.bills); put("reminders", created.reminders); put("documents", created.documents);
    ctx.categories = created.categories.map((c) => ({ id: c.id!, name: c.name, direction: c.direction }));
    ctx.accounts = created.accounts.map((a) => ({ id: a.id!, name: a.name, type: a.type }));
    const second = planImport(first.parsed, ctx, { includeProfile: false });
    const adds = Object.entries(second.summary).filter(([k, v]) => k !== "property_owners" && v.toAdd > 0);
    expect(adds).toEqual([]);
    expect(second.creates.transactions).toHaveLength(0);
    expect(second.summary.transactions.alreadyThere).toBe(2);
  });
});

describe("importing into an account that already has data", () => {
  const csv = renderExportCsv(sampleData(), D("2026-09-19T00:00:00Z"));

  it("matches categories and accounts by name instead of duplicating the defaults", () => {
    const ctx = ctxFor({
      categories: [{ id: "defRent", name: "Rental Income", direction: "INCOME" }, { id: "defCouncil", name: "council rates", direction: "EXPENSE" }],
      accounts: [{ id: "defAcc", name: "everyday", type: "BANK" }],
    });
    const { plan: p } = plan(csv, ctx);
    expect(p.creates.categories.map((c) => c.name)).toEqual(["=Pest control"]);
    expect(p.creates.accounts).toHaveLength(0);
    const tx = p.creates.transactions.find((x) => x.amount === 1815)!;
    expect(tx.categoryId).toBe("defRent");
    expect(tx.accountId).toBe("defAcc");
  });

  it("never reuses an id that belongs to someone else's data — uses a stable replacement instead", () => {
    const ctx = ctxFor();
    ctx.exists.transactions.anywhere.add("tx1"); // exists, but in another household
    const a = plan(csv, ctx).plan.creates.transactions.find((x) => x.amount === 1815)!;
    const b = plan(csv, ctx).plan.creates.transactions.find((x) => x.amount === 1815)!;
    expect(a.id).not.toBe("tx1");
    expect(a.id).toBe(b.id);
    expect(a.id!.startsWith("imp")).toBe(true);
  });

  it("does not add a second principal place of residence", () => {
    const { plan: p } = plan(csv, ctxFor({ ppr: { id: "existingHome", name: "Current Home" } }));
    const home = p.creates.properties.find((x) => x.name === "Family Home")!;
    expect(home.propertyType).toBe("INVESTMENT");
    expect(p.warnings.some((w) => w.includes("Current Home") && w.includes("investment property"))).toBe(true);
  });

  it("imports a PPR as an investment property into a company or trust portfolio", () => {
    const { plan: p } = plan(csv, ctxFor({ portfolioType: "COMPANY" }));
    expect(p.creates.properties.find((x) => x.name === "Family Home")!.propertyType).toBe("INVESTMENT");
    expect(p.warnings.some((w) => w.includes("Personal Finance portfolio"))).toBe(true);
  });

  it("keeps the PPR when the person has none", () => {
    const { plan: p } = plan(csv);
    expect(p.creates.properties.find((x) => x.name === "Family Home")!.propertyType).toBe("PPR");
  });

  it("only touches the profile when asked to", () => {
    expect(plan(csv, ctxFor(), false).plan.profile).toBeNull();
  });
});

describe("hand-edited and damaged files", () => {
  const header = "Revenue Expense Tracker export,1\r\n\r\n";

  it("rejects files that aren't from this app", () => {
    expect(() => parseExportFile("date,amount\n2026-01-01,5")).toThrow(/doesn't look like a file exported/);
    expect(() => parseExportFile("")).toThrow();
  });

  it("rejects files from a newer format", () => {
    expect(() => parseExportFile("Revenue Expense Tracker export,99\r\n[accounts]\r\nid,name,type\r\na,b,BANK")).toThrow(/newer version/);
  });

  it("lets you add rows by hand: names instead of ids, blank ids, day/month/year dates, $ amounts", () => {
    const csv =
      header +
      "[categories]\r\nid,name,direction,is_custom\r\n,Groceries,EXPENSE,false\r\n\r\n" +
      "[properties]\r\nid,name,property_type\r\n,Beach House,investment\r\n\r\n" +
      "[transactions]\r\nid,date,description,amount,direction,category,property\r\n" +
      ",19/09/2026,Supermarket,\"$1,234.50\",expense,Groceries,\r\n" +
      ",20/09/2026,Council rates,500,EXPENSE,,Beach House\r\n";
    const { plan: p } = plan(csv);
    expect(p.errors).toEqual([]);
    const [a, b] = p.creates.transactions;
    expect(a!.amount).toBe(1234.5);
    expect(a!.date).toEqual(D("2026-09-19T00:00:00Z"));
    expect(a!.categoryId).toBe(p.creates.categories[0]!.id);
    expect(b!.propertyId).toBe(p.creates.properties[0]!.id);
    expect(p.creates.properties[0]!.propertyType).toBe("INVESTMENT");
    expect(a!.id!.startsWith("imp")).toBe(true);
  });

  it("gives identical hand-typed rows the same identity, so re-importing doesn't duplicate them", () => {
    const csv = header + "[transactions]\r\nid,date,description,amount,direction\r\n,2026-09-19,Coffee,4.5,EXPENSE\r\n";
    const first = plan(csv).plan.creates.transactions[0]!;
    const ctx = ctxFor();
    ctx.exists.transactions.anywhere.add(first.id!);
    ctx.exists.transactions.inHousehold.add(first.id!);
    const second = plan(csv, ctx).plan;
    expect(second.creates.transactions).toHaveLength(0);
    expect(second.summary.transactions.alreadyThere).toBe(1);
  });

  it("skips bad rows and reports them, still importing the good ones", () => {
    const csv =
      header +
      "[transactions]\r\nid,date,description,amount,direction\r\n" +
      "t1,2026-09-19,Good,10,EXPENSE\r\n" +
      "t2,not-a-date,Bad date,10,EXPENSE\r\n" +
      "t3,2026-09-19,Bad amount,abc,EXPENSE\r\n" +
      "t4,2026-09-19,Bad direction,10,SIDEWAYS\r\n" +
      "t5,2026-09-19,,10,EXPENSE\r\n" +
      "t6,2026-09-19,Negative,-5,EXPENSE\r\n" +
      "t1,2026-09-19,Duplicate id,10,EXPENSE\r\n";
    const { plan: p } = plan(csv);
    expect(p.summary.transactions).toEqual({ inFile: 7, toAdd: 1, alreadyThere: 0, skipped: 6 });
    expect(p.errors).toHaveLength(5);
    expect(p.errors.join("\n")).toContain("Income & expenses, row 6");
    expect(p.warnings.some((w) => w.includes("more than once"))).toBe(true);
  });

  it("skips children whose parent isn't in the file", () => {
    const csv = header + "[investment_transactions]\r\nid,investment_id,type,date,quantity,price_per_unit\r\nx1,missing,BUY,2026-01-01,1,1\r\n";
    const { plan: p } = plan(csv);
    expect(p.summary.investment_transactions.skipped).toBe(1);
    expect(p.errors[0]).toContain("isn't in the file");
  });

  it("only accepts https links for document files", () => {
    const csv = header + "[documents]\r\nid,file_name,file_type,file_path\r\nd1,a.pdf,application/pdf,javascript:alert(1)\r\nd2,b.pdf,application/pdf,https://example.com/b.pdf\r\n";
    const { plan: p } = plan(csv);
    expect(p.creates.documents.map((d) => d.fileName)).toEqual(["b.pdf"]);
    expect(p.errors[0]).toContain("https://");
  });

  it("creates the usual reminder for hand-typed upcoming bills", () => {
    const csv = header + "[bills]\r\nid,name,amount,frequency,next_due_date,reminder_days_before\r\n,Internet,89,MONTHLY,2026-10-10,7\r\n";
    const { plan: p } = plan(csv);
    expect(p.creates.reminders).toHaveLength(1);
    expect(p.creates.reminders[0]!.title).toBe("Internet due");
    expect(p.creates.reminders[0]!.dueDate).toEqual(D("2026-10-03T00:00:00Z"));
  });

  it("ignores unknown sections with a note", () => {
    const csv = header + "[mystery]\r\na,b\r\n1,2\r\n\r\n[accounts]\r\nid,name,type\r\n,Savings,BANK\r\n";
    const { plan: p } = plan(csv);
    expect(p.warnings.some((w) => w.includes("[mystery]"))).toBe(true);
    expect(p.creates.accounts).toHaveLength(1);
  });

  it("rejects an oversized row count", () => {
    let body = header + "[accounts]\r\nid,name,type\r\n";
    for (let i = 0; i < 25001; i++) body += `,A${i},BANK\r\n`;
    expect(() => parseExportFile(body)).toThrow(/more than can be imported/);
  });
});

describe("parseDateCell", () => {
  it("reads ISO and day/month/year forms and rejects impossible dates", () => {
    expect(parseDateCell("2026-09-19")).toEqual(D("2026-09-19T00:00:00Z"));
    expect(parseDateCell("2026-09-19T10:30:00.000Z")).toEqual(D("2026-09-19T10:30:00Z"));
    expect(parseDateCell("5/3/2026")).toEqual(D("2026-03-05T00:00:00Z"));
    expect(parseDateCell("31/02/2026")).toBeNull();
    expect(parseDateCell("yesterday")).toBeNull();
    expect(parseDateCell("")).toBeNull();
  });
});
