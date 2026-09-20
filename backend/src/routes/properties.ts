import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import multer from "multer";
import { put, del } from "@vercel/blob";
import { propertySchema, propertyManagerSchema, scheduleLineSchema, scheduleDetailsSchema, financialYearIdSchema } from "../lib/validation";
import { MAX_PHOTOS_PER_PROPERTY, MAX_PHOTO_BYTES, MAX_THUMB_BYTES, detectImageType, safeFileName } from "../lib/images";
import { getCurrentFinancialYear } from "../lib/financialYear";
import { DEFAULT_RENTAL_SCHEDULE_LINES } from "../lib/constants";
import { findConflictingPpr, pprConflictMessage } from "../lib/propertyTypes";
import { canHavePpr } from "../lib/portfolios";
import { buildRentalSchedule, type ScheduleDirection, type ScheduleLineDef, type ScheduleTotalsRow } from "../services/rentalSchedule";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

/**
 * Business rule: a person can only have one principal place of residence (PPR).
 * Throws a friendly 409 if the signed-in person already owns a different PPR.
 */
async function assertNoOtherPpr(req: AuthedRequest, propertyId?: string) {
  // Across ALL of the person's portfolios — one PPR per person, wherever it's recorded.
  const owned = await prisma.property.findMany({
    where: { owners: { some: { userId: req.userId! } } },
    select: { id: true, name: true, propertyType: true },
  });
  const conflict = findConflictingPpr(owned, propertyId);
  if (conflict) throw new FriendlyError(pprConflictMessage(conflict.name), 409);
}

/** A principal place of residence can only be recorded in a Personal Finance portfolio. */
async function assertPortfolioAllowsPpr(householdId: string) {
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { portfolioType: true } });
  if (!household || !canHavePpr(household.portfolioType)) {
    throw new FriendlyError("A principal place of residence can only be recorded in a Personal Finance portfolio. Choose “Investment property” instead.", 400);
  }
}

function annualisedRent(rentAmount: number | null, rentFrequency: string | null): number {
  if (!rentAmount || !rentFrequency) return 0;
  switch (rentFrequency) {
    case "WEEKLY":
      return rentAmount * 52;
    case "FORTNIGHTLY":
      return rentAmount * 26;
    case "MONTHLY":
      return rentAmount * 12;
    default:
      return 0;
  }
}

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const properties = await prisma.property.findMany({ where: { householdId }, include: { owners: true }, orderBy: { createdAt: "asc" } });
    // The picture shown as each property's icon.
    const primaries = await prisma.propertyPhoto.findMany({ where: { propertyId: { in: properties.map((p) => p.id) }, isPrimary: true }, select: { id: true, propertyId: true } });
    const primaryByProperty = new Map(primaries.map((p) => [p.propertyId, p.id]));
    res.json(properties.map((p) => ({ ...p, primaryPhotoId: primaryByProperty.get(p.id) ?? null })));
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const data = propertySchema.parse(req.body);
    if (data.propertyType === "PPR") {
      await assertPortfolioAllowsPpr(householdId);
      await assertNoOtherPpr(req);
    }
    const property = await prisma.property.create({
      data: {
        householdId,
        ...data,
        owners: { create: { userId: req.userId!, percentage: 100 } },
      },
      include: { owners: true },
    });
    res.status(201).json(property);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const property = await prisma.property.findFirst({ where: { id: req.params.id, householdId }, include: { owners: true } });
    if (!property) throw new FriendlyError("We couldn't find this property.", 404);
    res.json(property);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.property.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this property.", 404);
    const data = propertySchema.partial().parse(req.body);
    if (data.propertyType === "PPR" && existing.propertyType !== "PPR") {
      await assertPortfolioAllowsPpr(householdId);
      await assertNoOtherPpr(req, existing.id);
    }
    const property = await prisma.property.update({ where: { id: existing.id }, data });
    res.json(property);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await prisma.property.findFirst({ where: { id: req.params.id, householdId } });
    if (!existing) throw new FriendlyError("We couldn't find this property.", 404);
    const photos = await prisma.propertyPhoto.findMany({ where: { propertyId: existing.id } });
    await prisma.property.delete({ where: { id: existing.id } });
    // Remove the stored image files too (best effort — the property is already gone).
    await Promise.all(photos.flatMap((ph) => [ph.filePath, ph.thumbPath]).filter((u): u is string => !!u).map((u) => del(u).catch(() => undefined)));
    res.json({ message: "Property removed." });
  })
);

