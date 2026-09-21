import { FriendlyError } from "../../middleware/errorHandler";
import type { ParsedFile } from "./parseExport";
import { EXPORT_SCOPES, SECTION_LABELS, SECTION_ORDER, type ExportScope, type SectionName } from "./sections";

const PLACE: Record<Exclude<ExportScope, "all">, string> = { properties: "Properties page", investments: "Shares, ETFs & other investments page" };
const NOUN: Record<Exclude<ExportScope, "all">, string> = { properties: "property", investments: "investment" };

/**
 * Limits an already-parsed file to one portfolio. Anything else in the file is left out (and named,
 * so nothing is dropped silently); it can still be brought in from the "Your data" page.
 * Throws a friendly error when the file has nothing for this portfolio.
 */
export function restrictToScope(parsed: ParsedFile, scope: Exclude<ExportScope, "all">): { parsed: ParsedFile; ignored: SectionName[] } {
  const allowed = new Set<SectionName>(EXPORT_SCOPES[scope].sections);
  const withRows = SECTION_ORDER.filter((s) => (parsed.sections.get(s)?.length ?? 0) > 0);
  // `categories` only counts when something else in the scope needs it.
  const own = withRows.filter((s) => allowed.has(s) && s !== "categories");
  if (own.length === 0) {
    const others = withRows.map((s) => SECTION_LABELS[s].toLowerCase());
    throw new FriendlyError(
      `This file doesn't contain any ${NOUN[scope]} data.${others.length > 0 ? ` It has: ${others.join(", ")}.` : ""} Please choose a ${EXPORT_SCOPES[scope].label} CSV exported from the ${PLACE[scope]}, or a full backup from “Your data”.`,
      400
    );
  }

  const sections = new Map<SectionName, ParsedFile["sections"] extends Map<SectionName, infer R> ? R : never>();
  const headers = new Map<SectionName, string[]>();
  let totalRows = 0;
  for (const [name, rows] of parsed.sections) {
    if (!allowed.has(name)) continue;
    sections.set(name, rows);
    const h = parsed.headers.get(name);
    if (h) headers.set(name, h);
    totalRows += rows.length;
  }
  const ignored = withRows.filter((s) => !allowed.has(s));
  return { parsed: { sections, headers, unknownSections: parsed.unknownSections, totalRows }, ignored };
}

export function ignoredSectionsWarning(ignored: SectionName[], scope: Exclude<ExportScope, "all">): string | null {
  if (ignored.length === 0) return null;
  return `This file also contains ${ignored.map((s) => SECTION_LABELS[s].toLowerCase()).join(", ")}. Those weren't imported here — this import only covers your ${EXPORT_SCOPES[scope].label}. Use “Your data” to restore everything.`;
}
