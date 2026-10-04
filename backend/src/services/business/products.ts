/**
 * Products / SKUs — the parent of sourcing orders (one product, many orders).
 *
 * Before products existed, every sourcing record carried its own free-text `itemDescription` and nothing
 * else identified the product. `backfillProducts` links those existing orders to product records:
 *
 *   • orders whose item description is the same (ignoring case and extra spaces) become orders of ONE product;
 *   • an order whose description matches nothing else becomes a product of its own — nothing is ever guessed
 *     beyond an exact (case/space-insensitive) name match, and no order is ever changed or deleted;
 *   • an order that already has a product is never touched, so running it again does nothing;
 *   • a product already in the household with the same name is reused instead of duplicated.
 *
 * If two orders were wrongly grouped (or split), moving an order to another product is one edit on the order.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { FriendlyError } from "../../middleware/errorHandler";

/** "  VELTI   Shower Filter " and "velti shower filter" are the same product name. */
export const productKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export interface BackfillRecord {
  id: string;
  itemDescription: string;
  createdById: string;
}
export interface ExistingProduct {
  id: string;
  name: string;
}
export interface BackfillPlan {
  /** Orders to attach to a product that already exists. */
  link: { productId: string; recordIds: string[] }[];
  /** New products to create, each with the orders that go under it. `name` is the oldest order's own wording. */
  create: { name: string; createdById: string; recordIds: string[] }[];
}

const UNTITLED = "Untitled product";

/** Pure: decides which products to create / reuse. `records` should be oldest first. */
export function planProductBackfill(records: BackfillRecord[], existing: ExistingProduct[]): BackfillPlan {
  const existingByKey = new Map<string, string>();
  for (const p of existing) if (!existingByKey.has(productKey(p.name))) existingByKey.set(productKey(p.name), p.id);

  const link = new Map<string, string[]>();
  const create = new Map<string, { name: string; createdById: string; recordIds: string[] }>();
  for (const r of records) {
    const name = r.itemDescription.trim().replace(/\s+/g, " ") || UNTITLED;
    const key = productKey(name);
    const existingId = existingByKey.get(key);
    if (existingId) {
      link.set(existingId, [...(link.get(existingId) ?? []), r.id]);
      continue;
    }
    const group = create.get(key);
    if (group) group.recordIds.push(r.id);
    else create.set(key, { name, createdById: r.createdById, recordIds: [r.id] });
  }
  return { link: [...link].map(([productId, recordIds]) => ({ productId, recordIds })), create: [...create.values()] };
}

type Db = Pick<Prisma.TransactionClient, "sourcingProduct" | "sourcingRecord" | "$executeRaw">;

/**
 * Links every order that has no product yet to a product (see the rules at the top). Safe to run any number
 * of times and from several requests at once: a per-household database lock serialises concurrent runs.
 */
export async function backfillProducts(db: Db, householdId: string): Promise<{ productsCreated: number; ordersLinked: number }> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${householdId}))`;

  const records = await db.sourcingRecord.findMany({
    where: { householdId, productId: null },
    select: { id: true, itemDescription: true, createdById: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (records.length === 0) return { productsCreated: 0, ordersLinked: 0 };

  const existing = await db.sourcingProduct.findMany({ where: { householdId }, select: { id: true, name: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const plan = planProductBackfill(records, existing);

  let ordersLinked = 0;
  for (const l of plan.link) {
    const r = await db.sourcingRecord.updateMany({ where: { id: { in: l.recordIds }, householdId, productId: null }, data: { productId: l.productId } });
    ordersLinked += r.count;
  }
  for (const c of plan.create) {
    const product = await db.sourcingProduct.create({ data: { householdId, name: c.name, createdById: c.createdById }, select: { id: true } });
    const r = await db.sourcingRecord.updateMany({ where: { id: { in: c.recordIds }, householdId, productId: null }, data: { productId: product.id } });
    ordersLinked += r.count;
  }
  return { productsCreated: plan.create.length, ordersLinked };
}

/** Cheap to call on every request: does nothing unless some order in the household still has no product. */
export async function ensureProductsBackfilled(client: Pick<PrismaClient, "sourcingRecord" | "$transaction">, householdId: string): Promise<void> {
  const pending = await client.sourcingRecord.count({ where: { householdId, productId: null } });
  if (pending === 0) return;
  await client.$transaction((tx) => backfillProducts(tx, householdId), { timeout: 20_000 });
}

/**
 * The product with this name for an order being created without a product id (an older client, an import):
 * the existing one if the name matches (ignoring case and spacing), otherwise a new one. Never makes a duplicate
 * of a name that already exists.
 */
export async function findOrCreateProductByName(
  db: Pick<PrismaClient, "sourcingProduct">,
  householdId: string,
  createdById: string,
  rawName: string
): Promise<{ id: string; name: string }> {
  const name = rawName.trim().replace(/\s+/g, " ") || UNTITLED;
  const candidates = await db.sourcingProduct.findMany({ where: { householdId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  const match = candidates.find((p) => productKey(p.name) === productKey(name));
  if (match) return match;
  return db.sourcingProduct.create({ data: { householdId, name, createdById }, select: { id: true, name: true } });
}

/** True when another product in `products` already uses this SKU (SKUs are compared ignoring case). */
export function skuTaken(products: { id: string; sku: string | null }[], sku: string | null | undefined, exceptId?: string): boolean {
  if (!sku) return false;
  const key = sku.trim().toLowerCase();
  return products.some((p) => p.id !== exceptId && p.sku !== null && p.sku.trim().toLowerCase() === key);
}

/** A product in this household, or a friendly 404 — so an order can never be attached to someone else's product. */
export async function findOwnedProduct(db: Pick<PrismaClient, "sourcingProduct">, householdId: string, id: string) {
  const product = await db.sourcingProduct.findFirst({ where: { id, householdId } });
  if (!product) throw new FriendlyError("We couldn't find that product.", 404);
  return product;
}
