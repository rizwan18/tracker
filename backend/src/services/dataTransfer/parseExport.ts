import { createHash } from "node:crypto";
import { FriendlyError } from "../../middleware/errorHandler";
import { parseCsv, unescapeFormula } from "../../lib/csv";
import { EXPORT_FORMAT_TITLE, EXPORT_FORMAT_VERSION, SECTION_ORDER, type SectionName } from "./sections";

export const MAX_IMPORT_ROWS = 25000;

export interface ParsedRow {
  /** Row number as a spreadsheet would show it (1-based, counting from the top of the file). */
  row: number;
  cells: Record<string, string>;
}

export interface ParsedFile {
  sections: Map<SectionName, ParsedRow[]>;
  /** The header names (lower-cased) each section was written with. */
  headers: Map<SectionName, string[]>;
  unknownSections: string[];
  totalRows: number;
}

const SECTION_MARKER = /^\[([a-z_]+)\]$/;

/** Reads the exported file into sections of header-keyed rows. Throws a friendly error if it isn't one of our files. */
export function parseExportFile(text: string): ParsedFile {
  const records = parseCsv(text);
  const first = records[0];
  if (!first || unescapeFormula(first[0] ?? "").trim() !== EXPORT_FORMAT_TITLE) {
    throw new FriendlyError("This doesn't look like a file exported from this app. Please choose the CSV you downloaded with “Export all my data”.", 400);
  }
  const version = Number(first[1]);
  if (Number.isFinite(version) && version > EXPORT_FORMAT_VERSION) {
    throw new FriendlyError("This file was made by a newer version of the app. Please update the app and try again.", 400);
  }

  const known = new Set<string>(SECTION_ORDER);
  const sections = new Map<SectionName, ParsedRow[]>();
  const headers = new Map<SectionName, string[]>();
  const unknownSections: string[] = [];
  let current: SectionName | null = null;
  let skipping = false;
  let header: string[] | null = null;
  let totalRows = 0;

  records.forEach((cells, index) => {
    const isBlank = cells.every((c) => c.trim() === "");
    if (isBlank) return;

    const marker = cells.slice(1).every((c) => c.trim() === "") ? SECTION_MARKER.exec((cells[0] ?? "").trim()) : null;
    const markerName = marker?.[1];
    if (markerName) {
      header = null;
      if (known.has(markerName)) {
        current = markerName as SectionName;
        skipping = false;
        if (!sections.has(current)) sections.set(current, []);
      } else {
        current = null;
        skipping = true;
        unknownSections.push(markerName);
      }
      return;
    }
    if (!current || skipping) return; // notes / metadata above the first section

    if (!header) {
      header = cells.map((c) => c.trim().toLowerCase());
      headers.set(current, header);
      return;
    }
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      if (name) record[name] = cells[i] ?? "";
    });
    totalRows++;
    sections.get(current)?.push({ row: index + 1, cells: record });
  });

  if (totalRows === 0) throw new FriendlyError("This file doesn't contain any data rows to import.", 400);
  if (totalRows > MAX_IMPORT_ROWS) throw new FriendlyError(`This file has ${totalRows.toLocaleString("en-AU")} rows, which is more than can be imported in one go (${MAX_IMPORT_ROWS.toLocaleString("en-AU")}).`, 400);
  return { sections, headers, unknownSections, totalRows };
}

/**
 * Stable id for a record that has no usable id of its own (or whose id already
 * belongs to somebody else's data). Deriving it from the household and the
 * original id makes importing the same file twice a no-op instead of creating
 * duplicates.
 */
export function deriveId(householdId: string, table: string, key: string): string {
  return "imp" + createHash("sha256").update(`${householdId}|${table}|${key}`).digest("hex").slice(0, 22);
}
