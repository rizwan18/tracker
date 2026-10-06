/**
 * Contacts end to end: the real Express routes against an in-memory stand-in for the database (no live services).
 * Covers create / edit / view / search / filter / archive / delete, several types and several people per business,
 * duplicate warnings, linking to sourcing orders, household separation, and CSV import / export.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { contacts: [] as Row[], people: [] as Row[], records: [] as Row[], products: [] as Row[], payments: [] as Row[], shipments: [] as Row[], inspections: [] as Row[], seq: 0 };
  const id = (p: string) => `${p}${++state.seq}`;

  function matches(obj: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === "AND") return (v as Row[]).every((w) => matches(obj, w));
      if (k === "OR") return (v as Row[]).some((w) => matches(obj, w));
      const val = obj[k];
      if (v === null) return val == null;
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const c = v as Row;
        if ("contains" in c) return typeof val === "string" && val.includes(c.contains);
        if ("not" in c) return val !== c.not;
        if ("in" in c) return c.in.includes(val);
        return false;
      }
      return val === v;
    });
  }

  const peopleOf = (contactId: string) => state.people.filter((p) => p.contactId === contactId).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt - b.createdAt);
  const counts = (c: Row) => ({
    orders: state.records.filter((r) => r.supplierId === c.id).length, payments: 0, inspections: 0, forwarderShipments: 0, customsShipments: 0, logisticsShipments: 0, warehouseShipments: 0, entries: 0,
  });
  const contactView = (c: Row, o: Row = {}): Row => {
    const out: Row = { ...c };
    if (o.include?.people || o.select?.people) out.people = peopleOf(c.id).map((p) => ({ ...p }));
    if (o.include?._count || o.select?._count) out._count = counts(c);
    return out;
  };
  const ref = (c: Row | undefined) => (c ? { id: c.id, name: c.name, types: c.types, country: c.country, isArchived: c.isArchived } : null);
  const recordView = (r: Row, include?: Row): Row => {
    const con = (cid: string | null | undefined) => ref(state.contacts.find((c) => c.id === cid));
    const out: Row = {
      ...r,
      payments: state.payments.filter((p) => p.sourcingRecordId === r.id).map((p) => ({ ...p, bankAccount: null, documents: [], contact: con(p.contactId) })),
      inspections: state.inspections.filter((i) => i.sourcingRecordId === r.id).map((i) => ({ ...i, inspectorContact: con(i.inspectorId) })),
      shipments: state.shipments.filter((x) => x.sourcingRecordId === r.id).map((x) => ({ ...x, documents: [], forwarder: con(x.forwarderId), customsAgent: con(x.customsAgentId), logistics: con(x.logisticsId), warehouse: con(x.warehouseId) })),
      documents: [],
    };
    if (include?.supplier) out.supplier = con(r.supplierId);
    if (include?.product) { const p = state.products.find((x) => x.id === r.productId); out.product = p ? { ...p } : null; }
    return out;
  };
  const orderOf = (x: Row) => { const o = state.records.find((r) => r.id === x.sourcingRecordId)!; return { id: o.id, reference: o.reference ?? null, itemDescription: o.itemDescription, currency: o.currency, supplierId: o.supplierId }; };
  const child = (list: () => Row[], defaults: Row) => ({
    create: async ({ data }: Row) => { const row = { id: id("c"), createdAt: new Date(state.seq), ...defaults, ...data }; list().push(row); return row; },
    update: async ({ where, data }: Row) => { const row = list().find((x) => x.id === where.id)!; Object.assign(row, data); return row; },
  });

  const prisma: Row = {
    household: { findUnique: async ({ where }: Row) => ({ portfolioType: where.id === "p1" ? "PERSONAL" : "COMPANY" }) },
    contact: {
      findMany: async (o: Row) => state.contacts.filter((c) => matches(c, o.where)).map((c) => contactView(c, o)),
      findFirst: async (o: Row) => { const c = state.contacts.find((x) => matches(x, o.where)); return c ? contactView(c, o) : null; },
      create: async ({ data, include }: Row) => {
        const { people, ...rest } = data;
        const row = { id: id("con"), isArchived: false, country: null, state: null, city: null, address: null, website: null, email: null, phone: null, mobile: null, whatsapp: null, wechat: null, otherContact: null, abn: null, registrationNumber: null, taxNumber: null, paymentTerms: null, currency: null, notes: null, createdAt: new Date(1_700_000_000_000 + state.seq * 1000), updatedAt: new Date(), ...rest };
        state.contacts.push(row);
        for (const p of people?.create ?? []) state.people.push({ id: id("per"), contactId: row.id, role: null, email: null, phone: null, mobile: null, whatsapp: null, wechat: null, notes: null, isPrimary: false, createdAt: state.seq, updatedAt: new Date(), ...p });
        return contactView(row, { include });
      },
      update: async ({ where, data, include }: Row) => { const c = state.contacts.find((x) => x.id === where.id)!; Object.assign(c, data, { updatedAt: new Date() }); return contactView(c, { include }); },
      delete: async ({ where }: Row) => { state.contacts = state.contacts.filter((c) => c.id !== where.id); state.people = state.people.filter((p) => p.contactId !== where.id); },
    },
    contactPerson: {
      count: async ({ where }: Row) => state.people.filter((p) => matches(p, where)).length,
      findMany: async ({ where, take }: Row) => state.people.filter((p) => matches(p, where)).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt - b.createdAt).slice(0, take ?? 1e9),
      findFirst: async ({ where }: Row) => state.people.filter((p) => matches(p, where)).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null,
      create: async ({ data }: Row) => { const row = { id: id("per"), role: null, email: null, phone: null, mobile: null, whatsapp: null, wechat: null, notes: null, isPrimary: false, createdAt: state.seq, updatedAt: new Date(), ...data }; state.people.push(row); return row; },
      updateMany: async ({ where, data }: Row) => { const rows = state.people.filter((p) => matches(p, where)); rows.forEach((p) => Object.assign(p, data)); return { count: rows.length }; },
      update: async ({ where, data }: Row) => { const p = state.people.find((x) => x.id === where.id)!; Object.assign(p, data); return p; },
      delete: async ({ where }: Row) => { state.people = state.people.filter((p) => p.id !== where.id); },
    },
    sourcingProduct: {
      findMany: async ({ where }: Row) => state.products.filter((p) => matches(p, where)),
      create: async ({ data }: Row) => { const row = { id: id("prod"), sku: null, ...data }; state.products.push(row); return row; },
    },
    sourcingRecord: {
      count: async ({ where }: Row) => state.records.filter((r) => matches(r, where)).length,
      findFirst: async ({ where, include }: Row) => { const r = state.records.find((x) => matches(x, where)); return r ? recordView(r, include) : null; },
      findMany: async ({ where, include, select }: Row) => state.records.filter((r) => matches(r, where)).map((r) => (select ? { ...r, product: null } : recordView(r, include))),
      create: async ({ data, include }: Row) => {
        const row = { id: id("ord"), status: "ENQUIRY", reference: null, quantity: 1, unitCostCents: 0, currency: "AUD", exchangeRateToAud: null, targetMarginPercent: 40, orderDate: null, expectedDate: null, deliveredDate: null, notes: null, createdAt: new Date(1_700_000_000_000 + state.seq * 1000), updatedAt: new Date(), ...data };
        state.records.push(row);
        return recordView(row, include);
      },
      update: async ({ where, data, include }: Row) => { const r = state.records.find((x) => x.id === where.id)!; Object.assign(r, data); return recordView(r, include); },
      updateMany: async ({ where, data }: Row) => { const rows = state.records.filter((r) => matches(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
    },
    sourcingPayment: {
      ...child(() => state.payments, { feeCents: 0, type: "DEPOSIT", method: null, bankAccountId: null, reference: null, notes: null, contactId: null }),
      // The contact's page asks for payments naming them as payee, or on their orders with no other payee.
      findMany: async ({ where }: Row) => {
        const cid = where.OR[0].contactId as string;
        return state.payments
          .filter((p) => p.contactId === cid || (p.contactId == null && orderOf(p).supplierId === cid))
          .map((p) => ({ ...p, sourcingRecord: orderOf(p) }));
      },
    },
    sourcingShipment: {
      ...child(() => state.shipments, { method: null, carrier: null, trackingNumber: null, shippedDate: null, eta: null, arrivedDate: null, forwarderId: null, customsAgentId: null, logisticsId: null, warehouseId: null }),
      findMany: async ({ where }: Row) => {
        const cid = where.OR[0].forwarderId as string;
        return state.shipments
          .filter((x) => [x.forwarderId, x.customsAgentId, x.logisticsId, x.warehouseId].includes(cid) || orderOf(x).supplierId === cid)
          .map((x) => ({ ...x, sourcingRecord: orderOf(x) }));
      },
    },
    sourcingInspection: {
      ...child(() => state.inspections, { inspector: null, inspectorId: null, result: "PENDING", costCents: 0, notes: null }),
      findMany: async ({ where }: Row) => state.inspections.filter((i) => i.inspectorId === where.inspectorId).map((i) => ({ ...i, sourcingRecord: orderOf(i) })),
      updateMany: async ({ where, data }: Row) => { const rows = state.inspections.filter((i) => i.inspectorId === where.inspectorId); rows.forEach((i) => Object.assign(i, data)); return { count: rows.length }; },
    },
    businessEntry: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    $executeRaw: async () => 0,
    $transaction: async (fn: (tx: Row) => unknown) => fn(prisma),
  };
  return { state, prisma };
});

vi.mock("../lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = "u1"; req.householdId = req.headers["x-test-household"] ?? "h1"; next(); },
}));

import { createApp } from "../app";

let server: Server;
let base = "";
beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/business`;
});
afterAll(() => { server.close(); });
beforeEach(() => { Object.assign(h.state, { contacts: [], people: [], records: [], products: [], payments: [], shipments: [], inspections: [] }); });

const call = async (method: string, path: string, body?: unknown, household = "h1") => {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-test-household": household }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON (a CSV) */ }
  return { status: res.status, body: json, text, headers: res.headers };
};
const add = async (name: string, over: Record<string, unknown> = {}, household = "h1") => (await call("POST", "/contacts", { name, types: ["SUPPLIER_MANUFACTURER"], ...over }, household)).body;
const order = (over: Record<string, unknown> = {}) => ({ origin: "OVERSEAS", itemDescription: "Ergonomic Cushion", quantity: 100, unitCostCents: 500, currency: "USD", ...over });

