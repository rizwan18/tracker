import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  ALLOWED_EXTENSIONS,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  cleanFileName,
  contentDisposition,
  decodeUploadName,
  detectAttachmentKind,
  inspectAttachment,
  isPreviewable,
  maxAttachmentBytes,
} from "../lib/attachments";

const bytes = (...n: number[]) => new Uint8Array(n);
const text = (s: string) => new TextEncoder().encode(s);
const pad = (head: number[], total = 64) => Uint8Array.from([...head, ...new Array(Math.max(0, total - head.length)).fill(0x20)]);

const PDF = text("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const JPG = pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const GIF = text("GIF89a\x01\x00\x01\x00");
const OLE2 = pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 600);

/** Real zip files with the parts a genuine Office file has. */
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const DOCX = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>" });
const XLSX = zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>" });
const DOCM = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>", "word/vbaProject.bin": "macro" });
const XLSM = zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>", "xl/vbaProject.bin": "macro" });
const PPTX = zip({ "[Content_Types].xml": "<Types/>", "ppt/presentation.xml": "<p/>" });
const PLAIN_ZIP = zip({ "hello.txt": "hi" });

describe("detectAttachmentKind — believe the file's own bytes", () => {
  it("recognises PDF, JPG, PNG, WebP and GIF by signature, whatever the file is called", () => {
    expect(detectAttachmentKind(PDF, "invoice.pdf")).toEqual({ kind: "pdf" });
    expect(detectAttachmentKind(PDF, "no-extension")).toEqual({ kind: "pdf" });
    expect(detectAttachmentKind(JPG, "receipt.jpeg")).toEqual({ kind: "jpg" });
    expect(detectAttachmentKind(PNG, "scan.PNG")).toEqual({ kind: "png" });
    expect(detectAttachmentKind(WEBP, "photo.webp")).toEqual({ kind: "webp" });
    expect(detectAttachmentKind(GIF, "x.gif")).toEqual({ kind: "gif" });
    expect(detectAttachmentKind(PNG, "actually-a-png.pdf")).toEqual({ kind: "png" });
  });

  it("accepts a PDF with a little leading junk (some scanners add it) but not one that only mentions %PDF- far in", () => {
    expect(detectAttachmentKind(text("\r\n\r\n%PDF-1.4\n..."), "a.pdf")).toEqual({ kind: "pdf" });
    expect(detectAttachmentKind(text("x".repeat(2000) + "%PDF-1.4"), "a.pdf")).toMatchObject({ kind: null });
  });

  it("recognises real .docx and .xlsx files by their structure, and ignores the name", () => {
    expect(detectAttachmentKind(DOCX, "letter.docx")).toEqual({ kind: "docx" });
    expect(detectAttachmentKind(XLSX, "budget.xlsx")).toEqual({ kind: "xlsx" });
    expect(detectAttachmentKind(DOCX, "wrong-name.pdf")).toEqual({ kind: "docx" });
  });

  it("refuses macro-enabled Office files, other zips and corrupt zips", () => {
    expect(detectAttachmentKind(DOCM, "x.docx")).toEqual({ kind: null, reason: "MACROS" });
    expect(detectAttachmentKind(XLSM, "x.xlsx")).toEqual({ kind: null, reason: "MACROS" });
    expect(detectAttachmentKind(PPTX, "deck.pptx")).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectAttachmentKind(PLAIN_ZIP, "archive.zip")).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectAttachmentKind(pad([0x50, 0x4b, 0x03, 0x04], 40), "broken.docx")).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectAttachmentKind(zip({ "word/document.xml": "<w/>" }), "no-content-types.docx")).toEqual({ kind: null, reason: "UNSUPPORTED" }); // missing [Content_Types].xml
  });

  it("only reads a zip's table of contents (a tiny file claiming a huge payload is not unpacked)", () => {
    const big = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "A".repeat(5_000_000), "padding.txt": "B".repeat(5_000_000) });
    expect(big.length).toBeLessThan(50_000); // compresses to almost nothing
    const t0 = Date.now();
    expect(detectAttachmentKind(big, "bomb.docx")).toEqual({ kind: "docx" });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("tells legacy Word and Excel apart by name, and requires the name to fit", () => {
    expect(detectAttachmentKind(OLE2, "old.doc")).toEqual({ kind: "doc" });
    expect(detectAttachmentKind(OLE2, "OLD.XLS")).toEqual({ kind: "xls" });
    expect(detectAttachmentKind(OLE2, "deck.ppt")).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectAttachmentKind(OLE2, "mail.msg")).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectAttachmentKind(OLE2, "pretend.docx")).toEqual({ kind: null, reason: "WRONG_NAME" });
  });

  it("accepts CSV text (with or without a BOM, UTF-8 or Windows-1252) but only when named .csv", () => {
    expect(detectAttachmentKind(text("Date,Amount\n1/7/2026,10.00\n"), "export.csv")).toEqual({ kind: "csv" });
    expect(detectAttachmentKind(Uint8Array.from([0xef, 0xbb, 0xbf, ...text("a,b\n1,2")]), "excel.csv")).toEqual({ kind: "csv" });
    expect(detectAttachmentKind(Uint8Array.from([...text("Caf"), 0xe9, ...text(",1\n")]), "ansi.csv")).toEqual({ kind: "csv" }); // Windows-1252 "é"
    expect(detectAttachmentKind(text("Date,Amount\n"), "notes.txt")).toEqual({ kind: null, reason: "UNSUPPORTED" });
    expect(detectAttachmentKind(text("a,b\n1,2"), "no-extension")).toEqual({ kind: null, reason: "UNSUPPORTED" });
  });

  it("refuses web pages, scripts, SVG and executables however they are named", () => {
    for (const [content, name] of [
      ["<!doctype html><script>alert(1)</script>", "invoice.pdf"],
      ["<html><body>hi</body></html>", "receipt.csv"],
      ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "logo.png"],
      ["<?xml version='1.0'?><x/>", "data.csv"],
      ["  \n\t<script>alert(1)</script>", "x.csv"],
      ["MZ\x90\x00\x03", "setup.exe"],
      ["MZ\x90\x00\x03", "invoice.pdf"],
    ] as const) {
      expect(detectAttachmentKind(text(content), name), `${name}: ${content.slice(0, 12)}`).toMatchObject({ kind: null });
    }
    expect(detectAttachmentKind(Uint8Array.from([...text("a,b\n"), 0, 0, 1, 2]), "binary.csv")).toMatchObject({ kind: null }); // NUL bytes → not text
  });

  it("treats any other plain text named .csv as a CSV — that is all a CSV is — which is safe because it is only ever served as a download", () => {
    expect(detectAttachmentKind(text("#!/bin/sh\nrm -rf /"), "run.csv")).toEqual({ kind: "csv" });
    expect(inspectAttachment(text("#!/bin/sh\nrm -rf /"), "run.csv", 1000)).toMatchObject({ ok: true, contentType: "text/csv" });
    expect(isPreviewable("text/csv")).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(detectAttachmentKind(bytes(), "x.pdf")).toEqual({ kind: null, reason: "EMPTY" });
  });
});

