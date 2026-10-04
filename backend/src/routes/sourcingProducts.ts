import { Router } from "express";
import multer from "multer";
import { put, del } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { requireCompanyPortfolio, householdOf } from "../middleware/requireCompanyPortfolio";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { sourcingProductSchema } from "../lib/validation";
import { MAX_PHOTO_BYTES, MAX_THUMB_BYTES, checkImageUpload, detectImageType, safeFileName } from "../lib/images";
import { toAudEstimateCents } from "../services/business/sourcing";
import { childrenInclude, summaryDto } from "../services/business/sourcingDto";
import { ensureProductsBackfilled, findOwnedProduct, skuTaken } from "../services/business/products";
import { parseDay } from "../services/business/ledgerStore";

/** Company Finance → Products/SKU: the product master, its picture, and the sourcing orders under it. */
const router = Router();
router.use(requireAuth, requireCompanyPortfolio);

type ProductWithOrders = Prisma.SourcingProductGetPayload<{ include: { orders: { include: typeof childrenInclude } } }>;

const byNewest = (a: { orderDate: string | null; createdAt: string }, b: { orderDate: string | null; createdAt: string }) =>
  (b.orderDate ?? "").localeCompare(a.orderDate ?? "") || b.createdAt.localeCompare(a.createdAt);

/** The product with its orders summarised: how many, and the current cost per unit / selling price from the latest live order. */
function productDto(p: ProductWithOrders) {
  const orders = p.orders.map((o) => summaryDto(o)).sort(byNewest);
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const latest = live[0] ?? null;
  return {
    id: p.id, name: p.name, sku: p.sku, description: p.description,
    hasImage: !!p.imagePath, imageVersion: p.imageUpdatedAt ? p.imageUpdatedAt.getTime() : 0, imageFileName: p.imageFileName,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
    orderCount: orders.length,
    openOrderCount: orders.filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED").length,
    latest: latest && {
      orderId: latest.id, status: latest.status, supplierName: latest.supplierName, quantity: latest.quantity, currency: latest.currency, orderDate: latest.orderDate,
      totalCostCents: latest.totalCostCents,
      costPerUnitCents: latest.pricing.unit.ok ? latest.pricing.unit.costPerUnitCents : null,
      sellingPricePerUnitCents: latest.pricing.unit.ok ? latest.pricing.unit.sellingPricePerUnitCents : null,
      targetMarginPercent: latest.pricing.targetMarginPercent,
    },
    orders,
  };
}

const withOrders = { orders: { include: childrenInclude } } satisfies Prisma.SourcingProductInclude;

async function loadProduct(householdId: string, id: string) {
  const product = await prisma.sourcingProduct.findFirst({ where: { id, householdId }, include: withOrders });
  if (!product) throw new FriendlyError("We couldn't find that product.", 404);
  return product;
}

/** A SKU may only be used once per household (ignoring case), so one SKU never points at two products. */
async function assertSkuFree(householdId: string, sku: string | null, exceptId?: string) {
  if (!sku) return;
  const others = await prisma.sourcingProduct.findMany({ where: { householdId, sku: { not: null } }, select: { id: true, sku: true, name: true } });
  const clash = others.find((p) => p.id !== exceptId && skuTaken([p], sku));
  if (clash) throw new FriendlyError(`The SKU “${sku}” is already used by “${clash.name}”. Each product needs its own SKU.`, 409);
}

/** The :id in the path (always present on these routes; checked so a missing one is a clean 404). */
const idOf = (req: AuthedRequest): string => {
  const id = req.params.id;
  if (!id) throw new FriendlyError("We couldn't find that product.", 404);
  return id;
};

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
const SKU_CLASH = "That SKU is already used by another product. Each product needs its own SKU.";

