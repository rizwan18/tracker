import { Response, Router } from "express";
import multer from "multer";
import { pipeline } from "node:stream/promises";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { requireCompanyPortfolio, householdOf } from "../middleware/requireCompanyPortfolio";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { ALLOWED_EXTENSIONS, MAX_ATTACHMENTS_PER_ENTRY, SUPPORTED_SUMMARY, contentDisposition, formatMegabytes, inspectAttachment, isPreviewable, maxAttachmentBytes } from "../lib/attachments";
import { newStoragePath, openFile, removeFile, saveFile } from "../lib/attachmentStorage";

/**
 * Supporting files (invoices, receipts, statements…) for company expenses.
 *
 *   GET    /api/business/attachment-limits                          what's allowed (size, count, types) — for the form
 *   GET    /api/business/entries/:entryId/attachments               list an expense's files
 *   POST   /api/business/entries/:entryId/attachments               add ONE file (multipart field "file")
 *   GET    /api/business/entries/:entryId/attachments/:id/download  the file itself (?inline=1 to view a PDF/picture)
 *   DELETE /api/business/entries/:entryId/attachments/:id           remove one file (the expense is untouched)
 *
 * Every route needs a signed-in member of a Company Finance portfolio, and every query is scoped to that portfolio, so a
 * file is only ever reachable from an expense in the portfolio the person has open. An id from another portfolio — or
 * one that doesn't exist — gets the same "couldn't find it" answer. Files are uploaded one per request because
 * Vercel limits a request to ~4.5 MB; the browser sends them one after another and shows each one's result.
 *
 * Each route lists its guards itself (rather than a router-wide `use`) so this router adds no cost to the other
 * /api/business routes that share the prefix.
 */
const router = Router();
const guard = [requireAuth, requireCompanyPortfolio];

/** The expense the files belong to — in the caller's portfolio, and an expense (not a sale). */
async function ownedExpense(req: AuthedRequest) {
  const householdId = householdOf(req);
  const entry = await prisma.businessEntry.findFirst({ where: { id: req.params.entryId, householdId }, select: { id: true, kind: true } });
  if (!entry) throw new FriendlyError("We couldn't find that expense.", 404);
  return { householdId, entry };
}

type AttachmentRow = { id: string; entryId: string; fileName: string; contentType: string; sizeBytes: number; createdAt: Date };

/** What the browser is told about a file. Deliberately has no storage key, portfolio id or uploader. */
const attachmentDto = (a: AttachmentRow) => ({
  id: a.id,
  entryId: a.entryId,
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: a.sizeBytes,
  uploadedAt: a.createdAt.toISOString(),
  previewable: isPreviewable(a.contentType),
});

const publicColumns = { id: true, entryId: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true } as const;

router.get(
  "/attachment-limits",
  ...guard,
  asyncHandler(async (_req: AuthedRequest, res) => {
    res.json({ maxBytes: maxAttachmentBytes(), maxFiles: MAX_ATTACHMENTS_PER_ENTRY, extensions: ALLOWED_EXTENSIONS, summary: SUPPORTED_SUMMARY });
  })
);

router.get(
  "/entries/:entryId/attachments",
  ...guard,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, entry } = await ownedExpense(req);
    const rows = await prisma.businessEntryAttachment.findMany({ where: { entryId: entry.id, householdId }, select: publicColumns, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    res.json({ items: rows.map(attachmentDto) });
  })
);

/** Reads the one uploaded file into memory, turning the upload library's errors into plain-English ones. */
function receiveUpload(req: AuthedRequest, res: Response, maxBytes: number): Promise<void> {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 4, parts: 6 } }).single("file");
  return new Promise((resolve, reject) => {
    upload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") return reject(new FriendlyError(`That file is too large. Please choose one under ${formatMegabytes(maxBytes)}.`, 413));
        if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_PART_COUNT") return reject(new FriendlyError("Please upload one file at a time.", 400));
      }
      reject(new FriendlyError("We couldn't read that upload. Please try again.", 400));
    });
  });
}