router.get(
  "/:id/summary",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const property = await prisma.property.findFirst({ where: { id: req.params.id, householdId } });
    if (!property) throw new FriendlyError("We couldn't find this property.", 404);

    const financialYear = (req.query.financialYear as string) || getCurrentFinancialYear().id;

    const [incomeAgg, expenseAgg, expenseByCategory] = await Promise.all([
      prisma.transaction.aggregate({ where: { propertyId: property.id, direction: "INCOME", financialYear }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { propertyId: property.id, direction: "EXPENSE", financialYear }, _sum: { amount: true } }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { propertyId: property.id, direction: "EXPENSE", financialYear },
        _sum: { amount: true },
      }),
    ]);

    const rentalIncome = incomeAgg._sum.amount ?? 0;
    const expenses = expenseAgg._sum.amount ?? 0;
    const netRentalIncome = rentalIncome - expenses;
    const annualRent = annualisedRent(property.rentAmount, property.rentFrequency);
    const rentalYield =
      property.currentEstimatedValue && property.currentEstimatedValue > 0 ? (annualRent / property.currentEstimatedValue) * 100 : null;
    const estimatedEquity =
      property.currentEstimatedValue !== null && property.loanBalance !== null
        ? property.currentEstimatedValue - property.loanBalance
        : null;

    const categoryIds = expenseByCategory.map((c: { categoryId: string | null }) => c.categoryId).filter((id: string | null): id is string => !!id);
    const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } });
    const categoryMap = new Map(categories.map((c: { id: string; name: string }) => [c.id, c.name]));

    const [primaryPhoto, photoCount] = await Promise.all([
      prisma.propertyPhoto.findFirst({ where: { propertyId: property.id, isPrimary: true }, select: { id: true } }),
      prisma.propertyPhoto.count({ where: { propertyId: property.id } }),
    ]);

    res.json({
      property: { ...property, primaryPhotoId: primaryPhoto?.id ?? null, photoCount },
      financialYear,
      rentalIncome,
      expenses,
      netRentalIncome,
      annualisedRentalIncome: annualRent,
      rentalYield,
      estimatedEquity,
      majorExpenses: expenseByCategory
        .map((c: { categoryId: string | null; _sum: { amount: number | null } }) => ({
          category: c.categoryId ? categoryMap.get(c.categoryId) ?? "Uncategorised" : "Uncategorised",
          amount: c._sum.amount ?? 0,
        }))
        .sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount),
    });
  })
);

// ---------------------------------------------------------------------------
// Rental income & expenses schedule (per property, per financial year)
// ---------------------------------------------------------------------------

async function findOwnedProperty(req: AuthedRequest) {
  const householdId = householdOf(req);
  const property = await prisma.property.findFirst({ where: { id: req.params.id, householdId }, include: { owners: true } });
  if (!property) throw new FriendlyError("We couldn't find this property.", 404);
  return { householdId, property };
}

/** Find the household's category by name/direction, creating it if it doesn't exist yet. */
async function findOrCreateCategory(householdId: string, name: string, direction: ScheduleDirection): Promise<{ id: string }> {
  const existing = await prisma.category.findFirst({ where: { householdId, name, direction } });
  if (existing) return existing;
  return prisma.category.create({ data: { householdId, name, direction, isCustom: true } });
}

