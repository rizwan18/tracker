import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readXlsx, XlsxError } from "../services/stake/xlsxReader";
import { parseStakeReport, parseStakeSheets, parseNumber, toIsoDay, StakeParseError } from "../services/stake/parseStakeReport";
import { findMatch, investmentTypeFor, planStakeImport, type ExistingInvestment } from "../services/stake/planStakeImport";
import { computeWeightings, currentValueOf, valueHolding } from "../services/holdings";
import { investmentSchema, investmentValuationSchema } from "../lib/validation";

type Cell = string | number | null;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colName = (i: number) => String.fromCharCode(65 + i);

/**
 * Builds a small .xlsx in the same shape Stake produces — including its habit of writing
 * a style with horizontal="Center" (capital C), which strict readers such as openpyxl reject.
 */
function makeXlsx(sheets: Array<{ name: string; rows: Cell[][] }>, opts: { inline?: boolean } = {}): Uint8Array {
  const shared: string[] = [];
  const idx = (s: string) => {
    let i = shared.indexOf(s);
    if (i < 0) i = shared.push(s) - 1;
    return i;
  };
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => {
            if (v === null || v === "") return "";
            const ref = `${colName(c)}${r + 1}`;
            if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
            if (opts.inline) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
            return `<c r="${ref}" t="s" s="4"><v>${idx(v)}</v></c>`;
          })
          .join("");
        return cells ? `<row r="${r + 1}">${cells}</row>` : "";
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 2}" r:id="rId${i + 4}"/>`)
        .join("")}</sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 4}" Type="worksheet" Target="worksheets/sheet${i + 2}.xml"/>`)
        .join("")}</Relationships>`
    ),
    "xl/styles.xml": strToU8('<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf><alignment horizontal="Center"/></xf></cellXfs></styleSheet>'),
  };
  sheetXml.forEach((x, i) => (files[`xl/worksheets/sheet${i + 2}.xml`] = strToU8(x)));
  if (!opts.inline) files["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  return zipSync(files);
}

const summary = (over: string[] = []) => [
  ["Report Type: Portfolio Valuation as at 2026-06-30"],
  ["Name: JANE CITIZEN"],
  ["Statement Date: 2026-06-30"],
  ["Date Generated: 21/09/2026"],
  ["Default currency: AUD"],
  ...over.map((x) => [x]),
];
const ausHeader = ["Symbol", "Name", "Weighting", "Units", "Mkt. Price", "Mkt. Value"];
const usHeader = ["Symbol", "Name", "Weighting", "Units", "Mkt. Price", "Mkt. Value (US$)", "Mkt. Value (A$)"];

function stakeFile(extra: { aus?: Cell[][]; us?: Cell[][]; summary?: Cell[][] } = {}) {
  return makeXlsx([
    { name: "Disclaimers", rows: [["Notes"], ["This statement contains a summary…"]] },
    { name: "Summary", rows: extra.summary ?? summary() },
    { name: "Aus Equities", rows: [ausHeader, ...(extra.aus ?? [["ABC", "ABC LTD-ORDINARY", "60.00%", "1000", "3", "3000"], ["VAS", "VANGUARD AUS SHARES ETF-ETF UNITS", "40.00%", "20", "100", "2000"]])] },
    { name: "Wall St Equities", rows: [usHeader, ...(extra.us ?? [["AAPL", "Apple", "10.00%", "2", "250", "500", "750"]])] },
  ]);
}

describe("readXlsx", () => {
  it("reads sheets and cells even though the styles are 'invalid' (horizontal=\"Center\")", () => {
    const sheets = readXlsx(makeXlsx([{ name: "A", rows: [["x", "y"], ["1", 2]] }]));
    expect(sheets).toEqual([{ name: "A", rows: [["x", "y"], ["1", "2"]] }]);
  });

  it("decodes XML entities in text and sheet names (S&P, <, quotes)", () => {
    const sheets = readXlsx(makeXlsx([{ name: "R&D <2026>", rows: [["ISHARES S&P 500 ETF", 'say "hi" & <go>']] }]));
    expect(sheets[0]!.name).toBe("R&D <2026>");
    expect(sheets[0]!.rows[0]).toEqual(["ISHARES S&P 500 ETF", 'say "hi" & <go>']);
  });

  it("supports inline strings and keeps gaps in sparse rows and missing rows", () => {
    const sheets = readXlsx(makeXlsx([{ name: "S", rows: [["a", null, "c"], [], ["d"]] }], { inline: true }));
    expect(sheets[0]!.rows).toEqual([["a", "", "c"], ["", "", ""], ["d", "", ""]]);
  });

  it("reads rich-text shared strings as one string", () => {
    const files = {
      "xl/workbook.xml": strToU8('<workbook xmlns="x" xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8('<sst><si><r><t>Hello </t></r><r><t>World</t></r></si></sst>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'),
    };
    expect(readXlsx(zipSync(files))[0]!.rows).toEqual([["Hello World"]]);
  });

  it("refuses things that aren't spreadsheets, with a plain message", () => {
    expect(() => readXlsx(strToU8("hello,world\n1,2"))).toThrow(XlsxError);
    expect(() => readXlsx(strToU8("hello"))).toThrow(/Excel \(\.xlsx\)/);
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(/valid Excel/);
    expect(() => readXlsx(zipSync({ "readme.txt": strToU8("no workbook here") }))).toThrow(/valid Excel/);
  });

  it("refuses a workbook whose parts are absurdly large", () => {
    const big = zipSync({ "xl/workbook.xml": strToU8("<workbook/>"), "xl/worksheets/sheet1.xml": new Uint8Array(21 * 1024 * 1024) });
    expect(() => readXlsx(big)).toThrow(/too large/);
  });
});

describe("number and date parsing", () => {
  it("parses plain, formatted and percent numbers", () => {
    expect(parseNumber("12042.96")).toBe(12042.96);
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber("10.96%")).toBe(10.96);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });
  it("reads ISO and day/month/year dates, rejecting impossible ones", () => {
    expect(toIsoDay("2026-06-30")).toBe("2026-06-30");
    expect(toIsoDay("21/09/2026")).toBe("2026-09-21");
    expect(toIsoDay("31/02/2026")).toBeNull();
    expect(toIsoDay("soon")).toBeNull();
  });
});

describe("parseStakeReport", () => {
  it("reads both sheets: Australian equities in A$ and Wall St equities in US$ with A$ values", () => {
    const r = parseStakeReport(stakeFile());
    expect(r).toMatchObject({ statementDate: "2026-06-30", generatedOn: "2026-09-21", defaultCurrency: "AUD", ownerName: "JANE CITIZEN", warnings: [] });
    expect(r.holdings).toHaveLength(3);
    expect(r.holdings[0]).toMatchObject({ market: "ASX", currency: "AUD", symbol: "ABC", name: "ABC LTD-ORDINARY", weightingPercent: 60, units: 1000, marketPrice: 3, marketValue: 3000, marketValueAud: 3000 });
    expect(r.holdings[2]).toMatchObject({ market: "WALL_ST", currency: "USD", symbol: "AAPL", units: 2, marketPrice: 250, marketValue: 500, marketValueAud: 750 });
  });

  it("finds the sheets by their headings, not their names", () => {
    const file = makeXlsx([{ name: "Summary", rows: summary() }, { name: "My ASX shares", rows: [ausHeader, ["XYZ", "XYZ CORP", "100%", "10", "2", "20"]] }]);
    expect(parseStakeReport(file).holdings.map((h) => h.symbol)).toEqual(["XYZ"]);
  });

  it("copes with numbers stored as text and as real numbers", () => {
    const r = parseStakeReport(stakeFile({ aus: [["ABC", "ABC", "100%", 1000, 3, 3000]], us: [] }));
    expect(r.holdings[0]).toMatchObject({ units: 1000, marketPrice: 3, marketValue: 3000 });
  });

  it("warns about odd rows but keeps the good ones", () => {
    const r = parseStakeReport(
      stakeFile({
        aus: [
          ["OK", "OK LTD", "50%", "10", "2", "20"],
          ["BAD", "Not numbers", "", "ten", "2", "20"],
          ["NEG", "Negative", "", "-5", "2", "-10"],
          ["OK", "Dupe", "", "1", "1", "1"],
          ["MIS", "Mismatch", "", "10", "2", "50"],
        ],
        us: [["FX", "Odd fx", "", "10", "1", "10", "500"]],
      })
    );
    expect(r.holdings.map((h) => h.symbol)).toEqual(["OK", "MIS", "FX"]);
    const w = r.warnings.join("\n");
    expect(w).toContain("BAD");
    expect(w).toContain("negative");
    expect(w).toContain("more than once");
    expect(w).toContain("units × price");
    expect(w).toContain("A$ value looks wrong");
  });

  it("falls back to the date in the report type line when there's no statement date row", () => {
    const r = parseStakeReport(stakeFile({ summary: [["Report Type: Portfolio Valuation as at 2026-03-31"], ["Default currency: AUD"]] }));
    expect(r.statementDate).toBe("2026-03-31");
  });

  it("refuses a report in another currency, one with no date, and files that aren't a holdings report", () => {
    expect(() => parseStakeReport(stakeFile({ summary: summary().map((r) => (r[0]!.startsWith("Default") ? ["Default currency: USD"] : r)) }))).toThrow(/in USD/);
    expect(() => parseStakeReport(stakeFile({ summary: [["Name: X"], ["Default currency: AUD"]] }))).toThrow(/statement date/);
    expect(() => parseStakeReport(makeXlsx([{ name: "Trades", rows: [["Date", "Amount"], ["2026-01-01", "5"]] }]))).toThrow(StakeParseError);
    expect(() => parseStakeReport(makeXlsx([{ name: "Trades", rows: [["Date", "Amount"]] }]))).toThrow(/doesn't look like a Stake/);
    expect(() => parseStakeReport(stakeFile({ aus: [], us: [] }))).toThrow(/No holdings/);
    expect(() => parseStakeReport(strToU8("just text"))).toThrow(/Excel/);
  });
});

describe("holdings helpers", () => {
  it("prefers a statement valuation, then a manual override, then units × last price", () => {
    expect(currentValueOf({ valuation: { marketValueAud: 500 }, override: 900, quantity: 10, lastPrice: 2 })).toBe(500);
    expect(currentValueOf({ valuation: null, override: 900, quantity: 10, lastPrice: 2 })).toBe(900);
    expect(currentValueOf({ valuation: null, override: null, quantity: 10, lastPrice: 2 })).toBe(20);
  });
  it("weightings are each holding's share of the total, to two decimals — and add up to ~100", () => {
    const w = computeWeightings([{ id: "a", valueAud: 4400 }, { id: "b", valueAud: 12042.96 }, { id: "c", valueAud: 23714.44 }]);
    expect(w.get("a")).toBe(10.96);
    expect(w.get("b")).toBe(29.99);
    expect([...w.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(100, 1);
    expect(computeWeightings([{ id: "z", valueAud: 0 }]).get("z")).toBe(0);
  });
  it("values a US holding in US$ only (no conversion) unless an exchange rate is supplied", () => {
    expect(valueHolding(2, 289.36, "USD", 1.4444)).toEqual({ marketValue: 578.72, marketValueAud: 835.9 });
    expect(valueHolding(2, 289.36, "USD", null)).toEqual({ marketValue: 578.72, marketValueAud: 578.72 });
    expect(valueHolding(2, 289.36, "USD")).toEqual({ marketValue: 578.72, marketValueAud: 578.72 });
    expect(valueHolding(417, 28.88, "AUD", null)).toEqual({ marketValue: 12042.96, marketValueAud: 12042.96 });
  });
});

const inv = (o: Partial<ExistingInvestment> & { id: string }): ExistingInvestment => ({ name: "X", ticker: null, type: "SHARE", market: null, currency: "AUD", createdAt: new Date("2025-01-01"), latest: null, ...o });

describe("planStakeImport", () => {
  const report = parseStakeReport(stakeFile());

  it("creates what's new, and types ETFs by their name", () => {
    const plan = planStakeImport(report, [], [], { zeroMissing: true });
    expect(plan.counts).toEqual({ create: 3, update: 0, unchanged: 0, zeroed: 0 });
    expect(plan.rows.map((r) => [r.holding.symbol, r.investmentType])).toEqual([["ABC", "SHARE"], ["VAS", "ETF"], ["AAPL", "SHARE"]]);
    expect(investmentTypeFor("ISHARES S&P 500 ETF-ETF UNITS")).toBe("ETF");
    expect(investmentTypeFor("Apple")).toBe("SHARE");
  });

  it("matches by symbol and market: a legacy record (no market) is an ASX holding", () => {
    const existing = [inv({ id: "1", ticker: "abc", name: "My ABC" }), inv({ id: "2", ticker: "AAPL", market: null })];
    const plan = planStakeImport(report, existing, [], { zeroMissing: true });
    const byTicker = Object.fromEntries(plan.rows.map((r) => [r.holding.symbol, r]));
    expect(byTicker.ABC).toMatchObject({ action: "update", investmentId: "1", existingName: "My ABC" });
    expect(byTicker.AAPL!.action).toBe("create");          // an unlabelled record isn't assumed to be the US one
    expect(byTicker.VAS!.action).toBe("create");
  });

  it("the same symbol on both markets stays two investments", () => {
    const existing = [inv({ id: "us", ticker: "IVV", market: "WALL_ST", currency: "USD" }), inv({ id: "au", ticker: "IVV", market: "ASX" })];
    expect(findMatch(existing, { symbol: "IVV", market: "ASX" })!.id).toBe("au");
    expect(findMatch(existing, { symbol: "IVV", market: "WALL_ST" })!.id).toBe("us");
    expect(findMatch([], { symbol: "IVV", market: "ASX" })).toBeNull();
  });

  it("importing the same statement again is a no-op", () => {
    const existing = [inv({ id: "1", ticker: "ABC", market: "ASX" })];
    const same = [{ investmentId: "1", units: 1000, marketPrice: 3, marketValueAud: 3000 }];
    const plan = planStakeImport(report, existing, same, { zeroMissing: true });
    expect(plan.rows.find((r) => r.holding.symbol === "ABC")!.action).toBe("unchanged");
    const changed = planStakeImport(report, existing, [{ ...same[0]!, units: 900 }], { zeroMissing: true });
    expect(changed.rows.find((r) => r.holding.symbol === "ABC")!.action).toBe("update");
  });

  it("lists earlier Stake holdings that are missing from a newer statement, and can zero them", () => {
    const existing = [
      inv({ id: "gone", ticker: "OLD", name: "Old Co", market: "ASX", latest: { asAt: new Date("2026-03-31T00:00:00Z"), source: "STAKE" } }),
      inv({ id: "manual", ticker: "MAN", market: "ASX", latest: { asAt: new Date("2026-03-31T00:00:00Z"), source: "MANUAL" } }),
      inv({ id: "future", ticker: "NEW", market: "ASX", latest: { asAt: new Date("2026-09-30T00:00:00Z"), source: "STAKE" } }),
    ];
    const on = planStakeImport(report, existing, [], { zeroMissing: true });
    expect(on.missing.map((m) => m.investmentId)).toEqual(["gone"]);   // manual holdings and newer ones are left alone
    expect(on.counts.zeroed).toBe(1);
    const off = planStakeImport(report, existing, [], { zeroMissing: false });
    expect(off.missing).toHaveLength(1);
    expect(off.counts.zeroed).toBe(0);
  });

  it("warns when the statement is older than what's already recorded", () => {
    const existing = [inv({ id: "1", ticker: "ABC", market: "ASX", latest: { asAt: new Date("2026-08-31T00:00:00Z"), source: "STAKE" } })];
    expect(planStakeImport(report, existing, [], { zeroMissing: true }).warnings.join(" ")).toContain("older than the latest value");
  });
});

describe("validation", () => {
  it("investments can carry a market and currency (default A$)", () => {
    expect(investmentSchema.parse({ name: "Apple", type: "SHARE", market: "WALL_ST", currency: "USD" })).toMatchObject({ market: "WALL_ST", currency: "USD" });
    expect(investmentSchema.parse({ name: "BHP", type: "SHARE" }).currency).toBe("AUD");
    expect(investmentSchema.safeParse({ name: "X", type: "SHARE", market: "LSE" }).success).toBe(false);
    expect(investmentSchema.partial().parse({ name: "Renamed" })).not.toHaveProperty("currency");
  });
  it("a manual valuation needs a date, non-negative units and price", () => {
    expect(investmentValuationSchema.safeParse({ asAt: "2026-06-30", units: 10, marketPrice: 2.5 }).success).toBe(true);
    expect(investmentValuationSchema.safeParse({ asAt: "2026-06-30", units: -1, marketPrice: 2 }).success).toBe(false);
    expect(investmentValuationSchema.safeParse({ asAt: "2026-06-30", units: 1, marketPrice: 2, fxRate: 0 }).success).toBe(false);
  });
});
