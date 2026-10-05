import { parseCsv, unescapeFormula } from "../../../lib/csv";
import { FriendlyError } from "../../../middleware/errorHandler";
import { EXPORT_FORMAT_TITLE } from "../sections";
import { normalise } from "./format";

/** One column of a human CSV: the heading we write, the other headings we also understand, and whether it must be there. */
export interface ColumnSpec {
  key: string;
  header: string;
  aliases?: string[];
  required?: boolean;
}

export interface TableRow {
  /** The row number as the person sees it in Excel (the heading row is row 1). */
  rowNumber: number;
  cells: Record<string, string>;
}

export interface ReadTable {
  rows: TableRow[];
  /** Headings in the file that we don't use (they're ignored, and the person is told). */
  ignoredColumns: string[];
  /** Which of our columns the file has. */
  present: Set<string>;
}

export const MAX_ROWS = 2000;

/**
 * Reads a human CSV into rows keyed by column. Headings are matched ignoring case, spaces and punctuation,
 * so "Paid from", "PAID FROM" and "paid_from" are the same. Blank lines are skipped (but still counted, so row
 * numbers match what Excel shows). Throws a plain-English error when the file can't be used at all.
 */
export function readTable(text: string, spec: ColumnSpec[], fileKind: string): ReadTable {
  const all = parseCsv(text);
  const headerAt = all.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerAt === -1) throw new FriendlyError("That file is empty. Please choose a CSV with a heading row and at least one transaction.", 400);

  const first = (all[headerAt]![0] ?? "").trim();
  if (first === EXPORT_FORMAT_TITLE || /^\[[a-z_]+\]$/.test(first)) {
    throw new FriendlyError("That is a full backup file, not an income & expenses file. Use “Restore from a backup” further down this page to import it.", 400);
  }

  const headers = all[headerAt]!.map((h) => h.trim());
  const byName = new Map<string, string>();
  for (const c of spec) for (const n of [c.header, c.key, ...(c.aliases ?? [])]) byName.set(normalise(n), c.key);

  const columnOf = new Map<string, number>();
  const ignoredColumns: string[] = [];
  headers.forEach((h, i) => {
    if (h === "") return;
    const key = byName.get(normalise(h));
    if (key && !columnOf.has(key)) columnOf.set(key, i);
    else ignoredColumns.push(h);
  });

  const missing = spec.filter((c) => c.required && !columnOf.has(c.key)).map((c) => c.header);
  if (missing.length > 0) {
    throw new FriendlyError(
      `Your file is missing the ${missing.map((m) => `“${m}”`).join(", ")} ${missing.length === 1 ? "column" : "columns"}. Download the template to see the columns to use.`,
      400
    );
  }

  const rows: TableRow[] = [];
  for (let i = headerAt + 1; i < all.length; i++) {
    const raw = all[i]!;
    if (raw.every((c) => c.trim() === "")) continue;
    const cells: Record<string, string> = {};
    for (const [key, col] of columnOf) cells[key] = unescapeFormula((raw[col] ?? "").trim());
    rows.push({ rowNumber: i + 1, cells });
  }
  if (rows.length === 0) throw new FriendlyError("That file has headings but no transactions. Add a row for each transaction and try again.", 400);
  if (rows.length > MAX_ROWS) throw new FriendlyError(`That file has ${rows.length.toLocaleString("en-AU")} rows. Please import up to ${MAX_ROWS.toLocaleString("en-AU")} at a time — split it into smaller files.`, 400);
  return { rows, ignoredColumns, present: new Set(columnOf.keys()) };
}

/** What the importer (and the preview) says about one row. */
export interface RowMessage {
  level: "error" | "warning" | "info";
  text: string;
}

export interface PlannedRow<T> {
  rowNumber: number;
  /** ready = will be imported · duplicate = matches something you already have · error = needs fixing first */
  status: "ready" | "duplicate" | "error";
  /** The row as it will be read — the values shown in the preview table. */
  cells: string[];
  messages: RowMessage[];
  record: T | null;
}