/** First time a property's schedule is opened, give it the standard set of lines. */
async function ensureDefaultScheduleLines(householdId: string, propertyId: string) {
  const data: Array<{ propertyId: string; categoryId: string; label: string; isManual: boolean; sortOrder: number }> = [];
  for (const [index, def] of DEFAULT_RENTAL_SCHEDULE_LINES.entries()) {
    const category = await findOrCreateCategory(householdId, def.categoryName, def.direction);
    data.push({ propertyId, categoryId: category.id, label: def.label, isManual: def.isManual ?? false, sortOrder: index });
  }
  await prisma.propertyScheduleLine.createMany({ data, skipDuplicates: true });
  await prisma.property.update({ where: { id: propertyId }, data: { scheduleInitialised: true } });
}

router.get(
  "/:id/schedule",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, property } = await findOwnedProperty(req);
    const financialYear = financialYearIdSchema.catch(getCurrentFinancialYear().id).parse(req.query.financialYear);

    if (!property.scheduleInitialised) await ensureDefaultScheduleLines(householdId, property.id);

    const [lineRecords, groups, yearDetail, allCategories] = await Promise.all([
      prisma.propertyScheduleLine.findMany({ where: { propertyId: property.id }, include: { category: true } }),
      prisma.transaction.groupBy({
        by: ["categoryId", "direction"],
        where: { propertyId: property.id, financialYear },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.propertyYearDetail.findUnique({ where: { propertyId_financialYear: { propertyId: property.id, financialYear } } }),
      prisma.category.findMany({ where: { householdId }, orderBy: [{ direction: "asc" }, { name: "asc" }] }),
    ]);

    type LineRecord = { id: string; categoryId: string; label: string | null; isManual: boolean; sortOrder: number; category: { name: string; direction: string } };
    const lines: ScheduleLineDef[] = (lineRecords as LineRecord[]).map((l) => ({
      id: l.id,
      categoryId: l.categoryId,
      name: l.label?.trim() || l.category.name,
      direction: l.category.direction as ScheduleDirection,
      isManual: l.isManual,
      sortOrder: l.sortOrder,
    }));

    const rows: ScheduleTotalsRow[] = (
      groups as Array<{ categoryId: string | null; direction: string; _sum: { amount: number | null }; _count: { _all: number } }>
    ).map((g) => ({
      categoryId: g.categoryId,
      direction: g.direction as ScheduleDirection,
      total: g._sum.amount ?? 0,
      count: g._count._all,
    }));

    const categoryNames = new Map<string, string>((allCategories as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
    const owner = property.owners.find((o: { userId: string }) => o.userId === req.userId) ?? property.owners[0];
    const ownershipPercentage = owner?.percentage ?? 100;

    const schedule = buildRentalSchedule(lines, rows, categoryNames, ownershipPercentage);

    // Categories the user could still add as a line (not already on this property's list).
    const usedCategoryIds = new Set(lines.map((l) => l.categoryId));
    const availableCategories = (allCategories as Array<{ id: string; name: string; direction: string }>)
      .filter((c) => !usedCategoryIds.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, direction: c.direction }));

    res.json({
      property: { id: property.id, name: property.name },
      financialYear,
      details: {
        ownershipPercentage,
        availableForRentDate: property.availableForRentDate,
        weeksRented: yearDetail?.weeksRented ?? null,
      },
      ...schedule,
      availableCategories,
    });
  })
);