// --------------------------------------------------------------------------- list & create
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureProductsBackfilled(prisma, householdId);

    const origin = req.query.origin === "OVERSEAS" || req.query.origin === "LOCAL" ? req.query.origin : undefined;
    const status = typeof req.query.status === "string" && req.query.status !== "ALL" ? req.query.status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to, true);

    // The origin / status / date filters keep the products that have at least one matching order.
    const orderFilter: Prisma.SourcingRecordWhereInput = {
      ...(origin ? { origin } : {}),
      ...(status ? { status } : {}),
      ...(from || to ? { orderDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const filteringOrders = Object.keys(orderFilter).length > 0;
    // Search: the product's own name / SKU / description, or any of its orders' item, supplier, reference or country.
    // Plain `contains` (no `mode`), the same portable convention the Sourcing list always used.
    const textFilter: Prisma.SourcingProductWhereInput | undefined = q
      ? {
          OR: [
            { name: { contains: q } }, { sku: { contains: q } }, { description: { contains: q } },
            { orders: { some: { OR: [{ itemDescription: { contains: q } }, { supplierName: { contains: q } }, { reference: { contains: q } }, { supplierCountry: { contains: q } }] } } },
          ],
        }
      : undefined;

    const rows = await prisma.sourcingProduct.findMany({
      where: { householdId, AND: [...(filteringOrders ? [{ orders: { some: orderFilter } }] : []), ...(textFilter ? [textFilter] : [])] },
      include: withOrders,
      orderBy: { name: "asc" },
    });
    const items = rows.map(productDto);

    const orders = items.flatMap((i) => i.orders);
    const open = orders.filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED");
    const active = orders.filter((o) => o.status !== "CANCELLED");
    res.json({
      // The list shows the product rows; each product's orders are on its own page.
      items: items.map(({ orders: _orders, ...item }) => item),
      totals: {
        productCount: items.length,
        openCount: open.length,
        totalCostAudEstCents: active.reduce((s, o) => s + o.totalCostAudEstCents, 0),
        paidAudEstCents: active.reduce((s, o) => s + toAudEstimateCents(o.paidCents, o.currency, o.exchangeRateToAud), 0),
        balanceAudEstCents: active.reduce((s, o) => s + o.balanceAudEstCents, 0),
      },
    });
  })
);

/** Light list for pickers (e.g. moving an order to another product). Must stay above "/:id". */
router.get(
  "/options",
  asyncHandler(async (req: AuthedRequest, res) => {
    const products = await prisma.sourcingProduct.findMany({ where: { householdId: householdOf(req) }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" } });
    res.json(products);
  })
);

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const data = sourcingProductSchema.parse(req.body);
    await assertSkuFree(householdId, data.sku);
    try {
      const created = await prisma.sourcingProduct.create({ data: { householdId, createdById: req.userId!, ...data }, include: withOrders });
      res.status(201).json(productDto(created));
    } catch (err) {
      if (isUniqueViolation(err)) throw new FriendlyError(SKU_CLASH, 409);
      throw err;
    }
  })
);

// --------------------------------------------------------------------------- one product
router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    await ensureProductsBackfilled(prisma, householdId);
    res.json(productDto(await loadProduct(householdId, idOf(req))));
  })
);

router.put(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await findOwnedProduct(prisma, householdId, idOf(req));
    const data = sourcingProductSchema.parse(req.body);
    await assertSkuFree(householdId, data.sku, existing.id);
    try {
      const updated = await prisma.sourcingProduct.update({ where: { id: existing.id }, data, include: withOrders });
      res.json(productDto(updated));
    } catch (err) {
      if (isUniqueViolation(err)) throw new FriendlyError(SKU_CLASH, 409);
      throw err;
    }
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const existing = await findOwnedProduct(prisma, householdId, idOf(req));
    // Orders are never deleted along with a product — they hold real purchase and payment history.
    const orderCount = await prisma.sourcingRecord.count({ where: { productId: existing.id, householdId } });
    if (orderCount > 0) {
      throw new FriendlyError(`This product still has ${orderCount} sourcing ${orderCount === 1 ? "order" : "orders"}. Delete them, or move them to another product, before deleting the product.`, 409);
    }
    await prisma.sourcingProduct.delete({ where: { id: existing.id } });
    await removeBlobs([existing.imagePath, existing.imageThumbPath]);
    res.json({ message: "Product deleted." });
  })
);

// --------------------------------------------------------------------------- product picture
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 2 } }).fields([
  { name: "file", maxCount: 1 },
  { name: "thumb", maxCount: 1 },
]);