describe("add, view and edit a contact", () => {
  it("adds a supplier once, with several types and a first person, and shows it back", async () => {
    const r = await call("POST", "/contacts", {
      name: "  ABC Manufacturing Co Ltd ", types: ["SUPPLIER_MANUFACTURER", "FREIGHT_FORWARDER"], person: { name: "John Smith", role: "Sales" },
      email: "john@example.com", wechat: "john123", phone: "+86 755 0000", country: "China", city: "Shenzhen", website: "www.abc.example",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "ABC Manufacturing Co Ltd", types: ["SUPPLIER_MANUFACTURER", "FREIGHT_FORWARDER"], wechat: "john123", website: "https://www.abc.example", country: "China" });
    expect(r.body.people).toMatchObject([{ name: "John Smith", role: "Sales", isPrimary: true }]);

    const view = await call("GET", `/contacts/${r.body.id}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ name: "ABC Manufacturing Co Ltd", email: "john@example.com" });
    expect(view.body.activity).toEqual({ orders: [], payments: [], shipments: [], inspections: [], entries: [] });
  });

  it("is one contact for a business that is several things — not one record per role", async () => {
    await add("ABC", { types: ["SUPPLIER_MANUFACTURER", "WAREHOUSE_3PL", "CUSTOMER"] });
    expect(h.state.contacts).toHaveLength(1);
  });

  it("asks for what's missing in plain English", async () => {
    expect((await call("POST", "/contacts", { types: ["CUSTOMER"] })).status).toBe(400);
    expect((await call("POST", "/contacts", { name: "X", types: [] })).status).toBe(400);
    expect((await call("POST", "/contacts", { name: "X", types: ["CUSTOMER"], email: "nope" })).status).toBe(400);
    expect((await call("POST", "/contacts", { name: "X", types: ["CUSTOMER"], website: "javascript:alert(1)" })).status).toBe(400);
    expect(h.state.contacts).toHaveLength(0);
  });

  it("edits a contact, keeping its people", async () => {
    const c = await add("ABC", { person: { name: "John" } });
    const r = await call("PUT", `/contacts/${c.id}`, { name: "ABC Manufacturing", types: ["SUPPLIER_MANUFACTURER", "INSPECTION"], phone: "123", paymentTerms: "30/70", currency: "usd" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "ABC Manufacturing", types: ["SUPPLIER_MANUFACTURER", "INSPECTION"], phone: "123", currency: "USD" });
    expect(r.body.people).toHaveLength(1);
  });
});

describe("duplicates", () => {
  it("warns instead of silently creating the same company again, and offers the existing one", async () => {
    const first = await add("ABC Manufacturing Co Ltd");
    const r = await call("POST", "/contacts", { name: "abc  manufacturing co. ltd", types: ["SUPPLIER_MANUFACTURER"] });
    expect(r.status).toBe(409);
    expect(r.body.duplicates).toEqual([{ id: first.id, name: "ABC Manufacturing Co Ltd", match: "same", isArchived: false }]);
    expect(h.state.contacts).toHaveLength(1);
  });

  it("also notices a near match, and lets the person go ahead anyway", async () => {
    await add("ABC Manufacturing Co Ltd");
    const warn = await call("POST", "/contacts", { name: "ABC Manufacturing", types: ["CUSTOMER"] });
    expect(warn.status).toBe(409);
    expect(warn.body.duplicates[0].match).toBe("similar");
    const forced = await call("POST", "/contacts", { name: "ABC Manufacturing", types: ["CUSTOMER"], allowDuplicate: true });
    expect(forced.status).toBe(201);
    expect(h.state.contacts).toHaveLength(2);
  });

  it("applies when renaming a contact into an existing name, but not when saving it unchanged", async () => {
    await add("ABC Freight");
    const b = await add("XYZ Logistics");
    expect((await call("PUT", `/contacts/${b.id}`, { name: "abc freight", types: ["LOGISTICS"] })).status).toBe(409);
    expect((await call("PUT", `/contacts/${b.id}`, { name: "XYZ Logistics", types: ["LOGISTICS"], phone: "1" })).status).toBe(200);
  });

  it("isn't tripped by a different business that merely starts the same", async () => {
    await add("ABC Manufacturing");
    expect((await call("POST", "/contacts", { name: "ABC Freight", types: ["FREIGHT_FORWARDER"] })).status).toBe(201);
  });
});

describe("search and filters", () => {
  beforeEach(async () => {
    await add("ABC Manufacturing", { country: "China", email: "sales@abcmfg.com", person: { name: "John" } });
    await add("ABC Freight", { types: ["FREIGHT_FORWARDER"], country: "Hong Kong", phone: "+852 1111" });
    await add("ABC Customs", { types: ["CUSTOMS_AGENT"], country: "Australia" });
    await add("Zed Warehousing", { types: ["WAREHOUSE_3PL", "CUSTOMER"], country: "Australia" });
  });
  const names = async (qs: string) => (await call("GET", `/contacts${qs}`)).body.items.map((i: any) => i.name);

  it("finds by company name, ignoring case", async () => {
    expect(await names("?q=abc")).toEqual(["ABC Customs", "ABC Freight", "ABC Manufacturing"]);
    expect(await names("?q=ABC")).toEqual(["ABC Customs", "ABC Freight", "ABC Manufacturing"]);
  });
  it("finds by person, email, phone, country and type", async () => {
    expect(await names("?q=john")).toEqual(["ABC Manufacturing"]);
    expect(await names("?q=abcmfg.com")).toEqual(["ABC Manufacturing"]);
    expect(await names("?q=852")).toEqual(["ABC Freight"]);
    expect(await names("?q=australia")).toEqual(["ABC Customs", "Zed Warehousing"]);
    expect(await names("?q=freight")).toEqual(["ABC Freight"]);
    expect(await names("?q=warehouse")).toEqual(["Zed Warehousing"]);
  });
  it("filters by type (a contact with several types appears under each) and by country", async () => {
    expect(await names("?type=CUSTOMER")).toEqual(["Zed Warehousing"]);
    expect(await names("?type=WAREHOUSE_3PL")).toEqual(["Zed Warehousing"]);
    expect(await names("?type=SUPPLIER_MANUFACTURER")).toEqual(["ABC Manufacturing"]);
    expect(await names("?country=Australia&type=CUSTOMS_AGENT")).toEqual(["ABC Customs"]);
  });
  it("lists only the countries you actually have, for the filter", async () => {
    expect((await call("GET", "/contacts")).body.countries).toEqual(["Australia", "China", "Hong Kong"]);
  });
  it("returns an empty list, not an error, when nothing matches", async () => {
    expect(await names("?q=nothingmatches")).toEqual([]);
  });
});

describe("archive and delete", () => {
  it("archives (hidden from lists and pickers, still there under Archived) and restores", async () => {
    const c = await add("Old Supplier");
    await add("Current Supplier");
    expect((await call("POST", `/contacts/${c.id}/archive`)).body.isArchived).toBe(true);
    expect((await call("GET", "/contacts")).body.items.map((i: any) => i.name)).toEqual(["Current Supplier"]);
    expect((await call("GET", "/contacts/options")).body.map((i: any) => i.name)).toEqual(["Current Supplier"]);
    expect((await call("GET", "/contacts?status=archived")).body.items.map((i: any) => i.name)).toEqual(["Old Supplier"]);
    expect((await call("GET", `/contacts/options?includeId=${c.id}`)).body.map((i: any) => i.name)).toEqual(["Current Supplier", "Old Supplier"]);
    expect((await call("POST", `/contacts/${c.id}/unarchive`)).body.isArchived).toBe(false);
    expect((await call("GET", "/contacts")).body.items).toHaveLength(2);
  });

  it("deletes a contact that isn't used anywhere", async () => {
    const c = await add("Unused");
    expect((await call("DELETE", `/contacts/${c.id}`)).status).toBe(200);
    expect((await call("GET", `/contacts/${c.id}`)).status).toBe(404);
  });

  it("won't delete a contact that is used, and says to archive it instead — nothing is lost", async () => {
    const c = await add("Acme", { country: "China" });
    await call("POST", "/sourcing", order({ supplierId: c.id }));
    const r = await call("DELETE", `/contacts/${c.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Archive it instead/);
    expect(h.state.contacts).toHaveLength(1);
    expect(h.state.records[0]!.supplierId).toBe(c.id);
  });
});

describe("several people at one business", () => {
  it("adds people, with one main person at a time", async () => {
    const c = await add("ABC");
    const john = (await call("POST", `/contacts/${c.id}/people`, { name: "John", role: "Sales", wechat: "j1" })).body;
    const mary = (await call("POST", `/contacts/${c.id}/people`, { name: "Mary", role: "Accounts", email: "mary@abc.com" })).body;
    expect(john.isPrimary).toBe(true);
    expect(mary.isPrimary).toBe(false);
    await call("PUT", `/contacts/${c.id}/people/${mary.id}`, { name: "Mary", isPrimary: true });
    const people = (await call("GET", `/contacts/${c.id}`)).body.people;
    expect(people.map((p: any) => [p.name, p.isPrimary])).toEqual([["Mary", true], ["John", false]]);
  });

  it("promotes someone else when the main person is removed", async () => {
    const c = await add("ABC");
    const a = (await call("POST", `/contacts/${c.id}/people`, { name: "A" })).body;
    await call("POST", `/contacts/${c.id}/people`, { name: "B" });
    expect((await call("DELETE", `/contacts/${c.id}/people/${a.id}`)).status).toBe(200);
    expect((await call("GET", `/contacts/${c.id}`)).body.people).toMatchObject([{ name: "B", isPrimary: true }]);
  });

  it("needs a name, and can't touch a person at a different contact", async () => {
    const c = await add("ABC");
    const other = await add("XYZ");
    const p = (await call("POST", `/contacts/${c.id}/people`, { name: "A" })).body;
    expect((await call("POST", `/contacts/${c.id}/people`, { role: "Sales" })).status).toBe(400);
    expect((await call("PUT", `/contacts/${other.id}/people/${p.id}`, { name: "Hacked" })).status).toBe(404);
    expect((await call("DELETE", `/contacts/${other.id}/people/${p.id}`)).status).toBe(404);
  });
});

describe("one source of truth for a supplier on an order", () => {
  it("fills the order's supplier from the contact and links them", async () => {
    const c = await add("ABC Manufacturing", { country: "China", email: "john@example.com", phone: "+86 1", person: { name: "John Smith" } });
    const r = await call("POST", "/sourcing", order({ supplierId: c.id }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      supplierId: c.id, supplierName: "ABC Manufacturing", supplierCountry: "China", supplierEmail: "john@example.com", supplierPhone: "+86 1", supplierContactName: "John Smith",
      supplier: { id: c.id, name: "ABC Manufacturing" },
    });
  });

  it("an overseas order needs the supplier's country — and tells you where to add it", async () => {
    const c = await add("No Country Co");
    const r = await call("POST", "/sourcing", order({ supplierId: c.id }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no country yet/);
    expect((await call("POST", "/sourcing", order({ supplierId: c.id, origin: "LOCAL" }))).status).toBe(201);
  });

  it("a supplier typed by name (an older screen, an import) is matched to the contact — never duplicated", async () => {
    const c = await add("ABC Manufacturing Co Ltd", { country: "China" });
    const r = await call("POST", "/sourcing", order({ supplierName: "abc manufacturing co. ltd", supplierCountry: "China" }));
    expect(r.status).toBe(201);
    expect(r.body.supplierId).toBe(c.id);
    expect(h.state.contacts).toHaveLength(1);
  });

  it("a brand-new supplier typed by name becomes a contact of its own, once, however many orders use it", async () => {
    await call("POST", "/sourcing", order({ supplierName: "Brand New Ltd", supplierCountry: "Vietnam" }));
    await call("POST", "/sourcing", order({ supplierName: "BRAND NEW LTD", supplierCountry: "Vietnam" }));
    expect(h.state.contacts).toHaveLength(1);
    expect(h.state.contacts[0]).toMatchObject({ name: "Brand New Ltd", country: "Vietnam", types: ",SUPPLIER_MANUFACTURER," });
    expect(h.state.records.every((x) => x.supplierId === h.state.contacts[0]!.id)).toBe(true);
  });

  it("existing orders that only have typed supplier details are linked to contacts the first time Contacts is opened — their text is untouched", async () => {
    h.state.records.push(
      { id: "old1", householdId: "h1", supplierId: null, supplierName: "Legacy Factory", supplierCountry: "China", supplierContactName: "Lee", supplierEmail: "lee@legacy.com", supplierPhone: null, supplierWebsite: null, supplierAddress: null, createdById: "u1", createdAt: new Date(1), productId: null },
      { id: "old2", householdId: "h1", supplierId: null, supplierName: "legacy factory", supplierCountry: "China", supplierContactName: null, supplierEmail: null, supplierPhone: "123", supplierWebsite: null, supplierAddress: null, createdById: "u1", createdAt: new Date(2), productId: null }
    );
    const list = (await call("GET", "/contacts")).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Legacy Factory", types: ["SUPPLIER_MANUFACTURER"], country: "China", email: "lee@legacy.com", phone: "123", primaryPerson: { name: "Lee" }, linkCount: 2 });
    expect(h.state.records.map((r) => r.supplierName)).toEqual(["Legacy Factory", "legacy factory"]);
    expect(h.state.records.every((r) => r.supplierId === list[0].id)).toBe(true);
    // Opening it again changes nothing.
    await call("GET", "/contacts");
    expect(h.state.contacts).toHaveLength(1);
  });

  it("editing the contact keeps its orders in step (name, country, email…)", async () => {
    const c = await add("ABC", { country: "China", email: "a@abc.com" });
    await call("POST", "/sourcing", order({ supplierId: c.id }));
    await call("PUT", `/contacts/${c.id}`, { name: "ABC Manufacturing", types: ["SUPPLIER_MANUFACTURER"], country: "China", email: "new@abc.com" });
    expect(h.state.records[0]).toMatchObject({ supplierName: "ABC Manufacturing", supplierEmail: "new@abc.com", supplierCountry: "China" });
  });

  it("shows the order under the contact", async () => {
    const c = await add("ABC", { country: "China" });
    const o = (await call("POST", "/sourcing", order({ supplierId: c.id, reference: "PO-1" }))).body;
    const view = (await call("GET", `/contacts/${c.id}`)).body;
    expect(view.activity.orders).toMatchObject([{ id: o.id, reference: "PO-1", itemDescription: "Ergonomic Cushion", currency: "USD" }]);
  });

  it("an archived contact can't be picked for something new, but an order already using it can still be edited", async () => {
    const c = await add("Retiring Co", { country: "China" });
    const o = (await call("POST", "/sourcing", order({ supplierId: c.id }))).body;
    await call("POST", `/contacts/${c.id}/archive`);
    expect((await call("POST", "/sourcing", order({ supplierId: c.id }))).status).toBe(400);
    expect((await call("PUT", `/sourcing/${o.id}`, order({ supplierId: c.id, itemDescription: "Updated" }))).status).toBe(200);
  });
});

describe("keeping each company's data separate", () => {
  it("never shows, edits, archives, deletes or links another company's contact", async () => {
    const theirs = await add("Their Supplier", { country: "China" }, "h2");
    expect((await call("GET", `/contacts/${theirs.id}`)).status).toBe(404);
    expect((await call("PUT", `/contacts/${theirs.id}`, { name: "Mine now", types: ["OTHER"] })).status).toBe(404);
    expect((await call("POST", `/contacts/${theirs.id}/archive`)).status).toBe(404);
    expect((await call("DELETE", `/contacts/${theirs.id}`)).status).toBe(404);
    expect((await call("POST", `/contacts/${theirs.id}/people`, { name: "Spy" })).status).toBe(404);
    expect((await call("POST", "/sourcing", order({ supplierId: theirs.id }))).status).toBe(404);
    expect((await call("GET", "/contacts")).body.items).toEqual([]);
    expect((await call("GET", "/contacts/options")).body).toEqual([]);
    expect(h.state.contacts[0]!.name).toBe("Their Supplier");
  });

  it("the same company name can exist in two different companies' books", async () => {
    await add("ABC", {}, "h1");
    expect((await call("POST", "/contacts", { name: "ABC", types: ["CUSTOMER"] }, "h2")).status).toBe(201);
  });

  it("Contacts are only for a Company Finance portfolio", async () => {
    expect((await call("GET", "/contacts", undefined, "p1")).status).toBe(403);
    expect((await call("POST", "/contacts", { name: "X", types: ["OTHER"] }, "p1")).status).toBe(403);
  });
});

describe("contacts CSV", () => {
  const post = (csv: string, commit: boolean, household = "h1") => call("POST", "/contacts/import", { csv, commit }, household);
  const FILE = [
    "Company Name,Contact Type,Contact Person,Role,Email,Phone,WeChat,Country,Website",
    "ABC Manufacturing Co Ltd,Supplier / Manufacturer,John Smith,Sales,info@abc.com,+86 1,abc123,China,www.abc.com",
    "abc manufacturing co. ltd,,Mary,Accounts,mary@abc.com,,,,",
    "XYZ Logistics,Freight Forwarder; Shipping / Logistics,,,ops@xyz.com,,,Hong Kong,",
  ].join("\n");

  it("previews without saving anything", async () => {
    const r = await post(FILE, false);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ committed: false, summary: { create: 2, update: 0, skip: 0, error: 0 } });
    expect(r.body.rows[0]).toMatchObject({ name: "ABC Manufacturing Co Ltd", action: "create", people: ["John Smith", "Mary"] });
    expect(h.state.contacts).toHaveLength(0);
  });

  it("imports companies with their people and several types", async () => {
    await post(FILE, true);
    const items = (await call("GET", "/contacts")).body.items;
    expect(items.map((i: any) => [i.name, i.types, i.personCount])).toEqual([
      ["ABC Manufacturing Co Ltd", ["SUPPLIER_MANUFACTURER"], 2],
      ["XYZ Logistics", ["FREIGHT_FORWARDER", "LOGISTICS"], 0],
    ]);
    const abc = (await call("GET", `/contacts/${items[0].id}`)).body;
    expect(abc).toMatchObject({ email: "info@abc.com", wechat: "abc123", country: "China", website: "https://www.abc.com" });
    expect(abc.people.map((p: any) => [p.name, p.email])).toEqual([["John Smith", null], ["Mary", "mary@abc.com"]]);
  });

  it("importing the same file again changes nothing (no duplicates)", async () => {
    await post(FILE, true);
    const again = await post(FILE, true);
    expect(again.body.summary).toMatchObject({ create: 0, update: 0, skip: 2 });
    expect(h.state.contacts).toHaveLength(2);
    expect(h.state.people).toHaveLength(2);
  });

  it("only adds to a contact you already have — fills blanks, adds people and types, never overwrites", async () => {
    const c = await add("ABC Manufacturing Co Ltd", { country: "China", phone: "KEEP-ME", person: { name: "John Smith" } });
    const r = await post("Company Name,Contact Type,Contact Person,Phone,Email,Country\nABC Manufacturing Co Ltd,Customer,David,CHANGED,new@abc.com,Japan\n", true);
    expect(r.body.summary.update).toBe(1);
    const view = (await call("GET", `/contacts/${c.id}`)).body;
    expect(view).toMatchObject({ phone: "KEEP-ME", country: "China", email: "new@abc.com", types: ["SUPPLIER_MANUFACTURER", "CUSTOMER"] });
    expect(view.people.map((p: any) => p.name)).toEqual(["John Smith", "David"]);
  });

  it("reports a bad row by its row number and still imports the good ones", async () => {
    const r = await post("Company Name,Email\nGood Co,good@co.com\nBad Co,not-an-email\n", true);
    expect(r.body.summary).toMatchObject({ create: 1, error: 1 });
    expect(r.body.rows.find((x: any) => x.action === "error").messages[0]).toMatch(/row 3.*Email.*doesn't look right/);
    expect(h.state.contacts.map((c) => c.name)).toEqual(["Good Co"]);
  });

  it("explains an unusable file in plain English", async () => {
    expect((await post("", false)).status).toBe(400);
    const r = await post("Email,Phone\na@b.com,1\n", false);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Company Name/);
  });

  it("mentions types it didn't understand instead of dropping them silently", async () => {
    const r = await post("Company Name,Contact Type\nAcme,Supplier; Spaceship\n", false);
    expect(r.body.rows[0].messages[0]).toMatch(/Spaceship/);
  });

  it("exports human-readable columns with no ids, leaving archived contacts out", async () => {
    const a = await add("Keep Me", { person: { name: "John" }, email: "k@k.com" });
    const b = await add("Archive Me");
    await call("POST", `/contacts/${b.id}/archive`);
    const r = await call("GET", "/contacts/export.csv");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/csv/);
    expect(r.text).toContain("Company Name,Contact Type,Contact Person");
    expect(r.text).toContain("Keep Me");
    expect(r.text).not.toContain("Archive Me");
    expect(r.text).not.toContain(a.id);
  });

  it("another company's contacts never appear in your export", async () => {
    await add("Secret Co", {}, "h2");
    expect((await call("GET", "/contacts/export.csv")).text).not.toContain("Secret Co");
  });

  it("offers a template", async () => {
    const r = await call("GET", "/contacts/template.csv");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Example row - delete before importing");
  });
});

