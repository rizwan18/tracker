import { unzipSync } from "fflate";

/**
 * Supporting files attached to company expenses (invoices, receipts, statements…).
 *
 * Everything here is pure (no storage, no database) so it can be tested exhaustively. The rule that matters most:
 * what a file *is* is decided from its own bytes on the server. The name and the content type the browser claimed
 * are never trusted, so a web page, script or SVG renamed to "invoice.pdf" can never be stored and served back.
 */

export type AttachmentKind = "pdf" | "jpg" | "png" | "webp" | "gif" | "doc" | "docx" | "xls" | "xlsx" | "csv";

interface KindInfo {
  contentType: string;
  /** Extensions we accept for this kind; the first one is the canonical one used when a name has none (or a wrong one). */
  extensions: string[];
  label: string;
  /** Safe to show in the browser (a PDF viewer or an <img>); everything else is download-only. */
  previewable: boolean;
}

export const ATTACHMENT_KINDS: Record<AttachmentKind, KindInfo> = {
  pdf: { contentType: "application/pdf", extensions: ["pdf"], label: "PDF", previewable: true },
  jpg: { contentType: "image/jpeg", extensions: ["jpg", "jpeg"], label: "JPG", previewable: true },
  png: { contentType: "image/png", extensions: ["png"], label: "PNG", previewable: true },
  webp: { contentType: "image/webp", extensions: ["webp"], label: "WebP", previewable: true },
  gif: { contentType: "image/gif", extensions: ["gif"], label: "GIF", previewable: true },
  doc: { contentType: "application/msword", extensions: ["doc"], label: "Word", previewable: false },
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"], label: "Word", previewable: false },
  xls: { contentType: "application/vnd.ms-excel", extensions: ["xls"], label: "Excel", previewable: false },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"], label: "Excel", previewable: false },
  csv: { contentType: "text/csv", extensions: ["csv"], label: "CSV", previewable: false },
};

/** Every extension people may choose, for the file picker and the "what's allowed" hint. */
export const ALLOWED_EXTENSIONS: string[] = Object.values(ATTACHMENT_KINDS).flatMap((k) => k.extensions);

export const DEFAULT_MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
/**
 * Vercel serverless functions reject request bodies over ~4.5 MB before the app ever sees them, so 4 MB is the
 * default. Anywhere without that limit (self-hosting) can raise it with ATTACHMENT_MAX_BYTES, up to this ceiling.
 */
const MAX_ATTACHMENT_BYTES_CEILING = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ENTRY = 20;

/** The per-file size limit: ATTACHMENT_MAX_BYTES when it is a sensible number, otherwise the default. */
export function maxAttachmentBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.ATTACHMENT_MAX_BYTES);
  if (!Number.isFinite(raw) || raw < 1024) return DEFAULT_MAX_ATTACHMENT_BYTES;
  return Math.min(Math.floor(raw), MAX_ATTACHMENT_BYTES_CEILING);
}