router.post(
  "/entries/:entryId/attachments",
  ...guard,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Everything that can be checked without the file is checked first, so a request that is going to be refused
    // never has its body read and nothing is ever stored for it.
    const { householdId, entry } = await ownedExpense(req);
    if (entry.kind !== "EXPENSE") throw new FriendlyError("Files can only be attached to expenses.", 400);
    const existing = await prisma.businessEntryAttachment.count({ where: { entryId: entry.id, householdId } });
    if (existing >= MAX_ATTACHMENTS_PER_ENTRY) {
      throw new FriendlyError(`An expense can have up to ${MAX_ATTACHMENTS_PER_ENTRY} files. Remove one to add another.`, 409);
    }

    const maxBytes = maxAttachmentBytes();
    await receiveUpload(req, res, maxBytes);
    const file = req.file;
    if (!file) throw new FriendlyError("Please choose a file to upload.", 400);

    // The server decides what the file is, from its bytes. The type the browser claimed is ignored.
    const check = inspectAttachment(file.buffer, file.originalname, maxBytes);
    if (!check.ok) throw new FriendlyError(check.message, check.status);

    // 1) store the file, 2) record it. If recording fails the file is removed again, and if storing fails nothing is
    // recorded — so there is never a record without a file, and a failed upload leaves no stray file behind.
    let storageKey: string;
    try {
      storageKey = await saveFile(newStoragePath(householdId, entry.id, check.fileName.split(".").pop()!.toLowerCase()), file.buffer, check.contentType);
    } catch (err) {
      console.error("Attachment upload to storage failed:", err instanceof Error ? err.message : err);
      throw new FriendlyError("We couldn't store that file just now. Please try again.", 502);
    }
    try {
      const row = await prisma.businessEntryAttachment.create({
        data: { householdId, entryId: entry.id, fileName: check.fileName, contentType: check.contentType, sizeBytes: file.size, storageKey, uploadedById: req.userId! },
        select: publicColumns,
      });
      res.status(201).json(attachmentDto(row));
    } catch (err) {
      await removeFile(storageKey).catch((cleanupErr) => console.error(`Could not remove stored attachment ${storageKey}:`, cleanupErr instanceof Error ? cleanupErr.message : cleanupErr));
      console.error("Saving attachment record failed:", err instanceof Error ? err.message : err);
      throw new FriendlyError("We couldn't save that file. Please try again.", 500);
    }
  })
);

/** One file, looked up through the expense and the portfolio together. */
async function findAttachment(req: AuthedRequest) {
  const householdId = householdOf(req);
  const row = await prisma.businessEntryAttachment.findFirst({ where: { id: req.params.attachmentId, entryId: req.params.entryId, householdId } });
  if (!row) throw new FriendlyError("We couldn't find that file.", 404);
  return row;
}

router.get(
  "/entries/:entryId/attachments/:attachmentId/download",
  ...guard,
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = await findAttachment(req);
    const stream = await openFile(row.storageKey).catch((err) => {
      console.error("Attachment read from storage failed:", err instanceof Error ? err.message : err);
      return null;
    });
    if (!stream) throw new FriendlyError("This file isn't available right now. Please try again later.", 404);

    // Only PDFs and pictures may be shown in the browser; anything else is always a download. The stored content type
    // is the one we worked out from the bytes at upload, and nosniff stops a browser second-guessing it.
    const inline = req.query.inline === "1" && isPreviewable(row.contentType);
    res.setHeader("Content-Type", row.contentType);
    res.setHeader("Content-Disposition", contentDisposition(inline ? "inline" : "attachment", row.fileName));
    res.setHeader("Content-Length", String(row.sizeBytes));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    try {
      await pipeline(stream, res);
    } catch (err) {
      // Nothing has been sent yet → a normal error reply. Part-way through → all we can do is cut the connection.
      if (!res.headersSent) throw err;
      res.destroy();
    }
  })
);

router.delete(
  "/entries/:entryId/attachments/:attachmentId",
  ...guard,
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = await findAttachment(req);
    // The file goes first: "removed" must mean the file is really gone, since these can be sensitive. If storage can't
    // be reached the record stays, nothing is lost, and the person can simply try again. (Deleting an already-missing
    // file is not an error, so a retry after a half-finished attempt completes cleanly.)
    try {
      await removeFile(row.storageKey);
    } catch (err) {
      console.error("Attachment removal from storage failed:", err instanceof Error ? err.message : err);
      throw new FriendlyError("We couldn't remove that file just now. Please try again.", 502);
    }
    await prisma.businessEntryAttachment.delete({ where: { id: row.id } });
    res.json({ message: "File removed." });
  })
);

export default router;