describe("payments, shipments and inspections pick their contacts from the book", () => {
  const setup = async () => {
    const supplier = await add("ABC Manufacturing", { country: "China" });
    const forwarder = await add("XYZ Logistics", { types: ["FREIGHT_FORWARDER"] });
    const customs = await add("ABC Customs", { types: ["CUSTOMS_AGENT"] });
    const inspector = await add("QC Pros", { types: ["INSPECTION"] });
    const o = (await call("POST", "/sourcing", order({ supplierId: supplier.id }))).body;
    return { supplier, forwarder, customs, inspector, orderId: o.id as string };
  };
  const pay = { date: "2026-10-06", amountCents: 500000, type: "DEPOSIT" };

  it("a payment can name who was paid, and it shows up under that contact", async () => {
    const { forwarder, orderId } = await setup();
    const r = await call("POST", `/sourcing/${orderId}/payments`, { ...pay, contactId: forwarder.id });
    expect(r.status).toBe(201);
    expect(r.body.payments[0]).toMatchObject({ contactId: forwarder.id, contact: { id: forwarder.id, name: "XYZ Logistics" } });
    const view = (await call("GET", `/contacts/${forwarder.id}`)).body;
    expect(view.activity.payments).toMatchObject([{ amountCents: 500000, type: "DEPOSIT", currency: "USD", order: { id: orderId } }]);
  });

  it("a payment with no other payee counts as a payment to the order's supplier", async () => {
    const { supplier, orderId } = await setup();
    await call("POST", `/sourcing/${orderId}/payments`, pay);
    expect((await call("GET", `/contacts/${supplier.id}`)).body.activity.payments).toHaveLength(1);
  });

  it("editing a payment without a contact leaves the link; sending null clears it", async () => {
    const { forwarder, orderId } = await setup();
    const created = (await call("POST", `/sourcing/${orderId}/payments`, { ...pay, contactId: forwarder.id })).body.payments[0];
    const kept = await call("PUT", `/sourcing/${orderId}/payments/${created.id}`, { ...pay, amountCents: 600000 });
    expect(kept.body.payments[0]).toMatchObject({ amountCents: 600000, contactId: forwarder.id });
    const cleared = await call("PUT", `/sourcing/${orderId}/payments/${created.id}`, { ...pay, contactId: null });
    expect(cleared.body.payments[0].contactId).toBeNull();
  });

  it("a payment can't name another company's contact, or an archived one", async () => {
    const { forwarder, orderId } = await setup();
    const theirs = await add("Their Forwarder", {}, "h2");
    expect((await call("POST", `/sourcing/${orderId}/payments`, { ...pay, contactId: theirs.id })).status).toBe(404);
    await call("POST", `/contacts/${forwarder.id}/archive`);
    expect((await call("POST", `/sourcing/${orderId}/payments`, { ...pay, contactId: forwarder.id })).status).toBe(400);
    expect(h.state.payments).toHaveLength(0);
  });

  it("a shipment picks a freight forwarder, customs agent and logistics provider, and fills the carrier from the forwarder", async () => {
    const { forwarder, customs, orderId } = await setup();
    const logistics = await add("Sea Lines", { types: ["LOGISTICS"] });
    const r = await call("POST", `/sourcing/${orderId}/shipments`, { method: "SEA", forwarderId: forwarder.id, customsAgentId: customs.id, logisticsId: logistics.id, freightCostCents: 120000 });
    expect(r.status).toBe(201);
    expect(r.body.shipments[0]).toMatchObject({
      carrier: "XYZ Logistics", forwarder: { name: "XYZ Logistics" }, customsAgent: { name: "ABC Customs" }, logistics: { name: "Sea Lines" }, warehouse: null,
    });
    const view = (await call("GET", `/contacts/${customs.id}`)).body;
    expect(view.activity.shipments).toMatchObject([{ roles: ["CUSTOMS_AGENT"], order: { id: orderId } }]);
  });

  it("a typed carrier is kept as typed, and the supplier sees the shipments of their own orders", async () => {
    const { supplier, forwarder, orderId } = await setup();
    const r = await call("POST", `/sourcing/${orderId}/shipments`, { carrier: "DHL Express", forwarderId: forwarder.id });
    expect(r.body.shipments[0].carrier).toBe("DHL Express");
    expect((await call("GET", `/contacts/${supplier.id}`)).body.activity.shipments).toMatchObject([{ roles: ["SUPPLIER"] }]);
  });

  it("editing a shipment can change or clear a contact without disturbing the others", async () => {
    const { forwarder, customs, orderId } = await setup();
    const created = (await call("POST", `/sourcing/${orderId}/shipments`, { forwarderId: forwarder.id, customsAgentId: customs.id })).body.shipments[0];
    const r = await call("PUT", `/sourcing/${orderId}/shipments/${created.id}`, { customsAgentId: null, forwarderId: forwarder.id });
    expect(r.body.shipments[0]).toMatchObject({ forwarderId: forwarder.id, customsAgentId: null });
  });

  it("an inspection picks the inspection company and records its name", async () => {
    const { inspector, orderId } = await setup();
    const r = await call("POST", `/sourcing/${orderId}/inspections`, { date: "2026-10-06", inspectorId: inspector.id, costCents: 30000 });
    expect(r.body.inspections[0]).toMatchObject({ inspector: "QC Pros", inspectorId: inspector.id, inspectorContact: { name: "QC Pros" } });
    expect((await call("GET", `/contacts/${inspector.id}`)).body.activity.inspections).toMatchObject([{ costCents: 30000, order: { id: orderId } }]);
    // Renaming the company brings the inspection's text name along.
    await call("PUT", `/contacts/${inspector.id}`, { name: "QC Pros International", types: ["INSPECTION"] });
    expect(h.state.inspections[0]!.inspector).toBe("QC Pros International");
  });
});