/** "4 MB", "1.5 MB" — for messages. */
export function formatMegabytes(bytes: number): string {
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb} MB`;
}

export const isPreviewable = (contentType: string): boolean => Object.values(ATTACHMENT_KINDS).some((k) => k.contentType === contentType && k.previewable);

export const kindLabel = (contentType: string): string => Object.values(ATTACHMENT_KINDS).find((k) => k.contentType === contentType)?.label ?? "File";

// ------------------------------------------------------------------------------------------ recognising a file

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** "%PDF-" within the first KB (the PDF specification allows a little leading junk, which some scanners emit). */
function looksLikePdf(b: Uint8Array): boolean {
  const head = b.subarray(0, 1024);
  const sig = ascii("%PDF-");
  for (let i = 0; i + sig.length <= head.length; i++) if (startsWith(head, sig, i)) return true;
  return false;
}

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .doc / .xls (also .ppt, .msg…, told apart by name below)

type ZipCheck = { kind: "docx" | "xlsx" } | { kind: null; reason: "NOT_OFFICE" | "MACROS" };

/**
 * A .docx/.xlsx is a ZIP of XML parts. Only the table of contents is read (nothing is unpacked), so a "zip bomb" can't
 * hurt. Macro-enabled files (.docm/.xlsm) carry a vbaProject.bin and are refused.
 */
function inspectOfficeZip(bytes: Uint8Array): ZipCheck {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    return { kind: null, reason: "NOT_OFFICE" };
  }
  const has = (n: string) => names.includes(n);
  if (!has("[Content_Types].xml")) return { kind: null, reason: "NOT_OFFICE" };
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) return { kind: null, reason: "MACROS" };
  if (has("word/document.xml")) return { kind: "docx" };
  if (has("xl/workbook.xml")) return { kind: "xlsx" };
  return { kind: null, reason: "NOT_OFFICE" };
}

/** Plain text, not a web page or binary in disguise: no control bytes in the first 8 KB and not starting with "<". */
function looksLikeCsv(b: Uint8Array): boolean {
  const head = b.subarray(0, 8192);
  for (const byte of head) {
    if (byte === 0 || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c)) return false;
  }
  let i = 0;
  if (startsWith(head, [0xef, 0xbb, 0xbf])) i = 3; // UTF-8 byte order mark (Excel writes one)
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)) i++;
  return head[i] !== 0x3c; // "<" → HTML / XML / SVG
}

const extensionOf = (name: string): string | null => {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())?.[1];
  return ext ? ext.toLowerCase() : null;
};

export type DetectResult = { kind: AttachmentKind } | { kind: null; reason: "EMPTY" | "UNSUPPORTED" | "MACROS" | "WRONG_NAME" };

/**
 * What an uploaded file really is, from its bytes. `name` is only used where the bytes alone can't say — a legacy
 * Word vs Excel file (both the same container) and CSV (plain text has no signature) — and must then agree.
 */
export function detectAttachmentKind(bytes: Uint8Array, name: string): DetectResult {
  if (bytes.length === 0) return { kind: null, reason: "EMPTY" };
  if (looksLikePdf(bytes)) return { kind: "pdf" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "jpg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "png" };
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return { kind: "webp" };
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return { kind: "gif" };

  const ext = extensionOf(name);
  if (startsWith(bytes, OLE2)) {
    if (ext === "doc") return { kind: "doc" };
    if (ext === "xls") return { kind: "xls" };
    return { kind: null, reason: ext === "docx" || ext === "xlsx" ? "WRONG_NAME" : "UNSUPPORTED" };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const zip = inspectOfficeZip(bytes);
    return zip.kind ? { kind: zip.kind } : { kind: null, reason: zip.reason === "MACROS" ? "MACROS" : "UNSUPPORTED" };
  }
  if (ext === "csv") return looksLikeCsv(bytes) ? { kind: "csv" } : { kind: null, reason: "UNSUPPORTED" };
  // A text file with some other (or no) extension is not accepted: only the types above.
  return { kind: null, reason: "UNSUPPORTED" };
}

// ------------------------------------------------------------------------------------------ names

/**
 * The upload library hands file names over decoded as Latin-1, while browsers send UTF-8, so "Café.pdf" arrives as
 * "CafÃ©.pdf". Undo that when (and only when) the result is clean UTF-8.
 */
export function decodeUploadName(raw: string): string {
  if (/[\u0080-\u00ff]/.test(raw) && !/[^\u0000-\u00ff]/.test(raw)) {
    const fixed = Buffer.from(raw, "latin1").toString("utf8");
    if (!fixed.includes("\uFFFD")) return fixed;
  }
  return raw;
}

// Control characters, plus zero-width and bidirectional-override characters that are used to disguise a file's real extension.
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * The name shown to people and used for downloads. It is cleaned (no path pieces, quotes, control or look-alike
 * characters), shortened, and always ends in an extension that matches what the file really is. It is never used
 * to build a storage path — see attachmentStorage.ts.
 */
export function cleanFileName(original: string, kind: AttachmentKind): string {
  const info = ATTACHMENT_KINDS[kind];
  let base = decodeUploadName(original ?? "").split(/[\\/]/).pop() ?? "";
  base = base.normalize("NFC").replace(HIDDEN_CHARS, "").trim();
  const ext = extensionOf(base);
  // Keep a matching extension (".jpeg" stays ".jpeg"); anything else is kept visible and the right one is added.
  let finalExt = info.extensions[0];
  if (ext && info.extensions.includes(ext)) {
    base = base.slice(0, -(ext.length + 1));
    finalExt = ext;
  }
  base = base
    .replace(/[<>:"|?*\\/]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 100)
    .trim();
  return `${base || "attachment"}.${finalExt}`;
}

const rfc5987 = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** A Content-Disposition value that can't be broken out of by a hostile name (quotes, newlines) and still carries accented names. */
export function contentDisposition(type: "attachment" | "inline", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${rfc5987(fileName)}`;
}

// ------------------------------------------------------------------------------------------ the whole check

export type AttachmentCheck =
  | { ok: true; kind: AttachmentKind; contentType: string; fileName: string }
  | { ok: false; code: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED" | "MACROS" | "WRONG_NAME"; status: number; message: string };

export const SUPPORTED_SUMMARY = "PDF, JPG, PNG, WebP, GIF, Word (.doc, .docx), Excel (.xls, .xlsx) and CSV files";

/** Decide whether uploaded bytes may be stored as an expense attachment, and under what name and content type. */
export function inspectAttachment(bytes: Uint8Array, originalName: string, maxBytes: number = maxAttachmentBytes()): AttachmentCheck {
  if (bytes.length > maxBytes) {
    return { ok: false, code: "TOO_LARGE", status: 413, message: `That file is too large. Please choose one under ${formatMegabytes(maxBytes)}.` };
  }
  const found = detectAttachmentKind(bytes, originalName);
  if (found.kind) return { ok: true, kind: found.kind, contentType: ATTACHMENT_KINDS[found.kind].contentType, fileName: cleanFileName(originalName, found.kind) };
  switch (found.reason) {
    case "EMPTY":
      return { ok: false, code: "EMPTY", status: 400, message: "That file is empty. Please choose a different one." };
    case "MACROS":
      return { ok: false, code: "MACROS", status: 415, message: "Files that contain macros can't be attached. Save a copy without macros (.docx or .xlsx) and try again." };
    case "WRONG_NAME":
      return { ok: false, code: "WRONG_NAME", status: 415, message: "That file looks like an older Office file with the wrong name. Open it and save it again as .docx or .xlsx, then try again." };
    default:
      return { ok: false, code: "UNSUPPORTED", status: 415, message: `That file type isn't supported. You can attach ${SUPPORTED_SUMMARY}.` };
  }
}
