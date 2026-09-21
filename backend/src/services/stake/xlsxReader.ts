import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

/**
 * A small, forgiving .xlsx reader: it pulls the text and numbers out of each sheet and ignores
 * everything else (styles, themes, formulas). That matters — some exports (Stake's, for one) contain
 * style definitions that stricter libraries reject outright, even though the data is perfectly fine.
 *
 * Safe on untrusted files: only the parts needed are unpacked, sizes are capped, and XML entities
 * are never expanded by the parser (the five basic ones are decoded by hand).
 */

export class XlsxError extends Error {}

export interface Sheet {
  name: string;
  /** Rows of cell text, starting at the sheet's first row; empty cells are "". */
  rows: string[][];
}

const MAX_PART_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_COLS = 60;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ["c", "row", "si", "t", "r", "sheet", "Relationship"].includes(name),
});

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeChar(code: number): string {
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
}

// Text nodes can be a plain string or an object (when they carry attributes like xml:space).
function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object") return textOf((node as Record<string, unknown>)["#text"]);
  return "";
}

/** "AB12" → column 27 (0-based). */
function columnIndex(ref: string): number {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseXml(bytes: Uint8Array): Record<string, any> {
  try {
    return parser.parse(strFromU8(bytes)) as Record<string, any>;
  } catch {
    throw new XlsxError("That spreadsheet couldn't be read — its contents look damaged.");
  }
}

export function readXlsx(bytes: Uint8Array): Sheet[] {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new XlsxError("That doesn't look like an Excel (.xlsx) file.");
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (f.originalSize > MAX_PART_BYTES) throw new XlsxError("That spreadsheet is too large to read.");
        return f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(f.name);
      },
    });
  } catch (err) {
    if (err instanceof XlsxError) throw err;
    throw new XlsxError("That doesn't look like a valid Excel (.xlsx) file.");
  }

  const workbookBytes = files["xl/workbook.xml"];
  if (!workbookBytes) throw new XlsxError("That doesn't look like a valid Excel (.xlsx) file.");

  // Shared strings (cells that hold text usually point into this list).
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    const sst = parseXml(files["xl/sharedStrings.xml"]).sst;
    for (const si of (sst?.si ?? []) as unknown[]) {
      const item = si as Record<string, unknown>;
      // Plain <t>, or rich text made of several <r><t> runs.
      const runs = Array.isArray(item.r) ? (item.r as Array<Record<string, unknown>>).map((r) => textOf(r.t)).join("") : textOf(item.t);
      shared.push(decodeXml(runs));
    }
  }

  const workbook = parseXml(workbookBytes).workbook;
  const relsBytes = files["xl/_rels/workbook.xml.rels"];
  const targets = new Map<string, string>();
  if (relsBytes) {
    for (const rel of (parseXml(relsBytes).Relationships?.Relationship ?? []) as Array<Record<string, string>>) {
      targets.set(rel["@_Id"] ?? "", rel["@_Target"] ?? "");
    }
  }

  const sheets: Sheet[] = [];
  for (const sh of (workbook?.sheets?.sheet ?? []) as Array<Record<string, string>>) {
    const name = decodeXml(sh["@_name"] ?? "");
    const target = targets.get(sh["@_id"] ?? "");
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const data = files[path];
    if (!data) continue;

    const sheetData = parseXml(data).worksheet?.sheetData;
    const grid = new Map<number, Map<number, string>>();
    let maxCol = -1;
    for (const row of (sheetData?.row ?? []) as Array<Record<string, any>>) {
      const rowIndex = Number(row["@_r"]) - 1;
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= MAX_ROWS) continue;
      for (const cell of (row.c ?? []) as Array<Record<string, any>>) {
        const col = columnIndex(String(cell["@_r"] ?? ""));
        if (col < 0 || col >= MAX_COLS) continue;
        const type = cell["@_t"];
        let value = "";
        if (type === "s") value = shared[Number(textOf(cell.v))] ?? "";
        else if (type === "inlineStr") value = decodeXml(textOf(cell.is?.t ?? (cell.is?.r ?? []).map((r: any) => textOf(r.t)).join("")));
        else if (type === "e") value = "";
        else value = decodeXml(textOf(cell.v));
        if (value === "") continue;
        const r = grid.get(rowIndex) ?? new Map<number, string>();
        r.set(col, value);
        grid.set(rowIndex, r);
        maxCol = Math.max(maxCol, col);
      }
    }
    const lastRow = grid.size === 0 ? -1 : Math.max(...grid.keys());
    const rows: string[][] = [];
    for (let i = 0; i <= lastRow; i++) {
      const r = grid.get(i);
      rows.push(Array.from({ length: maxCol + 1 }, (_, c) => r?.get(c) ?? ""));
    }
    sheets.push({ name, rows });
  }
  if (sheets.length === 0) throw new XlsxError("That spreadsheet doesn't contain any sheets.");
  return sheets;
}
