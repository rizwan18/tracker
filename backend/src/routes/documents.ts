import { Router } from "express";
import multer from "multer";
import { put, del } from "@vercel/blob";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";

const router = Router();
router.use(requireAuth);

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/jpg"]);

// Vercel serverless functions have no persistent local disk — files are
// buffered in memory (documents are capped at 15MB, so this is cheap) and
// uploaded straight to Vercel Blob storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error("Only PDF, JPG and PNG files can be attached."));
    }
    cb(null, true);
  },
});

router.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
    if (!req.file) throw new FriendlyError("Please choose a file to upload.");

    const { transactionId, propertyId, investmentId, dividendId, capitalGainDisposalId, sourcingRecordId } = req.body as Record<string, string | undefined>;

    // Blob pathnames are namespaced by household and given a random suffix
    // by Vercel Blob (addRandomSuffix defaults to true), so they aren't
    // guessable — but the *only* URL the app ever hands back to a client is
    // this authenticated download route below, never the raw blob URL, so
    // one household can never be handed a link to another's receipt.
    const blob = await put(`receipts/${req.householdId}/${Date.now()}-${req.file.originalname}`, req.file.buffer, {
      access: "public",
      contentType: req.file.mimetype,
    });

    const document = await prisma.document.create({
      data: {
        householdId: req.householdId,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        filePath: blob.url,
        transactionId: transactionId || null,
        propertyId: propertyId || null,
        investmentId: investmentId || null,
        dividendId: dividendId || null,
        capitalGainDisposalId: capitalGainDisposalId || null,
        sourcingRecordId: sourcingRecordId || null,
      },
    });
    res.status(201).json(document);
  })
);

router.get(
  "/:id/download",
  asyncHandler(async (req: AuthedRequest, res) => {
    const document = await prisma.document.findFirst({ where: { id: req.params.id, householdId: req.householdId ?? undefined } });
    if (!document) throw new FriendlyError("We couldn't find this document.", 404);

    // Fetch the blob server-side and stream it back rather than redirecting,
    // so the browser only ever sees this authenticated app URL — never the
    // underlying blob storage URL.
    const blobResponse = await fetch(document.filePath);
    if (!blobResponse.ok || !blobResponse.body) {
      throw new FriendlyError("This file is no longer available.", 404);
    }

    res.setHeader("Content-Type", document.fileType);
    res.setHeader("Content-Disposition", `attachment; filename="${document.fileName.replace(/"/g, "")}"`);

    const reader = blobResponse.body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(value);
      return pump();
    };
    await pump();
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const document = await prisma.document.findFirst({ where: { id: req.params.id, householdId: req.householdId ?? undefined } });
    if (!document) throw new FriendlyError("We couldn't find this document.", 404);
    await del(document.filePath).catch(() => {
      // If the blob was already removed (or storage is briefly unavailable),
      // don't block the user from clearing the orphaned database record.
    });
    await prisma.document.delete({ where: { id: document.id } });
    res.json({ message: "Document removed." });
  })
);

export default router;