router.put(
  "/:id/schedule/details",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, property } = await findOwnedProperty(req);
    const data = scheduleDetailsSchema.parse(req.body);

    if (data.weeksRented !== undefined) {
      await prisma.propertyYearDetail.upsert({
        where: { propertyId_financialYear: { propertyId: property.id, financialYear: data.financialYear } },
        create: { propertyId: property.id, financialYear: data.financialYear, weeksRented: data.weeksRented },
        update: { weeksRented: data.weeksRented },
      });
    }
    if (data.ownershipPercentage !== undefined) {
      // Taking a share in someone else's PPR would give this person a second one.
      if (property.propertyType === "PPR" && !property.owners.some((o: { userId: string }) => o.userId === req.userId)) {
        await assertNoOtherPpr(req, property.id);
      }
      await prisma.propertyOwnership.upsert({
        where: { propertyId_userId: { propertyId: property.id, userId: req.userId! } },
        create: { propertyId: property.id, userId: req.userId!, percentage: data.ownershipPercentage },
        update: { percentage: data.ownershipPercentage },
      });
    }
    if (data.availableForRentDate !== undefined) {
      await prisma.property.update({ where: { id: property.id }, data: { availableForRentDate: data.availableForRentDate } });
    }
    res.json({ message: "Saved." });
  })
);

router.post(
  "/:id/schedule/lines",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, property } = await findOwnedProperty(req);
    const data = scheduleLineSchema.parse(req.body);

    let categoryId = data.categoryId;
    if (categoryId) {
      const category = await prisma.category.findFirst({ where: { id: categoryId, householdId } });
      if (!category) throw new FriendlyError("We couldn't find that category.", 404);
    } else {
      categoryId = (await findOrCreateCategory(householdId, data.name!, data.direction!)).id;
    }

    const existing = await prisma.propertyScheduleLine.findUnique({ where: { propertyId_categoryId: { propertyId: property.id, categoryId } } });
    if (existing) return res.json(existing);

    const last = await prisma.propertyScheduleLine.aggregate({ where: { propertyId: property.id }, _max: { sortOrder: true } });
    const line = await prisma.propertyScheduleLine.create({
      data: {
        propertyId: property.id,
        categoryId,
        label: data.label?.trim() || null,
        isManual: data.isManual ?? false,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(line);
  })
);

router.delete(
  "/:id/schedule/lines/:lineId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { property } = await findOwnedProperty(req);
    const line = await prisma.propertyScheduleLine.findFirst({ where: { id: req.params.lineId, propertyId: property.id } });
    if (!line) throw new FriendlyError("We couldn't find that line.", 404);
    // Only the line is removed from this property's list — recorded transactions are untouched.
    await prisma.propertyScheduleLine.delete({ where: { id: line.id } });
    res.json({ message: "Line removed from the list." });
  })
);

// ---------------------------------------------------------------------------
// Property manager (managing agent) details
// ---------------------------------------------------------------------------
router.put(
  "/:id/manager",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { property } = await findOwnedProperty(req);
    const data = propertyManagerSchema.parse(req.body);
    const updated = await prisma.property.update({ where: { id: property.id }, data });
    res.json({
      managerName: updated.managerName,
      managerCompany: updated.managerCompany,
      managerEmail: updated.managerEmail,
      managerPhone: updated.managerPhone,
      managerAddress: updated.managerAddress,
      managerNotes: updated.managerNotes,
    });
  })
);

// ---------------------------------------------------------------------------
// Property pictures
// ---------------------------------------------------------------------------
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 2 } }).fields([
  { name: "file", maxCount: 1 },
  { name: "thumb", maxCount: 1 },
]);

function receivePhotoUpload(req: AuthedRequest, res: Parameters<typeof photoUpload>[1]): Promise<void> {
  return new Promise((resolve, reject) => {
    photoUpload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return reject(new FriendlyError("That picture is too large. Please choose one under 3.5 MB.", 413));
      }
      reject(new FriendlyError("We couldn't read that upload. Please try a different picture.", 400));
    });
  });
}

const photoDto = (p: { id: string; fileName: string; isPrimary: boolean; createdAt: Date }) => ({ id: p.id, fileName: p.fileName, isPrimary: p.isPrimary, createdAt: p.createdAt.toISOString() });