function receiveImageUpload(req: AuthedRequest, res: Parameters<typeof imageUpload>[1]): Promise<void> {
  return new Promise((resolve, reject) => {
    imageUpload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return reject(new FriendlyError(`That picture is too large. Please choose one under ${(MAX_PHOTO_BYTES / 1_000_000).toFixed(1)} MB.`, 413));
      reject(new FriendlyError("We couldn't read that upload. Please try a different picture.", 400));
    });
  });
}

/** Best effort: a file that is already gone (or storage being briefly unavailable) must not block the user. */
const removeBlobs = (urls: (string | null | undefined)[]) => Promise.all(urls.filter((u): u is string => !!u).map((u) => del(u).catch(() => undefined)));

/** Add or replace the product's picture. The old files are removed only after the new one is safely saved. */
router.post(
  "/:id/image",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const product = await findOwnedProduct(prisma, householdId, idOf(req));
    await receiveImageUpload(req, res);

    const files = req.files as { file?: Express.Multer.File[]; thumb?: Express.Multer.File[] } | undefined;
    const full = files?.file?.[0];
    if (!full) throw new FriendlyError("Please choose a picture to upload.", 400);
    const check = checkImageUpload(full.buffer);
    if (!check.ok) throw new FriendlyError(check.message, check.code === "TOO_LARGE" ? 413 : 400);

    const thumbFile = files?.thumb?.[0];
    const thumbType = thumbFile && thumbFile.size <= MAX_THUMB_BYTES ? detectImageType(thumbFile.buffer) : null;

    const fileName = safeFileName(full.originalname, check.type);
    const folder = `product-images/${householdId}/${product.id}`;
    const stamp = Date.now();
    const uploaded: string[] = [];
    try {
      const blob = await put(`${folder}/${stamp}-${fileName}`, full.buffer, { access: "public", contentType: check.type });
      uploaded.push(blob.url);
      let thumbUrl: string | null = null;
      if (thumbFile && thumbType) {
        thumbUrl = (await put(`${folder}/${stamp}-thumb-${fileName}`, thumbFile.buffer, { access: "public", contentType: thumbType })).url;
        uploaded.push(thumbUrl);
      }
      const updated = await prisma.sourcingProduct.update({
        where: { id: product.id },
        data: { imageFileName: fileName, imageContentType: check.type, imagePath: blob.url, imageThumbPath: thumbUrl, imageUpdatedAt: new Date() },
        include: withOrders,
      });
      await removeBlobs([product.imagePath, product.imageThumbPath]);
      res.status(product.imagePath ? 200 : 201).json(productDto(updated));
    } catch (err) {
      await removeBlobs(uploaded); // don't leave orphaned files behind when saving failed
      console.error("Product image upload failed:", err);
      throw new FriendlyError("We couldn't save that picture. Please try again.", 502);
    }
  })
);

router.get(
  "/:id/image",
  asyncHandler(async (req: AuthedRequest, res) => {
    const product = await findOwnedProduct(prisma, householdOf(req), idOf(req));
    if (!product.imagePath || !product.imageContentType) throw new FriendlyError("This product doesn't have a picture yet.", 404);
    const url = req.query.size === "thumb" && product.imageThumbPath ? product.imageThumbPath : product.imagePath;
    const stored = await fetch(url);
    if (!stored.ok) throw new FriendlyError("This picture is no longer available.", 404);
    const bytes = Buffer.from(await stored.arrayBuffer());
    res.setHeader("Content-Type", product.imageContentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    // Only this person's browser may cache it; the page asks with ?v=<imageVersion>, so a replaced picture is fetched afresh.
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(bytes);
  })
);

router.delete(
  "/:id/image",
  asyncHandler(async (req: AuthedRequest, res) => {
    const product = await findOwnedProduct(prisma, householdOf(req), idOf(req));
    if (!product.imagePath) throw new FriendlyError("This product doesn't have a picture to remove.", 404);
    const updated = await prisma.sourcingProduct.update({
      where: { id: product.id },
      data: { imageFileName: null, imageContentType: null, imagePath: null, imageThumbPath: null, imageUpdatedAt: null },
      include: withOrders,
    });
    await removeBlobs([product.imagePath, product.imageThumbPath]);
    res.json(productDto(updated));
  })
);

export default router;
