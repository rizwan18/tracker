/**
 * Products/SKU end to end: the real Express routes run against an in-memory stand-in for the database and for
 * Vercel Blob (no live services). Covers product CRUD, one product → many orders, picture upload / replace /
 * remove, search and filters, the backfill of existing orders, and household separation.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { products: [] as Row[], records: [] as Row[], blobs: new Map<string, Buffer>(), seq: 0, failNextPut: false, deletedBlobs: [] as string[] };
  const id = (p: string) => `${p}${++state.seq}`;

  function matches(obj: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === "AND") return (v as Row[]).every((w) => matches(obj, w));
      if (k === "OR") return (v as Row[]).some((w) => matches(obj, w));
      if (k === "orders") return (obj.orders ?? []).some((o: Row) => matches(o, (v as Row).some));
      if (k === "product") return !!obj.product && matches(obj.product, (v as Row).is);
      const val = obj[k];
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const c = v as Row;
        if ("contains" in c) return typeof val === "string" && val.includes(c.contains);
        if ("not" in c) return val !== c.not;
        if ("in" in c) return c.in.includes(val);
        if ("gte" in c || "lte" in c) return !!val && (!c.gte || val >= c.gte) && (!c.lte || val <= c.lte);
        return false;
      }
      return val === v;
    });
  }
  const withChildren = (r: Row): Row => ({ ...r, payments: [], inspections: [], shipments: [], documents: [] });
  const productView = (p: Row, include?: Row): Row => (include?.orders ? { ...p, orders: state.records.filter((r) => r.productId === p.id).map(withChildren) } : { ...p });
  const recordView = (r: Row, include?: Row): Row => {
    const out = withChildren(r);
    if (include?.product) { const p = state.products.find((x) => x.id === r.productId); out.product = p ? { ...p } : null; }
    return out;
  };

  const prisma: Row = {
    household: { findUnique: async ({ where }: Row) => ({ portfolioType: where.id === "p1" ? "PERSONAL" : "COMPANY" }) },
    sourcingProduct: {
      findFirst: async ({ where, include }: Row) => { const p = state.products.find((x) => matches(x, where)); return p ? productView(p, include) : null; },
      findMany: async ({ where, include, orderBy }: Row) => {
        let rows = state.products.map((p) => productView(p, { orders: true })).filter((p) => matches(p, where));
        if (orderBy?.name) rows = rows.sort((a, b) => a.name.localeCompare(b.name));
        if (orderBy?.createdAt) rows = rows.sort((a, b) => a.createdAt - b.createdAt);
        return rows.map((p) => (include?.orders ? p : (({ orders: _o, ...rest }) => rest)(p)));
      },
      create: async ({ data, include }: Row) => {
        if (data.sku && state.products.some((p) => p.householdId === data.householdId && p.sku === data.sku)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { id: id("prod"), sku: null, description: null, imageFileName: null, imageContentType: null, imagePath: null, imageThumbPath: null, imageUpdatedAt: null, createdAt: new Date(state.seq), updatedAt: new Date(), ...data };
        state.products.push(row);
        return productView(row, include);
      },
      update: async ({ where, data, include }: Row) => { const p = state.products.find((x) => x.id === where.id)!; Object.assign(p, data, { updatedAt: new Date() }); return productView(p, include); },
      delete: async ({ where }: Row) => { state.products = state.products.filter((x) => x.id !== where.id); },
    },
    sourcingRecord: {
      count: async ({ where }: Row) => state.records.filter((r) => matches(r, where)).length,
      findFirst: async ({ where, include }: Row) => { const r = state.records.find((x) => matches(x, where)); return r ? recordView(r, include) : null; },
      findMany: async ({ where, include, select }: Row) => state.records.filter((r) => matches(r, where)).map((r) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : recordView(r, include))),
      create: async ({ data, include }: Row) => {
        const row = {
          id: id("ord"), status: "ENQUIRY", reference: null, quantity: 1, unitCostCents: 0, currency: "AUD", exchangeRateToAud: null, targetMarginPercent: 40, orderDate: null, expectedDate: null,
          deliveredDate: null, supplierCountry: null, supplierContactName: null, supplierEmail: null, supplierPhone: null, supplierWebsite: null, supplierAddress: null, notes: null,
          createdAt: new Date(1_700_000_000_000 + state.seq * 1000), updatedAt: new Date(), ...data,
        };
        state.records.push(row);
        return recordView(row, include);
      },
      update: async ({ where, data, include }: Row) => { const r = state.records.find((x) => x.id === where.id)!; Object.assign(r, data); return recordView(r, include); },
      updateMany: async ({ where, data }: Row) => { const rows = state.records.filter((r) => matches(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
    },
    $executeRaw: async () => 0,
    $transaction: async (fn: (tx: Row) => unknown) => fn(prisma),
  };
  return { state, prisma, id };
});

vi.mock("../lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = "u1"; req.householdId = req.headers["x-test-household"] ?? "h1"; next(); },
}));
vi.mock("@vercel/blob", () => ({
  put: async (path: string, body: Buffer) => {
    if (h.state.failNextPut) { h.state.failNextPut = false; throw new Error("storage down"); }
    const url = `https://blob.test/${path}`;
    h.state.blobs.set(url, Buffer.from(body));
    return { url };
  },
  del: async (url: string) => { h.state.deletedBlobs.push(url); h.state.blobs.delete(url); },
}));

import { createApp } from "../app";

let server: Server;
let base = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  vi.stubGlobal("fetch", (url: any, init?: any) => {
    const u = String(url);
    if (u.startsWith("https://blob.test/")) { const b = h.state.blobs.get(u); return Promise.resolve(b ? new Response(b) : new Response("gone", { status: 404 })); }
    return realFetch(url, init);
  });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/business`;
});
afterAll(() => { server.close(); vi.unstubAllGlobals(); });
beforeEach(() => { Object.assign(h.state, { products: [], records: [], blobs: new Map(), failNextPut: false, deletedBlobs: [] }); });

const call = async (method: string, path: string, body?: unknown, household = "h1") => {
  const res = await realFetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-test-household": household }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const upload = async (productId: string, files: { file?: [Buffer, string]; thumb?: [Buffer, string] }, household = "h1") => {
  const fd = new FormData();
  if (files.file) fd.append("file", new Blob([files.file[0]]), files.file[1]);
  if (files.thumb) fd.append("thumb", new Blob([files.thumb[0]]), files.thumb[1]);
  const res = await realFetch(`${base}/products/${productId}/image`, { method: "POST", headers: { "x-test-household": household }, body: fd });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const order = (over: Record<string, unknown> = {}) => ({ origin: "OVERSEAS", itemDescription: "VELTI Shower Filter", quantity: 1000, unitCostCents: 500, currency: "AUD", supplierName: "Acme Co", supplierCountry: "China", ...over });
const newProduct = async (name = "VELTI Shower Filter", sku: string | null = "VELTI-SF-001", household = "h1") => (await call("POST", "/products", { name, sku }, household)).body;

describe("product create / edit / delete", () => {
  it("creates a product with a name and SKU, and it starts with no image and no orders", async () => {
    const r = await call("POST", "/products", { name: "  VELTI Shower Filter ", sku: " VELTI-SF-001 ", description: "Filter" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "VELTI Shower Filter", sku: "VELTI-SF-001", description: "Filter", hasImage: false, orderCount: 0, latest: null });
  });
  it("needs a name", async () => {
    const r = await call("POST", "/products", { name: "   " });
    expect(r.status).toBe(400);
  });
  it("a SKU is optional — several products can have none", async () => {
    expect((await call("POST", "/products", { name: "A" })).status).toBe(201);
    expect((await call("POST", "/products", { name: "B", sku: "" })).status).toBe(201);
  });
  it("refuses a SKU that another product already uses (ignoring case) with a friendly message", async () => {
    await newProduct("A", "ABC-1");
    const r = await call("POST", "/products", { name: "B", sku: "abc-1" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already used by “A”/);
  });
  it("edits a product, and can keep its own SKU", async () => {
    const p = await newProduct();
    const r = await call("PUT", `/products/${p.id}`, { name: "VELTI Shower Filter v2", sku: "VELTI-SF-001", description: "New" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "VELTI Shower Filter v2", sku: "VELTI-SF-001", description: "New" });
  });
  it("deletes a product that has no orders", async () => {
    const p = await newProduct();
    expect((await call("DELETE", `/products/${p.id}`)).status).toBe(200);
    expect((await call("GET", `/products/${p.id}`)).status).toBe(404);
  });
  it("won't delete a product that still has orders — and the orders are untouched", async () => {
    const p = await newProduct();
    await call("POST", "/sourcing", order({ productId: p.id }));
    const r = await call("DELETE", `/products/${p.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/still has 1 sourcing order/);
    expect((await call("GET", `/products/${p.id}`)).body.orderCount).toBe(1);
  });
  it("a product that doesn't exist is a friendly 404", async () => {
    const r = await call("GET", "/products/nope");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("We couldn't find that product.");
  });
});

describe("household separation", () => {
  it("only Company Finance portfolios can use it", async () => {
    const r = await call("GET", "/products", undefined, "p1");
    expect(r.status).toBe(403);
  });
  it("another company's product is invisible: read, edit, delete, image and attaching orders all say not found", async () => {
    const theirs = await newProduct("Theirs", "T-1", "h2");
    expect((await call("GET", `/products/${theirs.id}`, undefined, "h1")).status).toBe(404);
    expect((await call("PUT", `/products/${theirs.id}`, { name: "x" }, "h1")).status).toBe(404);
    expect((await call("DELETE", `/products/${theirs.id}`, undefined, "h1")).status).toBe(404);
    expect((await upload(theirs.id, { file: [PNG, "a.png"] }, "h1")).status).toBe(404);
    expect((await call("POST", "/sourcing", order({ productId: theirs.id }), "h1")).status).toBe(404);
    expect((await call("GET", "/products", undefined, "h1")).body.items).toHaveLength(0);
  });
  it("the same SKU can exist in two different companies", async () => {
    await newProduct("A", "SAME", "h1");
    expect((await call("POST", "/products", { name: "A", sku: "SAME" }, "h2")).status).toBe(201);
  });
});

describe("one product, many sourcing orders", () => {
  it("adds several orders under one SKU without creating more products", async () => {
    const p = await newProduct();
    const o1 = await call("POST", "/sourcing", order({ productId: p.id, quantity: 500, supplierName: "Supplier A", reference: "PO-1", orderDate: "2026-01-10" }));
    const o2 = await call("POST", "/sourcing", order({ productId: p.id, quantity: 1000, supplierName: "Supplier A", reference: "PO-2", orderDate: "2026-03-10" }));
    const o3 = await call("POST", "/sourcing", order({ productId: p.id, quantity: 500, supplierName: "Supplier B", reference: "PO-3", orderDate: "2026-05-10" }));
    expect([o1.status, o2.status, o3.status]).toEqual([201, 201, 201]);
    for (const o of [o1, o2, o3]) expect(o.body.productId).toBe(p.id);

    const list = await call("GET", "/products");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: p.id, orderCount: 3 });

    const detail = await call("GET", `/products/${p.id}`);
    expect(detail.body.orders.map((o: any) => o.reference)).toEqual(["PO-3", "PO-2", "PO-1"]); // newest first
    expect(detail.body.latest).toMatchObject({ supplierName: "Supplier B", quantity: 500 });
  });
  it("an order lists its parent product", async () => {
    const p = await newProduct();
    const o = await call("POST", "/sourcing", order({ productId: p.id }));
    expect(o.body.product).toMatchObject({ id: p.id, name: "VELTI Shower Filter", sku: "VELTI-SF-001", hasImage: false });
  });
  it("an order created without a product id reuses the product with the same name, or makes one", async () => {
    const p = await newProduct("VELTI Shower Filter");
    const same = await call("POST", "/sourcing", order({ itemDescription: "  velti   shower filter " }));
    expect(same.body.productId).toBe(p.id);
    const other = await call("POST", "/sourcing", order({ itemDescription: "Brand new thing" }));
    expect(other.body.productId).not.toBe(p.id);
    expect((await call("GET", "/products")).body.items).toHaveLength(2);
  });
  it("editing an order keeps its product; it can be moved to another product of the same company", async () => {
    const a = await newProduct("A", "A-1");
    const b = await newProduct("B", "B-1");
    const o = (await call("POST", "/sourcing", order({ productId: a.id }))).body;
    const edited = await call("PUT", `/sourcing/${o.id}`, order({ quantity: 2000 }));
    expect(edited.body).toMatchObject({ productId: a.id, quantity: 2000 });
    const moved = await call("PUT", `/sourcing/${o.id}`, order({ productId: b.id }));
    expect(moved.body.productId).toBe(b.id);
    expect((await call("GET", `/products/${a.id}`)).body.orderCount).toBe(0);
    expect((await call("GET", `/products/${b.id}`)).body.orderCount).toBe(1);
    const stranger = await newProduct("C", "C-1", "h2");
    expect((await call("PUT", `/sourcing/${o.id}`, order({ productId: stranger.id }))).status).toBe(404);
  });
  it("keeps the existing cost calculations on each order (cost per unit, 40% margin selling price)", async () => {
    const p = await newProduct();
    const o = (await call("POST", "/sourcing", order({ productId: p.id, quantity: 1000, unitCostCents: 600 }))).body; // $6,000 over 1,000 units
    expect(o.totalCostCents).toBe(600_000);
    expect(o.pricing.targetMarginPercent).toBe(40);
    expect(o.pricing.unit.costPerUnitCents).toBe(600);
    expect(o.pricing.unit.sellingPricePerUnitCents).toBeCloseTo(1000, 9); // $6.00 ÷ 0.60 = $10.00
    const detail = (await call("GET", `/products/${p.id}`)).body;
    expect(detail.latest).toMatchObject({ costPerUnitCents: 600, targetMarginPercent: 40 });
    expect(detail.latest.sellingPricePerUnitCents).toBeCloseTo(1000, 9);
  });
  it("the product's current cost comes from its latest live order (a cancelled one is skipped)", async () => {
    const p = await newProduct();
    await call("POST", "/sourcing", order({ productId: p.id, unitCostCents: 400, orderDate: "2026-01-01" }));
    await call("POST", "/sourcing", order({ productId: p.id, unitCostCents: 900, orderDate: "2026-06-01", status: "CANCELLED" }));
    expect((await call("GET", `/products/${p.id}`)).body.latest.costPerUnitCents).toBe(400);
  });
});

describe("existing orders are migrated onto products (repeatable, nothing lost)", () => {
  const legacy = (over: Record<string, unknown>) => ({ id: h.id("old"), householdId: "h1", productId: null, createdById: "u1", origin: "OVERSEAS", status: "DELIVERED", reference: null, itemDescription: "x", quantity: 100, unitCostCents: 250, currency: "AUD", supplierName: "S", createdAt: new Date(h.state.seq * 1000), updatedAt: new Date(), ...over });

  it("groups orders by product name (ignoring case/spacing), keeps different names apart, and loses nothing", async () => {
    h.state.records.push(legacy({ itemDescription: "VELTI Shower Filter", quantity: 500 }), legacy({ itemDescription: "velti  shower filter", quantity: 1000 }), legacy({ itemDescription: "Garden Hose" }));
    const list = await call("GET", "/products");
    expect(list.body.items.map((i: any) => [i.name, i.orderCount])).toEqual([["Garden Hose", 1], ["VELTI Shower Filter", 2]]);
    expect(h.state.records).toHaveLength(3);
    expect(h.state.records.every((r) => r.productId)).toBe(true);
    expect(h.state.records.map((r) => r.quantity).sort((a, b) => a - b)).toEqual([100, 500, 1000]);
    expect(h.state.records.map((r) => r.unitCostCents)).toEqual([250, 250, 250]);
  });
  it("running it again changes nothing", async () => {
    h.state.records.push(legacy({ itemDescription: "A" }), legacy({ itemDescription: "A" }));
    await call("GET", "/products");
    const first = h.state.products.length;
    await call("GET", "/products");
    await call("GET", "/sourcing");
    expect(h.state.products).toHaveLength(first);
    expect(first).toBe(1);
  });
  it("never moves an order that already has a product, and reuses an existing product of the same name", async () => {
    const mine = await newProduct("Garden Hose", "GH-1");
    const other = await newProduct("Other", "O-1");
    h.state.records.push(legacy({ itemDescription: "garden hose" }), legacy({ itemDescription: "Garden Hose", productId: other.id }));
    await call("GET", "/products");
    const [unassigned, assigned] = h.state.records;
    expect(unassigned!.productId).toBe(mine.id);
    expect(assigned!.productId).toBe(other.id);
    expect(h.state.products).toHaveLength(2);
  });
  it("keeps each company's orders in its own products", async () => {
    h.state.records.push(legacy({ itemDescription: "Same", householdId: "h1" }), legacy({ itemDescription: "Same", householdId: "h2" }));
    await call("GET", "/products", undefined, "h1");
    expect(h.state.records.find((r) => r.householdId === "h2")!.productId).toBeNull(); // h2 hasn't been opened yet — untouched
    await call("GET", "/products", undefined, "h2");
    const [a, b] = h.state.records;
    expect(a!.productId).not.toBe(b!.productId);
  });
  it("an old order opens fine and shows its product", async () => {
    const rec = legacy({ itemDescription: "VELTI Shower Filter" });
    h.state.records.push(rec);
    const r = await call("GET", `/sourcing/${rec.id}`);
    expect(r.status).toBe(200);
    expect(r.body.product).toMatchObject({ name: "VELTI Shower Filter" });
  });
});

describe("search and filters", () => {
  beforeEach(async () => {
    const velti = await newProduct("VELTI Shower Filter", "VELTI-SF-001");
    const hose = await newProduct("Garden Hose", "GH-77");
    await call("POST", "/sourcing", order({ productId: velti.id, supplierName: "Shenzhen Aqua", reference: "PO-9001", origin: "OVERSEAS", status: "SHIPPED", orderDate: "2026-02-01" }));
    await call("POST", "/sourcing", order({ productId: hose.id, itemDescription: "Garden Hose", supplierName: "Melbourne Plastics", reference: "PO-9002", origin: "LOCAL", status: "DELIVERED", orderDate: "2026-04-01" }));
  });
  const names = async (qs: string) => (await call("GET", `/products?${qs}`)).body.items.map((i: any) => i.name);

  it("finds a product by name", async () => expect(await names("q=Shower")).toEqual(["VELTI Shower Filter"]));
  it("by SKU", async () => expect(await names("q=GH-77")).toEqual(["Garden Hose"]));
  it("by the supplier on one of its orders", async () => expect(await names("q=Shenzhen")).toEqual(["VELTI Shower Filter"]));
  it("by an order reference", async () => expect(await names("q=PO-9002")).toEqual(["Garden Hose"]));
  it("shows nothing for a search that matches nothing", async () => expect(await names("q=zzz")).toEqual([]));
  it("filters by supplier origin", async () => expect(await names("origin=LOCAL")).toEqual(["Garden Hose"]));
  it("filters by order status", async () => expect(await names("status=SHIPPED")).toEqual(["VELTI Shower Filter"]));
  it("filters by order date", async () => expect(await names("from=2026-03-01&to=2026-12-31")).toEqual(["Garden Hose"]));
  it("combines search and filters", async () => expect(await names("q=PO-900&status=DELIVERED")).toEqual(["Garden Hose"]));
  it("reports the totals the old Sourcing page showed (open orders, cost, paid, to pay)", async () => {
    const t = (await call("GET", "/products")).body.totals;
    expect(t).toMatchObject({ productCount: 2, openCount: 1 });
    expect(t.totalCostAudEstCents).toBe(2 * 1000 * 500);
  });
});

describe("product picture", () => {
  it("uploads a picture (with its small version) and shows it on the product", async () => {
    const p = await newProduct();
    const r = await upload(p.id, { file: [PNG, "front.png"], thumb: [PNG, "thumb-front.png"] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ hasImage: true, imageFileName: "front.png" });
    expect(r.body.imageVersion).toBeGreaterThan(0);
    expect(h.state.blobs.size).toBe(2);
    expect([...h.state.blobs.keys()].every((k) => k.includes(`product-images/h1/${p.id}/`))).toBe(true);
  });
  it("accepts JPG too, and works without a small version", async () => {
    const p = await newProduct();
    expect((await upload(p.id, { file: [JPG, "photo.jpeg"] })).status).toBe(201);
    expect(h.state.blobs.size).toBe(1);
  });
  it("serves the picture back (full and thumbnail) with the right type", async () => {
    const p = await newProduct();
    await upload(p.id, { file: [PNG, "a.png"], thumb: [Buffer.concat([PNG, Buffer.from([9])]), "t.png"] });
    const full = await realFetch(`${base}/products/${p.id}/image`, { headers: { "x-test-household": "h1" } });
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("image/png");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await full.arrayBuffer())).toEqual(PNG);
    const thumb = await realFetch(`${base}/products/${p.id}/image?size=thumb`, { headers: { "x-test-household": "h1" } });
    expect(Buffer.from(await thumb.arrayBuffer()).length).toBe(PNG.length + 1);
  });
  it("another company can't fetch it", async () => {
    const p = await newProduct();
    await upload(p.id, { file: [PNG, "a.png"] });
    const r = await realFetch(`${base}/products/${p.id}/image`, { headers: { "x-test-household": "h2" } });
    expect(r.status).toBe(404);
  });
  it("replacing it stores the new one and deletes the old files", async () => {
    const p = await newProduct();
    await upload(p.id, { file: [PNG, "old.png"], thumb: [PNG, "t.png"] });
    const oldKeys = [...h.state.blobs.keys()];
    const r = await upload(p.id, { file: [JPG, "new.jpg"] });
    expect(r.status).toBe(200);
    expect(r.body.imageFileName).toBe("new.jpg");
    expect(oldKeys.every((k) => !h.state.blobs.has(k))).toBe(true);
    expect(h.state.deletedBlobs).toEqual(expect.arrayContaining(oldKeys));
    expect(h.state.blobs.size).toBe(1);
  });
  it("removes it, and the product goes back to having no image", async () => {
    const p = await newProduct();
    await upload(p.id, { file: [PNG, "a.png"], thumb: [PNG, "t.png"] });
    const r = await call("DELETE", `/products/${p.id}/image`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ hasImage: false, imageVersion: 0, imageFileName: null });
    expect(h.state.blobs.size).toBe(0);
    expect((await call("DELETE", `/products/${p.id}/image`)).status).toBe(404); // nothing left to remove
    const img = await realFetch(`${base}/products/${p.id}/image`, { headers: { "x-test-household": "h1" } });
    expect(img.status).toBe(404);
  });
  it("a product with no picture shows as such in the list", async () => {
    await newProduct();
    expect((await call("GET", "/products")).body.items[0]).toMatchObject({ hasImage: false, imageVersion: 0 });
  });
  it("rejects something that isn't a picture, even if it's named .png", async () => {
    const p = await newProduct();
    const r = await upload(p.id, { file: [Buffer.from("<html><script>alert(1)</script></html>"), "evil.png"] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/doesn't look like a picture/);
    expect(h.state.blobs.size).toBe(0);
  });
  it("rejects SVG and PDF", async () => {
    const p = await newProduct();
    expect((await upload(p.id, { file: [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "a.svg"] })).status).toBe(400);
    expect((await upload(p.id, { file: [Buffer.from("%PDF-1.4 fake"), "a.pdf"] })).status).toBe(400);
  });
  it("rejects a picture that's too large with a clear message", async () => {
    const p = await newProduct();
    const big = Buffer.concat([PNG, Buffer.alloc(3_600_000)]);
    const r = await upload(p.id, { file: [big, "big.png"] });
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/too large/);
    expect(h.state.blobs.size).toBe(0);
  });
  it("rejects an empty file and a missing file", async () => {
    const p = await newProduct();
    expect((await upload(p.id, { file: [Buffer.alloc(0), "empty.png"] })).status).toBe(400);
    expect((await upload(p.id, {})).status).toBe(400);
  });
  it("a failed upload shows a friendly error, leaves the old picture alone and leaves no orphaned files", async () => {
    const p = await newProduct();
    await upload(p.id, { file: [PNG, "keep.png"] });
    const before = [...h.state.blobs.keys()];
    h.state.failNextPut = true;
    const r = await upload(p.id, { file: [JPG, "new.jpg"] });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("We couldn't save that picture. Please try again."); // no stack trace / internals
    expect([...h.state.blobs.keys()]).toEqual(before);
    expect((await call("GET", `/products/${p.id}`)).body.imageFileName).toBe("keep.png");
  });
  it("the picture belongs to the product, not to an order", async () => {
    const p = await newProduct();
    await upload(p.id, { file: [PNG, "a.png"] });
    const o = (await call("POST", "/sourcing", order({ productId: p.id }))).body;
    expect(o.product.hasImage).toBe(true);
    const o2 = (await call("POST", "/sourcing", order({ productId: p.id }))).body;
    expect(o2.product.imageVersion).toBe(o.product.imageVersion);
  });
  it("deleting a product deletes its picture files", async () => {
    const p = await newProduct();
    await upload(p.id, { file: [PNG, "a.png"], thumb: [PNG, "t.png"] });
    expect((await call("DELETE", `/products/${p.id}`)).status).toBe(200);
    expect(h.state.blobs.size).toBe(0);
  });
});