router.get(
  "/:id/photos",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { property } = await findOwnedProperty(req);
    const photos = await prisma.propertyPhoto.findMany({ where: { propertyId: property.id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
    res.json({ photos: photos.map(photoDto), max: MAX_PHOTOS_PER_PROPERTY });
  })
);

router.post(
  "/:id/photos",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { householdId, property } = await findOwnedProperty(req);
    await receivePhotoUpload(req, res);

    const files = req.files as { file?: Express.Multer.File[]; thumb?: Express.Multer.File[] } | undefined;
    const full = files?.file?.[0];
    if (!full) throw new FriendlyError("Please choose a picture to upload.", 400);
    const type = detectImageType(full.buffer);
    if (!type) throw new FriendlyError("That doesn't look like a picture. Please choose a JPG, PNG or WebP image.", 400);

    const thumbFile = files?.thumb?.[0];
    const thumbType = thumbFile && thumbFile.size <= MAX_THUMB_BYTES ? detectImageType(thumbFile.buffer) : null;

    const existing = await prisma.propertyPhoto.count({ where: { propertyId: property.id } });
    if (existing >= MAX_PHOTOS_PER_PROPERTY) {
      throw new FriendlyError(`A property can have up to ${MAX_PHOTOS_PER_PROPERTY} pictures. Remove one to add another.`, 400);
    }

    const fileName = safeFileName(full.originalname, type);
    const folder = `property-photos/${householdId}/${property.id}`;
    const blob = await put(`${folder}/${fileName}`, full.buffer, { access: "public", contentType: type });
    let thumbUrl: string | null = null;
    if (thumbFile && thumbType) {
      thumbUrl = (await put(`${folder}/thumb-${fileName}`, thumbFile.buffer, { access: "public", contentType: thumbType })).url;
    }

    const photo = await prisma.propertyPhoto.create({
      data: { propertyId: property.id, fileName, contentType: type, filePath: blob.url, thumbPath: thumbUrl, isPrimary: existing === 0 },
    });
    res.status(201).json(photoDto(photo));
  })
);

router.get(
  "/:id/photos/:photoId/image",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { property } = await findOwnedProperty(req);
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: req.params.photoId, propertyId: property.id } });
    if (!photo) throw new FriendlyError("We couldn't find that picture.", 404);
    const url = req.query.size === "thumb" && photo.thumbPath ? photo.thumbPath : photo.filePath;
    const stored = await fetch(url);
    if (!stored.ok) throw new FriendlyError("This picture is no longer available.", 404);
    const bytes = Buffer.from(await stored.arrayBuffer());
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    // Only this person's browser may cache it; the id never changes what the picture is.
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(bytes);
  })
);

router.post(
  "/:id/photos/:photoId/primary",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { property } = await findOwnedProperty(req);
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: req.params.photoId, propertyId: property.id } });
    if (!photo) throw new FriendlyError("We couldn't find that picture.", 404);
    await prisma.$transaction([
      prisma.propertyPhoto.updateMany({ where: { propertyId: property.id }, data: { isPrimary: false } }),
      prisma.propertyPhoto.update({ where: { id: photo.id }, data: { isPrimary: true } }),
    ]);
    res.json({ message: "This is now the main picture." });
  })
);

router.delete(
  "/:id/photos/:photoId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { property } = await findOwnedProperty(req);
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: req.params.photoId, propertyId: property.id } });
    if (!photo) throw new FriendlyError("We couldn't find that picture.", 404);
    await prisma.propertyPhoto.delete({ where: { id: photo.id } });
    await Promise.all([photo.filePath, photo.thumbPath].filter((u): u is string => !!u).map((u) => del(u).catch(() => undefined)));
    // If the main picture was removed, promote the oldest remaining one.
    if (photo.isPrimary) {
      const next = await prisma.propertyPhoto.findFirst({ where: { propertyId: property.id }, orderBy: { createdAt: "asc" } });
      if (next) await prisma.propertyPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    res.json({ message: "Picture removed." });
  })
);

export default router;