describe("inspectAttachment — the whole decision", () => {
  it("accepts a good file and reports the type we worked out, not the one claimed", () => {
    const r = inspectAttachment(PDF, "Supplier invoice.pdf", 1_000_000);
    expect(r).toEqual({ ok: true, kind: "pdf", contentType: "application/pdf", fileName: "Supplier invoice.pdf" });
    expect(inspectAttachment(DOCX, "Contract.docx", 1_000_000)).toMatchObject({ ok: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(inspectAttachment(XLSX, "Costs.xlsx", 1_000_000)).toMatchObject({ ok: true, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  });

  it("rejects an oversized file before looking at it, with the limit in the message", () => {
    const r = inspectAttachment(new Uint8Array(3000), "big.pdf", 2048);
    expect(r).toMatchObject({ ok: false, code: "TOO_LARGE", status: 413 });
    expect(r.ok === false && r.message).toContain("under");
    expect(inspectAttachment(PDF, "ok.pdf", PDF.length)).toMatchObject({ ok: true }); // exactly at the limit is fine
    expect(inspectAttachment(PDF, "x.pdf", PDF.length - 1)).toMatchObject({ ok: false, code: "TOO_LARGE" });
  });

  it("gives plain-English reasons, with the right status codes", () => {
    expect(inspectAttachment(bytes(), "a.pdf", 1000)).toMatchObject({ ok: false, code: "EMPTY", status: 400 });
    expect(inspectAttachment(text("<html>"), "a.pdf", 1000)).toMatchObject({ ok: false, code: "UNSUPPORTED", status: 415 });
    expect(inspectAttachment(DOCM, "a.docx", 1_000_000)).toMatchObject({ ok: false, code: "MACROS", status: 415 });
    expect(inspectAttachment(OLE2, "a.docx", 1_000_000)).toMatchObject({ ok: false, code: "WRONG_NAME", status: 415 });
    const unsupported = inspectAttachment(text("<html>"), "a.pdf", 1000);
    expect(unsupported.ok === false && unsupported.message).toMatch(/PDF.*Word.*Excel.*CSV/);
  });
});

describe("cleanFileName — a safe name that matches what the file is", () => {
  it("keeps a good name, and a matching extension (including .jpeg)", () => {
    expect(cleanFileName("Invoice 123 — Acme Pty Ltd.pdf", "pdf")).toBe("Invoice 123 — Acme Pty Ltd.pdf");
    expect(cleanFileName("holiday.JPEG", "jpg")).toBe("holiday.jpeg");
    expect(cleanFileName("Q3 costs.xlsx", "xlsx")).toBe("Q3 costs.xlsx");
  });

  it("adds the right extension when it is missing or wrong, and keeps the odd one visible rather than hiding it", () => {
    expect(cleanFileName("receipt", "pdf")).toBe("receipt.pdf");
    expect(cleanFileName("scan.png", "pdf")).toBe("scan.png.pdf");
    expect(cleanFileName("invoice.exe", "pdf")).toBe("invoice.exe.pdf");
  });

  it("strips folders, quotes and path tricks", () => {
    expect(cleanFileName("../../etc/passwd.pdf", "pdf")).toBe("passwd.pdf");
    expect(cleanFileName("C:\\Users\\me\\Desktop\\bill.pdf", "pdf")).toBe("bill.pdf");
    expect(cleanFileName('a"b<c>d|e?f*.pdf', "pdf")).toBe("a_b_c_d_e_f_.pdf");
    expect(cleanFileName("..hidden.pdf", "pdf")).toBe("hidden.pdf");
    expect(cleanFileName("", "pdf")).toBe("attachment.pdf");
    expect(cleanFileName("....pdf", "pdf")).toBe("attachment.pdf");
  });

  it("removes control, zero-width and right-to-left-override characters used to disguise names", () => {
    expect(cleanFileName("report\u202Efdp.exe", "pdf")).not.toMatch(/\u202e/);
    expect(cleanFileName("a\u0000b\r\nc.pdf", "pdf")).toBe("abc.pdf");
    expect(cleanFileName("zero\u200bwidth.pdf", "pdf")).toBe("zerowidth.pdf");
  });

  it("limits the length", () => {
    expect(cleanFileName("x".repeat(500) + ".pdf", "pdf").length).toBeLessThanOrEqual(104);
  });

  it("does not turn markup into anything but plain text (the screen escapes it too)", () => {
    expect(cleanFileName("<img src=x onerror=alert(1)>.pdf", "pdf")).not.toMatch(/[<>]/);
  });
});

describe("decodeUploadName", () => {
  it("repairs UTF-8 names that arrive decoded as Latin-1, and leaves everything else alone", () => {
    expect(decodeUploadName(Buffer.from("Café — résumé.pdf", "utf8").toString("latin1"))).toBe("Café — résumé.pdf");
    expect(decodeUploadName("plain.pdf")).toBe("plain.pdf");
    expect(decodeUploadName("Café.pdf")).toBe("Café.pdf"); // already correct (cannot be valid UTF-8 re-read as Latin-1 → untouched)
    expect(decodeUploadName("日本語.pdf")).toBe("日本語.pdf");
  });
});

describe("contentDisposition", () => {
  it("quotes the name and carries accents in the UTF-8 form", () => {
    const h = contentDisposition("attachment", "Café invoice.pdf");
    expect(h).toBe(`attachment; filename="Caf_ invoice.pdf"; filename*=UTF-8''Caf%C3%A9%20invoice.pdf`);
  });
  it("cannot be broken out of by quotes, backslashes, percent signs or line breaks in a name", () => {
    const h = contentDisposition("inline", 'evil"; filename="x.exe\r\nSet-Cookie: a=b.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.match(/"/g)?.length).toBe(2); // exactly one quoted value
    expect(h.startsWith("inline;")).toBe(true);
  });
});

describe("limits and previews", () => {
  it("uses 4 MB by default (Vercel's request limit is ~4.5 MB) and honours a sensible ATTACHMENT_MAX_BYTES", () => {
    expect(maxAttachmentBytes({})).toBe(DEFAULT_MAX_ATTACHMENT_BYTES);
    expect(DEFAULT_MAX_ATTACHMENT_BYTES).toBeLessThan(4_500_000);
    expect(maxAttachmentBytes({ ATTACHMENT_MAX_BYTES: "10485760" })).toBe(10_485_760);
    expect(maxAttachmentBytes({ ATTACHMENT_MAX_BYTES: "banana" })).toBe(DEFAULT_MAX_ATTACHMENT_BYTES);
    expect(maxAttachmentBytes({ ATTACHMENT_MAX_BYTES: "10" })).toBe(DEFAULT_MAX_ATTACHMENT_BYTES); // absurdly small → default
    expect(maxAttachmentBytes({ ATTACHMENT_MAX_BYTES: "99999999999" })).toBe(25 * 1024 * 1024); // capped
  });
  it("only PDFs and pictures can be shown in the browser", () => {
    for (const t of ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]) expect(isPreviewable(t)).toBe(true);
    for (const t of ["text/csv", "application/msword", "text/html", "image/svg+xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) expect(isPreviewable(t)).toBe(false);
  });
  it("lists the formats people asked for", () => {
    for (const e of ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx", "csv"]) expect(ALLOWED_EXTENSIONS).toContain(e);
    for (const e of ["html", "htm", "svg", "js", "exe", "zip", "docm", "xlsm"]) expect(ALLOWED_EXTENSIONS).not.toContain(e);
  });
});
