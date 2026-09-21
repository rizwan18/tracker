import { describe, it, expect } from "vitest";
import { renderExportCsv, type ExportData } from "../services/dataTransfer/renderExport";
import { parseExportFile } from "../services/dataTransfer/parseExport";
import { emptyExistence, planImport, type ImportContext, type ImportPlan } from "../services/dataTransfer/planImport";
import { ignoredSectionsWarning, restrictToScope } from "../services/dataTransfer/scopes";
import { EXPORT_SCOPES, SECTION_COLUMNS, SECTION_ORDER, missingRequiredColumns, type SectionName } from "../services/dataTransfer/sections";
import { INVESTMENT_TYPES } from "../lib/constants";

const D = (s: string) => new Date(s);
const base = { createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") };
const NAMES = (csv: string) => [...csv.matchAll(/^\[([a-z_]+)\]/gm)].map((m) => m[1]);
const NEW_ID = (n: string) => `${n}`;

// ---------- a household with a bit of everything ------------------------------------------------
function household(): ExportData {
  const prop = (id: string, name: string, type: string, extra: object = {}) => ({
    id, householdId: "hA", name, address: `${name}, VIC`, propertyType: type, purchaseDate: D("2015-05-01"), purchasePrice: 400000, currentEstimatedValue: 650000, loanBalance: 300000,
    loanInterestRate: 6.2, rentalAgent: null, tenantName: null, rentAmount: type === "PPR" ? null : 520, rentFrequency: type === "PPR" ? null : "WEEKLY", rentalStartDate: null,
    availableForRentDate: type === "PPR" ? null : D("2016-01-01"), scheduleInitialised: type !== "PPR", notes: null, managerName: type === "PPR" ? null : "Jo Agent", managerCompany: null,
    managerEmail: null, managerPhone: null, managerMobile: null, managerWebsite: null, managerAbn: null, managerAddress: null, managerNotes: null, ...extra, ...base,
  });
  const inv = (id: string, name: string, ticker: string | null, type: string, extra: object = {}) => ({
    id, householdId: "hA", name, ticker, type, notes: null, currentValueOverride: null, market: null, currency: "AUD", ...extra, ...base,
  });
  return {
    profile: { fullName: "Sam Citizen", email: "sam@example.com", timezone: "Australia/Melbourne", easyViewEnabled: false, householdName: "Sam's household" },
    accounts: [{ id: "acc1", householdId: "hA", name: "Everyday", type: "BANK", ...base }],
    categories: [
      { id: "catCouncil", householdId: "hA", name: "Council Rates", direction: "EXPENSE", isCustom: false, createdAt: base.createdAt },
      { id: "catWater", householdId: "hA", name: "Water Rates", direction: "EXPENSE", isCustom: false, createdAt: base.createdAt },
      { id: "catGroceries", householdId: "hA", name: "Groceries", direction: "EXPENSE", isCustom: false, createdAt: base.createdAt },
    ],
    properties: [prop("p1", "Maple Street", "INVESTMENT"), prop("p2", "Oak Avenue", "INVESTMENT", { managerName: "Sam Broker" }), prop("p3", "Family Home", "PPR")],
    owners: [{ propertyId: "p1", email: "sam@example.com", percentage: 50 }, { propertyId: "p2", email: "sam@example.com", percentage: 100 }, { propertyId: "p3", email: "sam@example.com", percentage: 100 }],
    scheduleLines: [
      { id: "sl1", propertyId: "p1", categoryId: "catCouncil", label: "Council rates", isManual: false, sortOrder: 1, createdAt: base.createdAt },
      { id: "sl2", propertyId: "p2", categoryId: "catWater", label: "Water charges", isManual: false, sortOrder: 2, createdAt: base.createdAt },
    ],
    yearDetails: [{ id: "yd1", propertyId: "p1", financialYear: "2026-27", weeksRented: 52, updatedAt: base.updatedAt }],
    photos: [{ id: "ph1", propertyId: "p1", fileName: "front.jpg", contentType: "image/jpeg", filePath: "https://x.public.blob.vercel-storage.com/front.jpg", thumbPath: null, isPrimary: true, createdAt: base.createdAt }],
    investments: [
      inv("i1", "Vanguard Australian Shares", "VAS", "ETF", { market: "ASX" }),
      inv("i2", "CSL Limited", "CSL", "SHARE", { market: "ASX", notes: "Long term" }),
      inv("i3", "Apple", "AAPL", "SHARE", { market: "WALL_ST", currency: "USD" }),
      inv("i4", "Bitcoin", null, "CRYPTO", { currentValueOverride: 12000 }),
      inv("i5", "Term deposit — CBA", null, "TERM_DEPOSIT", { currentValueOverride: 20000 }),
      inv("i6", "Vintage watch", null, "COLLECTIBLE", { currentValueOverride: 4500.5 }),
    ],
    valuations: [
      { id: "v1", investmentId: "i1", asAt: D("2026-06-30"), units: 120, marketPrice: 100, marketValue: 12000, marketValueAud: 12000, currency: "AUD", source: "STAKE", createdAt: base.createdAt },
      { id: "v2", investmentId: "i3", asAt: D("2026-06-30"), units: 2, marketPrice: 289.36, marketValue: 578.72, marketValueAud: 835.9, currency: "USD", source: "STAKE", createdAt: base.createdAt },
    ],
    investmentTransactions: [{ id: "it1", investmentId: "i1", type: "BUY", date: D("2024-02-01"), quantity: 100, pricePerUnit: 90.5, brokerage: 9.95, notes: null, ...base }],
    dividends: [{ id: "dv1", investmentId: "i1", exDividendDate: D("2026-03-20"), paymentDate: D("2026-04-05"), grossAmount: 100, frankingCredit: 20, frankedAmount: 100, unfrankedAmount: 0, taxWithheld: 0, netAmount: 100, status: "RECEIVED", notes: null, financialYear: "2025-26", ...base }],
    disposals: [{ id: "cg1", householdId: "hA", investmentId: "i2", purchaseDate: D("2020-01-01"), purchasePrice: 10, purchaseCosts: 1, saleDate: D("2026-01-15"), salePrice: 15, saleCosts: 1, quantity: 100, ownershipPercentage: 100, costBase: 1001, proceeds: 1499, grossGainLoss: 498, holdingPeriodDays: 2205, financialYear: "2025-26", notes: null, ...base }],
    transactions: [{ id: "tx1", householdId: "hA", userId: "uA", date: D("2026-07-15"), description: "Rent — July", amount: 2250, direction: "INCOME", categoryId: null, accountId: "acc1", propertyId: "p1", investmentId: null, notes: null, isRecurring: false, recurrenceFrequency: null, potentialTaxCategory: null, financialYear: "2026-27", ...base }],
    bills: [{ id: "bl1", householdId: "hA", name: "Water", provider: null, amount: 180, frequency: "QUARTERLY", nextDueDate: D("2026-10-01"), accountId: null, categoryId: null, propertyId: "p1", autoRenew: false, reminderDaysBefore: 7, status: "UPCOMING", notes: null, ...base }],
    reminders: [], documents: [],
  } as unknown as ExportData;
}

const EMPTY: ExportData = { ...household(), properties: [], owners: [], scheduleLines: [], yearDetails: [], photos: [], investments: [], valuations: [], investmentTransactions: [], dividends: [], disposals: [], transactions: [], bills: [] };

const ctxFor = (over: Partial<ImportContext> = {}): ImportContext => ({ householdId: "hB", userId: "uB", userEmail: "sam@example.com", portfolioType: "PERSONAL", categories: [], accounts: [], ppr: null, exists: emptyExistence(), ...over });
const now = D("2026-09-21T00:00:00Z");
const csvOf = (scope: "properties" | "investments" | "all", data = household()) => renderExportCsv(data, now, scope);
const planOf = (csv: string, ctx = ctxFor()): ImportPlan => planImport(parseExportFile(csv), ctx, { includeProfile: false });
const totalToAdd = (p: ImportPlan) => Object.values(p.summary).reduce((n, s) => n + s.toAdd, 0);

/** Pretend a plan has been written: every id it created now exists in the household. */
function afterImport(plan: ImportPlan): ImportContext {
  const ctx = ctxFor();
  const put = (t: keyof ImportContext["exists"], rows: Array<{ id?: string }>) => rows.forEach((r) => r.id && (ctx.exists[t].anywhere.add(r.id), ctx.exists[t].inHousehold.add(r.id)));
  const c = plan.creates;
  put("categories", c.categories); put("properties", c.properties); put("property_schedule_lines", c.scheduleLines); put("property_year_details", c.yearDetails); put("property_photos", c.photos);
  put("investments", c.investments); put("investment_valuations", c.valuations); put("investment_transactions", c.investmentTransactions); put("dividends", c.dividends); put("capital_gain_disposals", c.disposals);
  ctx.categories = c.categories.map((x) => ({ id: x.id!, name: x.name, direction: x.direction }));
  ctx.similar = { properties: c.properties.map((x) => ({ id: x.id!, name: x.name })), investments: c.investments.map((x) => ({ id: x.id!, name: x.name, ticker: x.ticker ?? null })) };
  return ctx;
}

const PROPERTY_SECTIONS = EXPORT_SCOPES.properties.sections;
const INVESTMENT_SECTIONS = EXPORT_SCOPES.investments.sections;

describe("1. property portfolio export", () => {
  const csv = csvOf("properties");
  it("contains only property sections (in the app's own sectioned format, no record_type column)", () => {
    expect(NAMES(csv)).toEqual(SECTION_ORDER.filter((s) => (PROPERTY_SECTIONS as readonly string[]).includes(s)));
    for (const other of ["profile", "accounts", "transactions", "bills", "investments", "dividends", "reminders", "documents"]) expect(NAMES(csv)).not.toContain(other);
    expect(csv).not.toContain("record_type");
    expect(csv.split("\r\n")[0]).toBe("Revenue Expense Tracker export,1");
    expect(csv).toContain("Contents,property portfolio");
  });
  it("uses exactly the same columns as the full 'Your data' export for those sections", () => {
    for (const name of PROPERTY_SECTIONS) expect(csv).toContain(`[${name}]\r\n${SECTION_COLUMNS[name].join(",")}\r\n`);
  });
  it("exports every property with its own details, and only the categories its rental lines use", () => {
    expect(csv).toContain("Maple Street");
    expect(csv).toContain("Oak Avenue");
    expect(csv).toContain("Family Home");
    expect(csv).toContain("Council Rates");
    expect(csv).toContain("Water Rates");
    expect(csv).not.toContain("Groceries");
    expect(csv).not.toContain("Rent — July"); // income/expense entries belong to "Your data"
  });
  it("leaves the full 'Your data' export exactly as it was (all sections, no extra line)", () => {
    const all = csvOf("all");
    expect(NAMES(all)).toEqual([...SECTION_ORDER]);
    expect(all).not.toContain("Contents,");
    expect(renderExportCsv(household(), now)).toBe(all); // the default scope is "all"
  });
});

describe("2. re-importing the property CSV", () => {
  const csv = csvOf("properties");
  it("restores every property, ownership, rental line, year detail and picture into an empty account", () => {
    const p = planOf(csv);
    expect(p.errors).toEqual([]);
    expect(p.summary.properties).toMatchObject({ inFile: 3, toAdd: 3 });
    expect(p.creates.properties.map((x) => x.name)).toEqual(["Maple Street", "Oak Avenue", "Family Home"]);
    expect(p.creates.properties.map((x) => x.propertyType)).toEqual(["INVESTMENT", "INVESTMENT", "PPR"]);
    expect(p.creates.properties[0]).toMatchObject({ id: "p1", purchasePrice: 400000, currentEstimatedValue: 650000, loanBalance: 300000, loanInterestRate: 6.2, rentAmount: 520, rentFrequency: "WEEKLY", managerName: "Jo Agent" });
    expect(p.creates.properties[0]!.purchaseDate).toEqual(D("2015-05-01"));
    expect(p.creates.propertyOwnerships.map((o) => [o.propertyId, o.percentage])).toEqual([["p1", 50], ["p2", 100], ["p3", 100]]);
    expect(p.summary.property_schedule_lines.toAdd).toBe(2);
    expect(p.summary.property_year_details.toAdd).toBe(1);
    expect(p.summary.property_photos.toAdd).toBe(1);
    expect(p.summary.categories.toAdd).toBe(2);
  });
  it("re-importing into the account it came from adds nothing (no duplicates)", () => {
    const first = planOf(csv);
    const second = planOf(csv, afterImport(first));
    expect(second.errors).toEqual([]);
    expect(second.summary.properties).toMatchObject({ toAdd: 0, alreadyThere: 3 });
    expect(second.creates.properties).toHaveLength(0);
    expect(second.creates.scheduleLines).toHaveLength(0);
    expect(second.creates.photos).toHaveLength(0);
    expect(second.summary.property_owners.toAdd).toBe(0);
  });
  it("is lossless: exporting what was imported gives back the same property rows", () => {
    const rows = planOf(csv).creates.properties;
    expect(rows.every((r) => r.householdId === "hB")).toBe(true);
    const roundTripped = { ...household(), properties: rows.map((r) => ({ ...r, ...base })) } as unknown as ExportData;
    const csv2 = renderExportCsv(roundTripped, now, "properties");
    const section = (c: string) => c.split("[properties]")[1]!.split("[property_owners]")[0]!;
    expect(section(csv2)).toBe(section(csv));
  });
});

describe("3–4. investment portfolio export and re-import", () => {
  const csv = csvOf("investments");
  it("exports only investment sections, with every type and the holding valuations", () => {
    expect(NAMES(csv)).toEqual(SECTION_ORDER.filter((s) => (INVESTMENT_SECTIONS as readonly string[]).includes(s)));
    for (const other of ["profile", "properties", "transactions", "accounts", "categories"]) expect(NAMES(csv)).not.toContain(other);
    expect(csv).toContain("Contents,investment portfolio");
    for (const type of ["ETF", "SHARE", "CRYPTO", "TERM_DEPOSIT", "COLLECTIBLE"]) expect(csv).toContain(`,${type},`);
    expect(csv).toContain("WALL_ST");
    expect(csv).not.toContain("Maple Street");
  });
  it("restores investments with their type, ticker, market, currency, override, holdings, trades, dividends and disposals", () => {
    const p = planOf(csv);
    expect(p.errors).toEqual([]);
    const by = (name: string) => p.creates.investments.find((i) => i.name === name)!;
    expect(by("Vanguard Australian Shares")).toMatchObject({ type: "ETF", ticker: "VAS", market: "ASX", currency: "AUD" });
    expect(by("Apple")).toMatchObject({ type: "SHARE", ticker: "AAPL", market: "WALL_ST", currency: "USD" });
    expect(by("Bitcoin")).toMatchObject({ type: "CRYPTO", ticker: null, currentValueOverride: 12000 });
    expect(by("Vintage watch")).toMatchObject({ type: "COLLECTIBLE", currentValueOverride: 4500.5 });
    expect(by("CSL Limited").notes).toBe("Long term");
    expect(p.creates.valuations.map((v) => [v.investmentId, v.units, v.marketPrice, v.marketValue, v.marketValueAud, v.currency, v.source])).toEqual([["i1", 120, 100, 12000, 12000, "AUD", "STAKE"], ["i3", 2, 289.36, 578.72, 835.9, "USD", "STAKE"]]);
    expect(p.creates.investmentTransactions[0]).toMatchObject({ investmentId: "i1", type: "BUY", quantity: 100, pricePerUnit: 90.5, brokerage: 9.95 });
    expect(p.creates.dividends[0]).toMatchObject({ investmentId: "i1", grossAmount: 100, frankingCredit: 20, status: "RECEIVED" });
    expect(p.creates.disposals[0]).toMatchObject({ investmentId: "i2", quantity: 100, grossGainLoss: 498 });
    expect(p.summary.investments.toAdd).toBe(6);
  });
  it("re-importing into the same account adds nothing", () => {
    const second = planOf(csv, afterImport(planOf(csv)));
    expect(totalToAdd(second)).toBe(0);
    expect(second.summary.investments.alreadyThere).toBe(6);
    expect(second.errors).toEqual([]);
  });
  it("keeps every investment type the app supports", () => {
    const data = { ...household(), investments: INVESTMENT_TYPES.map((t, i) => ({ id: `t${i}`, householdId: "hA", name: `Holding ${t}`, ticker: null, type: t, notes: null, currentValueOverride: 100 + i, market: null, currency: "AUD", ...base })), valuations: [], investmentTransactions: [], dividends: [], disposals: [] } as unknown as ExportData;
    const p = planOf(renderExportCsv(data, now, "investments"));
    expect(p.creates.investments.map((i) => i.type)).toEqual([...INVESTMENT_TYPES]);
    expect(p.creates.investments.map((i) => i.currentValueOverride)).toEqual(INVESTMENT_TYPES.map((_, i) => 100 + i));
  });
});

describe("5. empty portfolios", () => {
  it("an empty property export has just headers, and importing it says there is nothing to import", () => {
    const csv = renderExportCsv(EMPTY, now, "properties");
    expect(NAMES(csv)).toContain("properties");
    expect(() => parseExportFile(csv)).toThrow(/doesn't contain any data rows/);
  });
  it("same for investments", () => {
    expect(() => parseExportFile(renderExportCsv(EMPTY, now, "investments"))).toThrow(/doesn't contain any data rows/);
  });
});

describe("6. multiple properties, with a company/trust rule", () => {
  it("imports several at once; a PPR becomes an investment property in a non-personal portfolio", () => {
    const p = planOf(csvOf("properties"), ctxFor({ portfolioType: "TRUST" }));
    expect(p.creates.properties.map((x) => x.propertyType)).toEqual(["INVESTMENT", "INVESTMENT", "INVESTMENT"]);
    expect(p.warnings.some((w) => w.includes("Personal Finance portfolio"))).toBe(true);
  });
  it("does not add a second principal place of residence", () => {
    const p = planOf(csvOf("properties"), ctxFor({ ppr: { id: "existing", name: "My Current Home" } }));
    expect(p.creates.properties.find((x) => x.name === "Family Home")!.propertyType).toBe("INVESTMENT");
  });
});

describe("8. invalid headers", () => {
  const head = "Revenue Expense Tracker export,1\r\n\r\n";
  it("rejects a file that isn't from this app", () => {
    expect(() => parseExportFile("name,address\r\nMaple,1 High St")).toThrow(/doesn't look like a file exported/);
  });
  it("names the missing column once, instead of failing each row", () => {
    const p = planOf(`${head}[properties]\r\nid,nmae,address\r\np1,Maple,1 High St\r\np2,Oak,2 High St\r\n`);
    expect(p.creates.properties).toHaveLength(0);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain("[properties]");
    expect(p.errors[0]).toContain("“name”");
    expect(p.errors[0]).toContain("2 rows");
    expect(p.summary.properties).toMatchObject({ inFile: 2, toAdd: 0, skipped: 2 });
  });
  it("understands 'id or name' alternatives for links between records", () => {
    expect(missingRequiredColumns("investment_transactions", ["investment", "type", "date", "quantity", "price_per_unit"])).toEqual([]);
    expect(missingRequiredColumns("investment_transactions", ["type", "date", "quantity", "price_per_unit"])).toEqual(["investment_id or investment"]);
    expect(missingRequiredColumns("investments", ["name"])).toEqual(["type"]);
  });
  it("blocks only the broken section; the others still import", () => {
    const p = planOf(`${head}[investments]\r\nid,name\r\ni1,Vanguard\r\n\r\n[properties]\r\nid,name\r\np1,House\r\n`);
    expect(p.creates.investments).toHaveLength(0);
    expect(p.creates.properties).toHaveLength(1);
    expect(p.errors.join(" ")).toContain("[investments]");
  });
  it("notes sections it doesn't recognise rather than ignoring them silently", () => {
    const p = planOf(`${head}[mystery]\r\na,b\r\n1,2\r\n\r\n[properties]\r\nid,name\r\np1,House\r\n`);
    expect(p.warnings.some((w) => w.includes("[mystery]"))).toBe(true);
  });
});

describe("9–11. invalid rows are skipped and reported by row and field", () => {
  const head = "Revenue Expense Tracker export,1\r\n\r\n";
  it("investments: missing name, bad type", () => {
    const p = planOf(`${head}[investments]\r\nid,name,ticker,type\r\ni1,,X,SHARE\r\ni2,Good,GD,SHARE\r\ni3,Odd,OD,LOTTERY\r\n`);
    expect(p.creates.investments.map((i) => i.name)).toEqual(["Good"]);
    expect(p.errors).toHaveLength(2);
    expect(p.errors[0]).toContain("row 5");
    expect(p.errors[0]).toContain("“name” is required");
    expect(p.errors[1]).toContain("row 7");
    expect(p.errors[1]).toContain("“type” must be one of");
  });
  it("properties: invalid numbers and out-of-range values", () => {
    const p = planOf(`${head}[properties]\r\nid,name,purchase_price,loan_interest_rate,current_estimated_value\r\np1,A,abc,5,100\r\np2,B,100,150,100\r\np3,C,-5,5,100\r\np4,Fine,\"$1,250,000.50\",6.5,1300000\r\n`);
    expect(p.creates.properties.map((x) => x.name)).toEqual(["Fine"]);
    expect(p.creates.properties[0]).toMatchObject({ purchasePrice: 1250000.5, loanInterestRate: 6.5, currentEstimatedValue: 1300000 });
    expect(p.errors.map((e) => e.match(/“(\w+)”/)![1])).toEqual(["purchase_price", "loan_interest_rate", "purchase_price"]);
    expect(p.errors[0]).toContain("should be a number");
  });
  it("investment trades: invalid numbers and dates", () => {
    const p = planOf(`${head}[investments]\r\nid,name,type\r\ni1,VAS,ETF\r\n\r\n[investment_transactions]\r\nid,investment_id,type,date,quantity,price_per_unit\r\nt1,i1,BUY,not-a-date,10,5\r\nt2,i1,BUY,2026-01-01,ten,5\r\nt3,i1,HOLD,2026-01-01,10,5\r\nt4,i1,BUY,31/02/2026,10,5\r\nt5,i1,BUY,05/03/2026,10,5.25\r\n`);
    expect(p.creates.investmentTransactions).toHaveLength(1);
    expect(p.creates.investmentTransactions[0]).toMatchObject({ date: D("2026-03-05"), quantity: 10, pricePerUnit: 5.25 });
    expect(p.errors).toHaveLength(4);
    expect(p.errors.some((e) => e.includes("“date” isn't a date I can read"))).toBe(true);
    expect(p.errors.some((e) => e.includes("“quantity” should be a number"))).toBe(true);
    expect(p.errors.some((e) => e.includes("“type” must be one of BUY, SELL"))).toBe(true);
  });
  it("properties: invalid dates", () => {
    const p = planOf(`${head}[properties]\r\nid,name,purchase_date\r\np1,A,yesterday\r\np2,B,2026-13-45\r\np3,C,21/09/2026\r\n`);
    expect(p.creates.properties.map((x) => x.name)).toEqual(["C"]);
    expect(p.creates.properties[0]!.purchaseDate).toEqual(D("2026-09-21"));
    expect(p.errors).toHaveLength(2);
  });
  it("a child whose parent isn't in the file is reported, not guessed", () => {
    const p = planOf(`${head}[dividends]\r\nid,investment_id,gross_amount,net_amount\r\nd1,ghost,10,10\r\n`);
    expect(p.creates.dividends).toHaveLength(0);
    expect(p.errors[0]).toContain("isn't in the file");
  });
});

describe("12. duplicates", () => {
  const head = "Revenue Expense Tracker export,1\r\n\r\n";
  it("the same id twice in one file is used once, with a warning", () => {
    const p = planOf(`${head}[properties]\r\nid,name\r\np1,House\r\np1,House again\r\n`);
    expect(p.creates.properties).toHaveLength(1);
    expect(p.warnings.some((w) => w.includes("appears more than once"))).toBe(true);
  });
  it("two identical rows with no id are one record", () => {
    const p = planOf(`${head}[investments]\r\nid,name,type\r\n,CBA,SHARE\r\n,CBA,SHARE\r\n`);
    expect(p.creates.investments).toHaveLength(1);
    expect(p.warnings.some((w) => w.includes("identical to an earlier one"))).toBe(true);
  });
  it("records that are already there are left exactly as they are", () => {
    const csv = csvOf("investments");
    const first = planOf(csv);
    const second = planOf(csv.replace("Long term", "Changed in the spreadsheet"), afterImport(first));
    expect(second.creates.investments).toHaveLength(0);          // never overwritten
    expect(second.summary.investments.alreadyThere).toBe(6);
  });
  it("warns when something being added looks like a record you already have under a different id", () => {
    const ctx = ctxFor({ similar: { properties: [{ id: "mine", name: "maple street" }], investments: [{ id: "myVas", name: "Something else", ticker: "vas" }] } });
    const p = planOf(`${head}[properties]\r\nid,name\r\np1,Maple Street\r\n\r\n[investments]\r\nid,name,ticker,type\r\ni1,Vanguard,VAS,ETF\r\n`, ctx);
    expect(p.creates.properties).toHaveLength(1);
    expect(p.warnings.filter((w) => w.includes("looks like")).length).toBe(2);
    expect(p.warnings.join(" ")).toContain("second record");
  });
});

describe("13/16. portfolio imports stay inside their portfolio", () => {
  const full = csvOf("all");
  it("a property import of a full backup only takes the property sections, and says what it left out", () => {
    const { parsed, ignored } = restrictToScope(parseExportFile(full), "properties");
    expect(ignored).toEqual(expect.arrayContaining(["profile", "accounts", "investments", "transactions", "bills"]));
    expect([...parsed.sections.keys()].every((s) => (PROPERTY_SECTIONS as readonly string[]).includes(s))).toBe(true);
    const p = planImport(parsed, ctxFor(), { includeProfile: false });
    expect(p.summary.properties.toAdd).toBe(3);
    expect(p.creates.investments).toHaveLength(0);
    expect(p.creates.transactions).toHaveLength(0);
    expect(p.creates.bills).toHaveLength(0);
    expect(p.creates.accounts).toHaveLength(0);
    expect(p.profile).toBeNull();
    expect(ignoredSectionsWarning(ignored, "properties")).toContain("Use “Your data” to restore everything");
  });
  it("an investment import of a full backup leaves properties, money and profile alone", () => {
    const { parsed } = restrictToScope(parseExportFile(full), "investments");
    const p = planImport(parsed, ctxFor(), { includeProfile: false });
    expect(p.summary.investments.toAdd).toBe(6);
    expect(p.creates.properties).toHaveLength(0);
    expect(p.creates.propertyOwnerships).toHaveLength(0);
    expect(p.creates.scheduleLines).toHaveLength(0);
    expect(p.creates.transactions).toHaveLength(0);
    expect(p.creates.categories).toHaveLength(0);
    expect(p.profile).toBeNull();
    for (const name of SECTION_ORDER.filter((s) => !(INVESTMENT_SECTIONS as readonly string[]).includes(s)) as SectionName[]) expect(p.summary[name].inFile).toBe(0);
  });
  it("gives a helpful message when the file is for the other portfolio", () => {
    expect(() => restrictToScope(parseExportFile(csvOf("investments")), "properties")).toThrow(/doesn't contain any property data\. It has: investments/);
    expect(() => restrictToScope(parseExportFile(csvOf("properties")), "investments")).toThrow(/doesn't contain any investment data\. It has: .*properties/);
    expect(() => restrictToScope(parseExportFile(csvOf("investments")), "properties")).toThrow(/Properties page/);
  });
  it("a categories-only file doesn't count as property data", () => {
    const only = "Revenue Expense Tracker export,1\r\n\r\n[categories]\r\nid,name,direction\r\nc1,Groceries,EXPENSE\r\n";
    expect(() => restrictToScope(parseExportFile(only), "properties")).toThrow(/doesn't contain any property data/);
  });
});

describe("real holdings from the uploaded Stake statement (as the app stores them) survive export → import", () => {
  // Values copied from the statement's "Aus Equities" and "Wall St Equities" sheets (statement date 2026-06-30).
  const holdings: Array<[string, string, "ASX" | "WALL_ST", number, number, number, number, "SHARE" | "ETF"]> = [
    ["FCL", "FINEOS CORP HOLD PLC-CDI 1:1", "ASX", 2000, 2.2, 4400, 4400, "SHARE"],
    ["RMD", "RESMED INC-CDI 10:1 FOR. EXEMPT", "ASX", 417, 28.88, 12042.96, 12042.96, "SHARE"],
    ["WEB", "WEB TRAVEL GROUP LTD-ORDINARY", "ASX", 4586, 2.96, 13574.56, 13574.56, "SHARE"],
    ["WJL", "WEBJET GROUP LIMITED-ORDINARY", "ASX", 4586, 0.41, 1880.26, 1880.26, "SHARE"],
    ["IVV", "ISHARES S&P 500 ETF-ETF UNITS", "ASX", 10, 72.29, 722.9, 722.9, "ETF"],
    ["AAPL", "Apple", "WALL_ST", 2, 289.36, 578.72, 835.9, "SHARE"],
    ["BAC", "BofAML", "WALL_ST", 13, 56.98, 740.74, 1069.92, "SHARE"],
    ["BYDDY", "BYD Company Limited", "WALL_ST", 114, 9.239, 1053.25, 1521.3, "SHARE"],
    ["GPRO", "GoPro", "WALL_ST", 6, 0.778, 4.67, 6.75, "SHARE"],
    ["KO", "Coca-Cola", "WALL_ST", 34, 81.27, 2763.18, 3991.1, "SHARE"],
    ["PDD", "PDD Holdings Inc.", "WALL_ST", 1, 76.28, 76.28, 110.18, "SHARE"],
    ["TRVG", "Trivago NV", "WALL_ST", 0.2, 5.47, 1.09, 1.57, "SHARE"],
  ];
  const data = {
    ...household(),
    investments: holdings.map(([symbol, name, market, , , , , type], i) => ({ id: `s${i}`, householdId: "hA", name, ticker: symbol, type, notes: null, currentValueOverride: null, market, currency: market === "ASX" ? "AUD" : "USD", ...base })),
    valuations: holdings.map(([, , market, units, price, value, aud], i) => ({ id: `sv${i}`, investmentId: `s${i}`, asAt: D("2026-06-30"), units, marketPrice: price, marketValue: value, marketValueAud: aud, currency: market === "ASX" ? "AUD" : "USD", source: "STAKE", createdAt: base.createdAt })),
    investmentTransactions: [], dividends: [], disposals: [],
  } as unknown as ExportData;
  const csv = renderExportCsv(data, now, "investments");

  it("all 12 holdings come back with identical units, prices, values, currency and market", () => {
    const p = planOf(csv);
    expect(p.errors).toEqual([]);
    expect(p.creates.investments).toHaveLength(12);
    expect(p.creates.valuations).toHaveLength(12);
    holdings.forEach(([symbol, name, market, units, price, value, aud, type], i) => {
      const inv = p.creates.investments[i]!;
      const val = p.creates.valuations[i]!;
      expect(inv).toMatchObject({ ticker: symbol, name, type, market, currency: market === "ASX" ? "AUD" : "USD" });
      expect([val.units, val.marketPrice, val.marketValue, val.marketValueAud, val.source]).toEqual([units, price, value, aud, "STAKE"]);
      expect(val.asAt).toEqual(D("2026-06-30"));
      expect(val.investmentId).toBe(inv.id);
    });
    // the portfolio total in A$ is unchanged by the round trip
    expect(Math.round(p.creates.valuations.reduce((s, v) => s + v.marketValueAud, 0) * 100) / 100).toBe(40157.4); // 32,620.68 (ASX) + 7,536.72 (Wall St, in A$)
  });
  it("importing it again changes nothing", () => {
    expect(totalToAdd(planOf(csv, afterImport(planOf(csv))))).toBe(0);
  });
});
