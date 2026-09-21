import { readXlsx, XlsxError, type Sheet } from "./xlsxReader";

/**
 * Reads a Stake "Portfolio Valuation" report (.xlsx).
 *
 * Layout (as exported by Stake):
 *   Summary sheet         — lines such as "Statement Date: 2026-06-30", "Default currency: AUD"
 *   Aus Equities          — Symbol | Name | Weighting | Units | Mkt. Price | Mkt. Value
 *   Wall St Equities      — Symbol | Name | Weighting | Units | Mkt. Price | Mkt. Value (US$) | Mkt. Value (A$)
 * Sheets are recognised by their column headings, so extra or renamed sheets don't matter.
 */

export type StakeMarket = "ASX" | "WALL_ST";

export interface StakeHolding {
  market: StakeMarket;
  /** Currency the price and market value are in. */
  currency: "AUD" | "USD";
  symbol: string;
  name: string;
  /** Weighting as printed in the report (percent of the whole portfolio), if present. */
  weightingPercent: number | null;
  units: number;
  marketPrice: number;
  /** Market value in `currency`. */
  marketValue: number;
  /** Market value in Australian dollars. */
  marketValueAud: number;
  sourceSheet: string;
  sourceRow: number;
}

export interface StakeReport {
  reportType: string | null;
  ownerName: string | null;
  /** yyyy-mm-dd */
  statementDate: string | null;
  generatedOn: string | null;
  defaultCurrency: string | null;
  holdings: StakeHolding[];
  warnings: string[];
}

export class StakeParseError extends Error {}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.replace(/[$,\s%]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-06-30" or "21/09/2026" → "2026-06-30". */
export function toIsoDay(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function readSummary(sheets: Sheet[]): Pick<StakeReport, "reportType" | "ownerName" | "statementDate" | "generatedOn" | "defaultCurrency"> {
  const out = { reportType: null as string | null, ownerName: null as string | null, statementDate: null as string | null, generatedOn: null as string | null, defaultCurrency: null as string | null };
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const text = (row[0] ?? "").trim();
      const m = /^([^:]{2,40}):\s*(.+)$/.exec(text);
      if (!m) continue;
      const key = norm(m[1] ?? "");
      const value = (m[2] ?? "").trim();
      if (key === "reporttype") out.reportType = out.reportType ?? value;
      else if (key === "name") out.ownerName = out.ownerName ?? value;
      else if (key === "statementdate") out.statementDate = out.statementDate ?? toIsoDay(value);
      else if (key === "dategenerated") out.generatedOn = out.generatedOn ?? toIsoDay(value);
      else if (key === "defaultcurrency") out.defaultCurrency = out.defaultCurrency ?? value.toUpperCase();
    }
  }
  if (!out.statementDate && out.reportType) {
    const asAt = /as at\s+(\S+)/i.exec(out.reportType)?.[1];
    out.statementDate = toIsoDay(asAt);
  }
  return out;
}

function isHoldingsSheet(headers: string[]) {
  return headers.includes("symbol") && headers.includes("units") && headers.includes("mktprice");
}

export function parseStakeSheets(sheets: Sheet[]): StakeReport {
  const summary = readSummary(sheets);
  const warnings: string[] = [];
  const holdings: StakeHolding[] = [];
  let sawHoldingsSheet = false;

  for (const sheet of sheets) {
    const headerRow = sheet.rows[0];
    if (!headerRow) continue;
    const headers = headerRow.map(norm);
    if (!isHoldingsSheet(headers)) continue;
    sawHoldingsSheet = true;

    const col = (name: string) => headers.indexOf(name);
    const cSymbol = col("symbol");
    const cName = col("name");
    const cWeight = col("weighting");
    const cUnits = col("units");
    const cPrice = col("mktprice");
    // Wall St sheets carry both currencies; Australian sheets just "Mkt. Value".
    const cUsd = col("mktvalueus");
    const cAud = col("mktvaluea");
    const cPlain = col("mktvalue");
    const isUs = cUsd >= 0;
    const cValue = isUs ? cUsd : cPlain;
    if (cValue < 0) {
      warnings.push(`The “${sheet.name}” sheet has no market value column, so it was skipped.`);
      continue;
    }
    if (isUs && cAud < 0) warnings.push(`The “${sheet.name}” sheet has no A$ value column, so values can't be converted to Australian dollars.`);
    const market: StakeMarket = isUs ? "WALL_ST" : "ASX";
    const seen = new Set<string>();

    sheet.rows.slice(1).forEach((row, i) => {
      const rowNo = i + 2;
      const symbol = (row[cSymbol] ?? "").trim().toUpperCase();
      if (!symbol) return;
      const where = `${sheet.name}, row ${rowNo} (${symbol})`;
      if (seen.has(symbol)) {
        warnings.push(`${where}: appears more than once — only the first is used.`);
        return;
      }
      const units = parseNumber(row[cUnits]);
      const price = parseNumber(row[cPrice]);
      const value = parseNumber(row[cValue]);
      const aud = isUs ? (cAud >= 0 ? parseNumber(row[cAud]) : null) : value;
      if (units === null || price === null || value === null || aud === null) {
        warnings.push(`${where}: skipped — units, price or market value isn't a number.`);
        return;
      }
      if (units < 0 || price < 0 || value < 0 || aud < 0) {
        warnings.push(`${where}: skipped — negative amounts aren't supported.`);
        return;
      }
      if (Math.abs(units * price - value) > Math.max(0.05, value * 0.005)) {
        warnings.push(`${where}: units × price doesn't match the market value — please check it.`);
      }
      if (isUs && value > 0) {
        const fx = aud / value;
        if (fx < 0.2 || fx > 5) warnings.push(`${where}: the A$ value looks wrong compared with the US$ value.`);
      }
      seen.add(symbol);
      holdings.push({
        market,
        currency: isUs ? "USD" : "AUD",
        symbol,
        name: (row[cName] ?? "").trim() || symbol,
        weightingPercent: cWeight >= 0 ? parseNumber(row[cWeight]) : null,
        units,
        marketPrice: price,
        marketValue: value,
        marketValueAud: aud,
        sourceSheet: sheet.name,
        sourceRow: rowNo,
      });
    });
  }

  if (!sawHoldingsSheet) {
    throw new StakeParseError("This doesn't look like a Stake portfolio valuation report — I couldn't find a sheet with Symbol, Units and Mkt. Price columns.");
  }
  if (summary.defaultCurrency && summary.defaultCurrency !== "AUD") {
    throw new StakeParseError(`This report is in ${summary.defaultCurrency}. Only reports in Australian dollars (AUD) can be imported.`);
  }
  if (!summary.statementDate) {
    throw new StakeParseError("I couldn't find the statement date in this report. Please export the Portfolio Valuation report from Stake again.");
  }
  if (holdings.length === 0) throw new StakeParseError("No holdings were found in this report.");
  return { ...summary, holdings, warnings };
}

/** Reads the uploaded file's bytes. Throws StakeParseError with a friendly message for anything unreadable. */
export function parseStakeReport(bytes: Uint8Array): StakeReport {
  try {
    return parseStakeSheets(readXlsx(bytes));
  } catch (err) {
    if (err instanceof XlsxError) throw new StakeParseError(err.message);
    throw err;
  }
}
