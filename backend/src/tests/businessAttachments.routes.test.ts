/**
 * Company expense attachments end to end: the real routes (auth scoping, upload parsing, validation, storage calls)
 * against in-memory stand-ins for the database and for Vercel Blob.
 *
 * Households: b1 and b2 are Company portfolios, p1 is a Personal one.
 * Users: u1 belongs to b1 + p1, u2 also belongs to b1 (a second person / a later sign-in), u3 belongs to b2 only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { zipSync, strToU8 } from "fflate";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    entries: [] as Row[],
    attachments: [] as Row[],
    journals: [] as Row[],
    seq: 0,
    failAttachmentCreate: false,
  };
  const types: Record<string, string> = { b1: "COMPANY", b2: "COMPANY", p1: "PERSONAL" };
  const members: Record<string, string[]> = { u1: ["b1", "p1"], u2: ["b1"], u3: ["b2"] };

  /** Vercel Blob stand-in: every put/get/del is recorded so tests can see exactly what storage was asked to do. */
  const blob = {
    files: new Map<string, { bytes: Buffer; contentType: string; access: string }>(),
    puts: [] as Row[],
    gets: [] as Row[],
    dels: [] as Row[],
    externalFetches: [] as string[],
    failPut: false,
    failDel: false,
    reset() {
      this.files.clear();
      this.puts.length = 0;
      this.gets.length = 0;
      this.dels.length = 0;
      this.externalFetches.length = 0;
      this.failPut = false;
      this.failDel = false;
    },
  };

  const chart = (hid: string) => [
    { id: `${hid}-bank`, code: "1000", name: "Business Bank Account", type: "ASSET", systemKey: null, isBank: true, isActive: true, householdId: hid },
    { id: `${hid}-office`, code: "6100", name: "Office Expenses", type: "EXPENSE", systemKey: null, isBank: false, isActive: true, householdId: hid },
    { id: `${hid}-sales`, code: "4000", name: "Sales", type: "INCOME", systemKey: null, isBank: false, isActive: true, householdId: hid },
  ];

  const decorate = (e: Row) => ({
    ...e,
    account: chart(e.householdId).find((a) => a.id === e.accountId) ?? { id: e.accountId, code: "6100", name: "Office Expenses" },
    bankAccount: null,
    contact: null,
    _count: { attachments: state.attachments.filter((a) => a.entryId === e.id).length },
  });
  const inRange = (d: Date, r?: Row) => !r || ((!r.gte || d >= r.gte) && (!r.lte || d <= r.lte));
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (v === undefined ? true : row[k] === v));

  const prisma: Row = {
    household: { findUnique: async ({ where }: Row) => (types[where.id] ? { portfolioType: types[where.id] } : null) },
    ledgerAccount: {
      findFirst: async ({ where }: Row) =>
        chart(where.householdId).find((a) => a.id === where.id && (where.isBank === undefined || a.isBank === where.isBank) && (where.isActive === undefined || a.isActive === where.isActive)) ?? null,
    },
    journalEntry: { deleteMany: async ({ where }: Row) => { const before = state.journals.length; state.journals = state.journals.filter((j) => j.sourceId !== where.sourceId); return { count: before - state.journals.length }; } },
    businessEntry: {
      findFirst: async ({ where }: Row) => state.entries.find((e) => matches(e, where)) ?? null,
      findMany: async ({ where }: Row) =>
        state.entries.filter((e) => e.householdId === where.householdId && inRange(e.date, where.date) && (!where.kind || e.kind === where.kind) && (!where.status || e.status === where.status)).map(decorate),
      create: async ({ data }: Row) => {
        const row = { id: `e${++state.seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.entries.push(row);
        return decorate(row);
      },
      update: async ({ where, data }: Row) => {
        const row = state.entries.find((e) => e.id === where.id)!;
        Object.assign(row, data);
        return decorate(row);
      },
      // NOTE: deliberately does NOT emulate the database's cascade — the route must remove the file records itself.
      delete: async ({ where }: Row) => {
        state.entries = state.entries.filter((e) => e.id !== where.id);
        return {};
      },
    },
    businessEntryAttachment: {
      count: async ({ where }: Row) => state.attachments.filter((a) => matches(a, where)).length,
      findMany: async ({ where, select }: Row) => {
        const rows = state.attachments.filter((a) => matches(a, where)).sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)));
        // honour `select` so a test notices if the route ever asked for (and could leak) a column it shouldn't
        return select ? rows.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]]))) : rows;
      },
      findFirst: async ({ where }: Row) => state.attachments.find((a) => matches(a, where)) ?? null,
      create: async ({ data, select }: Row) => {
        if (state.failAttachmentCreate) throw new Error("database unavailable");
        const row = { id: `a${++state.seq}`, createdAt: new Date(Date.now() + state.seq), ...data };
        state.attachments.push(row);
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;
      },
      delete: async ({ where }: Row) => {
        state.attachments = state.attachments.filter((a) => a.id !== where.id);
        return {};
      },
      deleteMany: async ({ where }: Row) => {
        const before = state.attachments.length;
        state.attachments = state.attachments.filter((a) => !matches(a, where));
        return { count: before - state.attachments.length };
      },
    },
    $transaction: async (arg: any) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg)),
  };
  return { state, prisma, blob, types, members };
});

vi.mock("../lib/prisma", () => ({ prisma: h.prisma }));

// Same checks as the real requireAuth (signed in, and a member of the portfolio asked for), without the token and database lookups.
vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) return res.status(401).json({ error: "Please sign in to continue." });
    const household = req.headers["x-test-household"] ?? h.members[user]?.[0];
    if (!h.members[user]?.includes(household)) return res.status(403).json({ error: "You don't have access to that portfolio." });
    req.userId = user;
    req.householdId = household;
    next();
  },
}));

vi.mock("../services/business/ledgerStore", async (orig) => ({
  ...(await orig<typeof import("../services/business/ledgerStore")>()),
  ensureBusinessSetup: async () => ({ gstRegistered: true }),
  repostEntry: async () => undefined,
}));

vi.mock("@vercel/blob", () => {
  let n = 0;
  return {
    put: async (pathname: string, body: Buffer, opts: any) => {
      if (h.blob.failPut) throw new Error("storage is down");
      const finalPath = opts.addRandomSuffix ? pathname.replace(/(\.[a-z0-9]+)$/, `-r${++n}$1`) : pathname;
      const url = `https://store1.public.blob.vercel-storage.com/${finalPath}`;
      h.blob.files.set(opts.access === "private" ? finalPath : url, { bytes: Buffer.from(body), contentType: opts.contentType, access: opts.access });
      h.blob.puts.push({ pathname, opts, size: body.length });
      return { url, pathname: finalPath, contentType: opts.contentType };
    },
    get: async (key: string, opts: any) => {
      h.blob.gets.push({ key, opts });
      const f = h.blob.files.get(key);
      if (!f || f.access !== opts.access || !opts.token) return null;
      return { statusCode: 200, stream: new Response(f.bytes).body, headers: new Headers(), blob: { contentType: f.contentType, size: f.bytes.length } };
    },
    del: async (key: string, opts?: any) => {
      if (h.blob.failDel) throw new Error("storage is down");
      h.blob.dels.push({ key, opts });
      h.blob.files.delete(key);
    },
  };
});

import { createApp } from "../app";

let server: Server;
let base = "";
const realFetch = globalThis.fetch;
const listen = async (app: ReturnType<typeof createApp>) => {
  const s = app.listen(0);
  await new Promise((r) => s.once("listening", r));
  return s;
};
const urlOf = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/business`;

beforeAll(async () => {
  // Public-store files are read back with fetch(); answer those from the in-memory store and let everything else through.
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    h.blob.externalFetches.push(url);
    const f = h.blob.files.get(url);
    return f && url.includes(".public.blob.vercel-storage.com") ? new Response(f.bytes, { headers: { "content-type": f.contentType } }) : new Response("not found", { status: 404 });
  });
  server = await listen(createApp());
  base = urlOf(server);
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  Object.assign(h.state, { entries: [], attachments: [], journals: [], seq: 0, failAttachmentCreate: false });
  h.blob.reset();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
  delete process.env.ATTACHMENTS_READ_WRITE_TOKEN;
  delete process.env.ATTACHMENT_MAX_BYTES;
});

// ------------------------------------------------------------------------------------------ helpers

type Who = { user?: string | null; hid?: string };
const hdr = (who: Who = {}) => ({ ...(who.user === null ? {} : { "x-test-user": who.user ?? "u1" }), ...(who.hid ? { "x-test-household": who.hid } : {}) });
const json = async (res: Response) => ({ status: res.status, body: (await res.json().catch(() => ({}))) as any });
const call = async (method: string, path: string, who: Who = {}, body?: unknown) =>
  json(await fetch(`${base}${path}`, { method, headers: { ...hdr(who), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }));

const pdf = (size = 200) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(Math.max(0, size - 9), 0x41)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
const docx = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>" });
const xlsx = zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>" });
const docm = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w/>", "word/vbaProject.bin": "x" });

const upload = async (entryId: string, file: { name: string; bytes: Buffer; claimedType?: string }, who: Who = {}) => {
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: file.claimedType ?? "application/octet-stream" }), file.name);
  return json(await fetch(`${base}/entries/${entryId}/attachments`, { method: "POST", headers: hdr(who), body: form }));
};
const download = async (entryId: string, id: string, who: Who = {}, query = "") => {
  const res = await fetch(`${base}/entries/${entryId}/attachments/${id}/download${query}`, { headers: hdr(who) });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
};

const seedEntry = (over: Record<string, unknown> = {}) => {
  const row = { id: `e${++h.state.seq}`, householdId: "b1", kind: "EXPENSE", date: new Date("2026-10-01T00:00:00Z"), description: "Office chair", accountId: "b1-office", totalCents: 33000, gstCents: 3000, status: "PAID", createdAt: new Date(), ...over };
  h.state.entries.push(row);
  return row.id as string;
};
const expensePayload = (over: Record<string, unknown> = {}) => ({
  kind: "EXPENSE", date: "2026-10-01", description: "Laptop stand", accountId: "b1-office", amountCents: 12000, gstMode: "INCLUSIVE", status: "PAID", paidDate: "2026-10-01", bankAccountId: "b1-bank", ...over,
});

// ------------------------------------------------------------------------------------------ 1–3. attaching

describe("attaching files to expenses", () => {
  it("1. creates an expense, then attaches a file to it by its stable id", async () => {
    const created = await call("POST", "/entries", {}, expensePayload());
    expect(created.status).toBe(201);
    expect(created.body.attachmentCount).toBe(0);
    const entryId = created.body.id as string;

    const up = await upload(entryId, { name: "Supplier invoice.pdf", bytes: pdf(500) });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ entryId, fileName: "Supplier invoice.pdf", contentType: "application/pdf", sizeBytes: 500, previewable: true });
    expect(typeof up.body.uploadedAt).toBe("string");

    expect(h.state.attachments).toHaveLength(1);
    expect(h.state.attachments[0]).toMatchObject({ householdId: "b1", entryId, uploadedById: "u1", sizeBytes: 500, contentType: "application/pdf" });
    expect(h.blob.files.size).toBe(1);
  });

  it("2. attaches a document to an expense that already exists", async () => {
    const entryId = seedEntry();
    expect((await upload(entryId, { name: "Receipt.png", bytes: png })).status).toBe(201);
    const list = await call("GET", `/entries/${entryId}/attachments`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ fileName: "Receipt.png", contentType: "image/png" });
  });

  it("3. attaches several files (one request each), in every supported format, and lists them in order", async () => {
    const entryId = seedEntry();
    const files = [
      { name: "invoice.pdf", bytes: pdf() },
      { name: "photo.png", bytes: png },
      { name: "quote.docx", bytes: docx },
      { name: "costs.xlsx", bytes: xlsx },
    ];
    for (const f of files) expect((await upload(entryId, f)).status).toBe(201);
    const list = await call("GET", `/entries/${entryId}/attachments`);
    expect(list.body.items.map((i: any) => i.fileName)).toEqual(["invoice.pdf", "photo.png", "quote.docx", "costs.xlsx"]);
    expect(list.body.items.map((i: any) => i.previewable)).toEqual([true, true, false, false]);
    expect(new Set(h.state.attachments.map((a) => a.storageKey)).size).toBe(4); // each file has its own storage address
  });

  it("stops at the per-expense limit without storing anything", async () => {
    const entryId = seedEntry();
    for (let i = 0; i < 20; i++) h.state.attachments.push({ id: `old${i}`, householdId: "b1", entryId, fileName: `f${i}.pdf`, contentType: "application/pdf", sizeBytes: 1, storageKey: `k${i}`, createdAt: new Date(i) });
    const r = await upload(entryId, { name: "one-too-many.pdf", bytes: pdf() });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/up to 20 files/);
    expect(h.blob.puts).toHaveLength(0);
  });

  it("only expenses take attachments (not sales), and the file isn't stored", async () => {
    const saleId = seedEntry({ kind: "INCOME", accountId: "b1-sales" });
    const r = await upload(saleId, { name: "invoice.pdf", bytes: pdf() });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/only be attached to expenses/);
    expect(h.blob.puts).toHaveLength(0);
  });

  it("tells the form what is allowed", async () => {
    const r = await call("GET", "/attachment-limits");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ maxBytes: 4 * 1024 * 1024, maxFiles: 20 });
    expect(r.body.extensions).toEqual(expect.arrayContaining(["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx", "csv"]));
  });

  it("keeps non-English file names intact (the upload library decodes them as Latin-1)", async () => {
    const entryId = seedEntry();
    const r = await upload(entryId, { name: "Café — résumé 日本.pdf", bytes: pdf() });
    expect(r.status).toBe(201);
    expect(r.body.fileName).toBe("Café — résumé 日本.pdf");
  });

  it("never puts the uploaded file's name (or anything a person typed) into the storage path", async () => {
    const entryId = seedEntry();
    await upload(entryId, { name: "../../etc/passwd<script>.pdf", bytes: pdf() });
    const put = h.blob.puts[0]!;
    expect(put.pathname).toMatch(/^business-attachments\/b1\/e\d+\/[0-9a-f-]{36}\.pdf$/);
    expect(put.pathname).not.toMatch(/passwd|script|\.\./);
    expect(put.opts.addRandomSuffix).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------ 4–5. viewing, downloading, persistence

describe("viewing and downloading", () => {
  it("4. a refresh later: the list and the exact file bytes are still there", async () => {
    const entryId = seedEntry();
    const original = pdf(3000);
    const { body } = await upload(entryId, { name: "Bill.pdf", bytes: original });

    const list = await call("GET", `/entries/${entryId}/attachments`); // the "refreshed page"
    expect(list.body.items).toHaveLength(1);
    const file = await download(entryId, list.body.items[0].id);
    expect(file.status).toBe(200);
    expect(file.bytes.equals(original)).toBe(true);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-length")).toBe(String(original.length));
    expect(body.id).toBe(list.body.items[0].id);
  });

  it("downloads as an attachment by default, and views in the browser only for PDFs and pictures", async () => {
    const entryId = seedEntry();
    const a = (await upload(entryId, { name: "bill.pdf", bytes: pdf() })).body;
    const b = (await upload(entryId, { name: "letter.docx", bytes: docx })).body;
    expect((await download(entryId, a.id)).headers.get("content-disposition")).toMatch(/^attachment;/);
    expect((await download(entryId, a.id, {}, "?inline=1")).headers.get("content-disposition")).toMatch(/^inline;/);
    expect((await download(entryId, b.id, {}, "?inline=1")).headers.get("content-disposition")).toMatch(/^attachment;/); // Word is never shown inline
  });

  it("sends safe headers: the type we worked out, nosniff, no caching", async () => {
    const entryId = seedEntry();
    const a = (await upload(entryId, { name: "x.pdf", bytes: pdf(), claimedType: "text/html" })).body; // the browser's claim is ignored
    const f = await download(entryId, a.id);
    expect(f.headers.get("content-type")).toBe("application/pdf");
    expect(f.headers.get("x-content-type-options")).toBe("nosniff");
    expect(f.headers.get("cache-control")).toBe("private, no-store");
    expect(f.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("a hostile file name can't inject headers into the download", async () => {
    const entryId = seedEntry();
    const a = (await upload(entryId, { name: 'evil"; filename="x.exe\r\nSet-Cookie: a=b.pdf', bytes: pdf() })).body;
    const f = await download(entryId, a.id);
    const cd = f.headers.get("content-disposition")!;
    expect(cd).not.toMatch(/[\r\n]/);
    expect(f.headers.get("set-cookie")).toBeNull();
    expect(cd.startsWith("attachment;")).toBe(true);
  });

  it("never tells the browser where a file is stored", async () => {
    const entryId = seedEntry();
    const up = await upload(entryId, { name: "x.pdf", bytes: pdf() });
    const list = await call("GET", `/entries/${entryId}/attachments`);
    for (const dto of [up.body, ...list.body.items]) {
      expect(Object.keys(dto).sort()).toEqual(["contentType", "entryId", "fileName", "id", "previewable", "sizeBytes", "uploadedAt"]);
    }
    const everything = JSON.stringify([up.body, list.body]);
    expect(everything).not.toMatch(/storageKey|blob\.vercel|business-attachments|householdId|uploadedById/);
  });

  it("5. the file is still available to the same person signing in again, and to a colleague in the same portfolio", async () => {
    const entryId = seedEntry();
    const original = pdf(900);
    const { body } = await upload(entryId, { name: "x.pdf", bytes: original }, { user: "u1" });
    const again = await download(entryId, body.id, { user: "u1" }); // a new sign-in
    const colleague = await download(entryId, body.id, { user: "u2" }); // another device / person with access
    expect(again.bytes.equals(original)).toBe(true);
    expect(colleague.bytes.equals(original)).toBe(true);
  });

  it("5b. survives a redeploy: nothing is kept in the running app, only in the database and file storage", async () => {
    const entryId = seedEntry();
    const original = pdf(777);
    const { body } = await upload(entryId, { name: "x.pdf", bytes: original });
    const redeployed = await listen(createApp()); // a brand-new app instance, as after a deployment
    try {
      const res = await fetch(`${urlOf(redeployed)}/entries/${entryId}/attachments/${body.id}/download`, { headers: hdr() });
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(original)).toBe(true);
    } finally {
      redeployed.close();
    }
  });

  it("says so plainly when the stored file has gone missing", async () => {
    const entryId = seedEntry();
    const { body } = await upload(entryId, { name: "x.pdf", bytes: pdf() });
    h.blob.files.clear();
    const f = await download(entryId, body.id);
    expect(f.status).toBe(404);
    expect(JSON.parse(f.bytes.toString()).error).toMatch(/isn't available/);
  });
});

// ------------------------------------------------------------------------------------------ 6. access control

describe("6. access control", () => {
  it("needs a signed-in person for every route", async () => {
    const entryId = seedEntry();
    const { body } = await upload(entryId, { name: "x.pdf", bytes: pdf() });
    const anon = { user: null };
    expect((await call("GET", "/attachment-limits", anon)).status).toBe(401);
    expect((await call("GET", `/entries/${entryId}/attachments`, anon)).status).toBe(401);
    expect((await upload(entryId, { name: "y.pdf", bytes: pdf() }, anon)).status).toBe(401);
    expect((await download(entryId, body.id, anon)).status).toBe(401);
    expect((await call("DELETE", `/entries/${entryId}/attachments/${body.id}`, anon)).status).toBe(401);
    expect(h.state.attachments).toHaveLength(1);
    expect(h.blob.puts).toHaveLength(1);
  });

  it("another company's user cannot list, download, add to or remove files — and learns nothing about whether they exist", async () => {
    const entryId = seedEntry({ householdId: "b1" });
    const { body } = await upload(entryId, { name: "secret.pdf", bytes: pdf(321) }, { user: "u1", hid: "b1" });
    const intruder = { user: "u3", hid: "b2" };

    const list = await call("GET", `/entries/${entryId}/attachments`, intruder);
    const get = await download(entryId, body.id, intruder);
    const add = await upload(entryId, { name: "planted.pdf", bytes: pdf() }, intruder);
    const del = await call("DELETE", `/entries/${entryId}/attachments/${body.id}`, intruder);
    const missing = await call("GET", `/entries/does-not-exist/attachments`, intruder);

    expect([list.status, get.status, add.status, del.status]).toEqual([404, 404, 404, 404]);
    expect(list.body.error).toBe(missing.body.error); // same answer as for an id that doesn't exist
    expect(h.state.attachments).toHaveLength(1); // nothing planted, nothing removed
    expect(h.blob.puts).toHaveLength(1);
    expect(h.blob.dels).toHaveLength(0);
  });

  it("someone who isn't a member of a portfolio can't act in it by naming it", async () => {
    const entryId = seedEntry({ householdId: "b1" });
    const r = await call("GET", `/entries/${entryId}/attachments`, { user: "u3", hid: "b1" });
    expect(r.status).toBe(403);
  });

  it("a file can't be reached through a different expense's address", async () => {
    const a = seedEntry();
    const b = seedEntry();
    const { body } = await upload(a, { name: "x.pdf", bytes: pdf() });
    expect((await download(b, body.id)).status).toBe(404);
    expect((await call("DELETE", `/entries/${b}/attachments/${body.id}`)).status).toBe(404);
    expect(h.state.attachments).toHaveLength(1);
  });

  it("Company Finance only: a Personal portfolio is refused", async () => {
    const entryId = seedEntry({ householdId: "p1" });
    const hid = { hid: "p1" };
    expect((await call("GET", `/entries/${entryId}/attachments`, hid)).status).toBe(403);
    expect((await upload(entryId, { name: "x.pdf", bytes: pdf() }, hid)).status).toBe(403);
    expect(h.blob.puts).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------ 7. validation

describe("7. unsupported and oversized files are refused, and nothing is stored", () => {
  const refused = async (name: string, bytes: Buffer, status: number, message?: RegExp, claimedType?: string) => {
    const entryId = seedEntry();
    const r = await upload(entryId, { name, bytes, claimedType });
    expect(r.status, `${name}: ${JSON.stringify(r.body)}`).toBe(status);
    if (message) expect(r.body.error).toMatch(message);
    expect(h.blob.puts).toHaveLength(0);
    expect(h.state.attachments).toHaveLength(0);
  };

  it("web pages, scripts, SVG and programs — even when named and labelled as a PDF", async () => {
    await refused("invoice.pdf", Buffer.from("<!doctype html><script>alert(1)</script>"), 415, /isn't supported/, "application/pdf");
    await refused("logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 415, /isn't supported/, "image/svg+xml");
    await refused("photo.png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 415, undefined, "image/png");
    await refused("run.exe", Buffer.from("MZ\x90\x00\x03\x00"), 415, /isn't supported/);
    await refused("receipt.csv", Buffer.from("<html><body>x</body></html>"), 415);
  });

  it("macro-enabled Office files, and zips/presentations", async () => {
    await refused("macro.docx", docm, 415, /macros/);
    await refused("deck.pptx", zip({ "[Content_Types].xml": "<T/>", "ppt/presentation.xml": "<p/>" }), 415, /isn't supported/);
    await refused("archive.zip", zip({ "a.txt": "hi" }), 415);
  });

  it("empty files", async () => {
    await refused("empty.pdf", Buffer.alloc(0), 400, /empty/);
  });

  it("files over the size limit (ATTACHMENT_MAX_BYTES), and accepts one right at the limit", async () => {
    process.env.ATTACHMENT_MAX_BYTES = "2048";
    await refused("big.pdf", pdf(3000), 413, /too large.*under 0\.002 MB|too large/);
    const entryId = seedEntry();
    expect((await upload(entryId, { name: "exact.pdf", bytes: pdf(2048) })).status).toBe(201);
  });

  it("the default limit is 4 MB, below Vercel's request-size cap", async () => {
    const entryId = seedEntry();
    expect((await upload(entryId, { name: "just-under.pdf", bytes: pdf(4 * 1024 * 1024 - 100) })).status).toBe(201);
    const r = await upload(entryId, { name: "just-over.pdf", bytes: pdf(4 * 1024 * 1024 + 1) });
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/under 4 MB/);
  });

  it("two files in one request, or no file at all", async () => {
    const entryId = seedEntry();
    const two = new FormData();
    two.append("file", new Blob([pdf()]), "a.pdf");
    two.append("file", new Blob([pdf()]), "b.pdf");
    const r = await json(await fetch(`${base}/entries/${entryId}/attachments`, { method: "POST", headers: hdr(), body: two }));
    expect(r.status).toBe(400);
    const none = await json(await fetch(`${base}/entries/${entryId}/attachments`, { method: "POST", headers: hdr(), body: new FormData() }));
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/choose a file/);
    expect(h.blob.puts).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------ 8. failures

describe("8. failed and interrupted uploads leave nothing inconsistent", () => {
  it("storage is down: a friendly error, no record, no file", async () => {
    const entryId = seedEntry();
    h.blob.failPut = true;
    const r = await upload(entryId, { name: "x.pdf", bytes: pdf() });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/couldn't store that file/);
    expect(h.state.attachments).toHaveLength(0);
    expect(h.blob.files.size).toBe(0);
    expect(JSON.stringify(r.body)).not.toMatch(/storage is down/); // internals aren't shown
  });

  it("the database fails after the file was stored: the file is removed again (no orphan)", async () => {
    const entryId = seedEntry();
    h.state.failAttachmentCreate = true;
    const r = await upload(entryId, { name: "x.pdf", bytes: pdf() });
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/couldn't save that file/);
    expect(h.state.attachments).toHaveLength(0);
    expect(h.blob.puts).toHaveLength(1);
    expect(h.blob.dels).toHaveLength(1);
    expect(h.blob.files.size).toBe(0);
  });

  it("an upload cut off part-way is refused and stores nothing", async () => {
    const entryId = seedEntry();
    const truncated = '--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 and then the connection drops';
    const res = await fetch(`${base}/entries/${entryId}/attachments`, { method: "POST", headers: { ...hdr(), "content-type": "multipart/form-data; boundary=XYZ" }, body: truncated });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toMatch(/couldn't read that upload/);
    expect(h.blob.puts).toHaveLength(0);
    expect(h.state.attachments).toHaveLength(0);
  });

  it("a failed upload doesn't disturb files that were already attached", async () => {
    const entryId = seedEntry();
    await upload(entryId, { name: "good.pdf", bytes: pdf() });
    h.blob.failPut = true;
    expect((await upload(entryId, { name: "bad.pdf", bytes: pdf() })).status).toBe(502);
    const list = await call("GET", `/entries/${entryId}/attachments`);
    expect(list.body.items.map((i: any) => i.fileName)).toEqual(["good.pdf"]);
  });
});

// ------------------------------------------------------------------------------------------ 9–10. removal and deletion

describe("9. removing one file", () => {
  it("removes the file and its record but leaves the expense and the other files", async () => {
    const entryId = seedEntry();
    const keep = (await upload(entryId, { name: "keep.pdf", bytes: pdf() })).body;
    const drop = (await upload(entryId, { name: "drop.pdf", bytes: pdf() })).body;

    const r = await call("DELETE", `/entries/${entryId}/attachments/${drop.id}`);
    expect(r.status).toBe(200);
    expect(h.state.entries.some((e) => e.id === entryId)).toBe(true); // the expense is untouched
    expect(h.blob.files.size).toBe(1);
    expect(h.blob.dels).toHaveLength(1);
    const list = await call("GET", `/entries/${entryId}/attachments`);
    expect(list.body.items.map((i: any) => i.id)).toEqual([keep.id]);
    expect((await download(entryId, drop.id)).status).toBe(404);
    expect((await download(entryId, keep.id)).status).toBe(200);
  });

  it("if storage can't be reached the file is NOT reported as removed, and can be removed on retry", async () => {
    const entryId = seedEntry();
    const { body } = await upload(entryId, { name: "x.pdf", bytes: pdf() });
    h.blob.failDel = true;
    const r = await call("DELETE", `/entries/${entryId}/attachments/${body.id}`);
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/couldn't remove that file/);
    expect(h.state.attachments).toHaveLength(1); // still listed: nothing is silently left behind in storage
    expect((await download(entryId, body.id)).status).toBe(200);

    h.blob.failDel = false;
    expect((await call("DELETE", `/entries/${entryId}/attachments/${body.id}`)).status).toBe(200);
    expect(h.state.attachments).toHaveLength(0);
    expect(h.blob.files.size).toBe(0);
  });

  it("removing something already gone is a clear 404, not a crash", async () => {
    const entryId = seedEntry();
    expect((await call("DELETE", `/entries/${entryId}/attachments/nope`)).status).toBe(404);
  });
});

describe("10. deleting an expense cleans up its files", () => {
  it("removes every record and every stored file for that expense, and only that expense's", async () => {
    const doomed = seedEntry();
    const other = seedEntry();
    await upload(doomed, { name: "a.pdf", bytes: pdf() });
    await upload(doomed, { name: "b.png", bytes: png });
    const kept = (await upload(other, { name: "keep.pdf", bytes: pdf() })).body;
    expect(h.blob.files.size).toBe(3);

    const r = await call("DELETE", `/entries/${doomed}`);
    expect(r.status).toBe(200);
    expect(h.state.entries.some((e) => e.id === doomed)).toBe(false);
    expect(h.state.attachments.filter((a) => a.entryId === doomed)).toHaveLength(0); // no orphaned records
    expect(h.blob.dels).toHaveLength(2);
    expect(h.blob.files.size).toBe(1); // no orphaned files
    expect((await download(other, kept.id)).status).toBe(200); // the other expense's file is untouched
  });

  it("an expense with no files deletes exactly as before", async () => {
    const entryId = seedEntry();
    expect((await call("DELETE", `/entries/${entryId}`)).status).toBe(200);
    expect(h.blob.dels).toHaveLength(0);
  });

  it("a storage hiccup doesn't block deleting the expense; the stray file is logged by address for later cleanup", async () => {
    const entryId = seedEntry();
    await upload(entryId, { name: "x.pdf", bytes: pdf() });
    const [key] = [...h.blob.files.keys()];
    h.blob.failDel = true;

    const r = await call("DELETE", `/entries/${entryId}`);
    expect(r.status).toBe(200);
    expect(h.state.entries.some((e) => e.id === entryId)).toBe(false);
    expect(h.state.attachments).toHaveLength(0);
    expect(errorLog.mock.calls.some((c) => String(c[0]).includes(key!))).toBe(true);
  });

  it("another company can't delete an expense (and so can't reach its files)", async () => {
    const entryId = seedEntry({ householdId: "b1" });
    await upload(entryId, { name: "x.pdf", bytes: pdf() });
    expect((await call("DELETE", `/entries/${entryId}`, { user: "u3", hid: "b2" })).status).toBe(404);
    expect(h.state.attachments).toHaveLength(1);
    expect(h.blob.dels).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------ 11. existing behaviour

describe("11. existing expense create / edit / list keeps working", () => {
  it("the list shows how many files each expense has (0 for older expenses with none)", async () => {
    const plain = seedEntry({ description: "Plain expense" });
    const withFiles = seedEntry({ description: "Has files" });
    await upload(withFiles, { name: "a.pdf", bytes: pdf() });
    await upload(withFiles, { name: "b.pdf", bytes: pdf() });

    const r = await call("GET", "/entries?kind=EXPENSE");
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.items.map((i: any) => [i.id, i]));
    expect(byId[plain].attachmentCount).toBe(0);
    expect(byId[withFiles].attachmentCount).toBe(2);
    expect(byId[withFiles]).toMatchObject({ description: "Has files", kind: "EXPENSE", totalCents: 33000 }); // the rest of the record is as before
  });

  it("an expense can be created without any file, exactly as before", async () => {
    const r = await call("POST", "/entries", {}, expensePayload());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: "EXPENSE", description: "Laptop stand", totalCents: 12000, attachmentCount: 0 });
  });

  it("editing an expense keeps its files attached (same id) and the count in the reply", async () => {
    const created = (await call("POST", "/entries", {}, expensePayload())).body;
    await upload(created.id, { name: "a.pdf", bytes: pdf() });
    const edited = await call("PUT", `/entries/${created.id}`, {}, expensePayload({ description: "Laptop stand (corrected)", amountCents: 13000 }));
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ id: created.id, description: "Laptop stand (corrected)", totalCents: 13000, attachmentCount: 1 });
    const list = await call("GET", `/entries/${created.id}/attachments`);
    expect(list.body.items).toHaveLength(1);
  });

  it("sales are listed as before (no files, count 0)", async () => {
    seedEntry({ kind: "INCOME", accountId: "b1-sales", description: "A sale" });
    const r = await call("GET", "/entries?kind=INCOME");
    expect(r.body.items[0]).toMatchObject({ description: "A sale", attachmentCount: 0 });
  });
});

// ------------------------------------------------------------------------------------------ storage modes

describe("file storage modes", () => {
  it("default: the app's existing store, with an unguessable path; reads go through the app, never a link handed to the browser", async () => {
    const entryId = seedEntry();
    const { body } = await upload(entryId, { name: "x.pdf", bytes: pdf(64) });
    expect(h.blob.puts[0]!.opts).toMatchObject({ access: "public", addRandomSuffix: true, contentType: "application/pdf" });
    expect(h.blob.puts[0]!.opts.token).toBeUndefined();
    expect(h.state.attachments[0]!.storageKey).toMatch(/^https:\/\/store1\.public\.blob\.vercel-storage\.com\/business-attachments\/b1\//);
    expect((await download(entryId, body.id)).status).toBe(200);
  });

  it("recommended: with ATTACHMENTS_READ_WRITE_TOKEN set, files go to a private store and are read, and removed, with that token", async () => {
    process.env.ATTACHMENTS_READ_WRITE_TOKEN = "vercel_blob_rw_PRIVATE_TEST";
    const entryId = seedEntry();
    const original = pdf(128);
    const { body } = await upload(entryId, { name: "x.pdf", bytes: original });
    expect(h.blob.puts[0]!.opts).toMatchObject({ access: "private", token: "vercel_blob_rw_PRIVATE_TEST", addRandomSuffix: true });
    const key = h.state.attachments[0]!.storageKey as string;
    expect(key).toMatch(/^business-attachments\/b1\//); // a pathname, with no web address at all

    const f = await download(entryId, body.id);
    expect(f.bytes.equals(original)).toBe(true);
    expect(h.blob.gets[0]).toMatchObject({ key, opts: { access: "private", token: "vercel_blob_rw_PRIVATE_TEST" } });

    await call("DELETE", `/entries/${entryId}/attachments/${body.id}`);
    expect(h.blob.dels[0]).toMatchObject({ key, opts: { token: "vercel_blob_rw_PRIVATE_TEST" } });
  });

  it("switching modes later doesn't strand earlier files", async () => {
    const entryId = seedEntry();
    const oldFile = (await upload(entryId, { name: "old.pdf", bytes: pdf(50) })).body; // saved in the public store
    process.env.ATTACHMENTS_READ_WRITE_TOKEN = "tok";
    const newFile = (await upload(entryId, { name: "new.pdf", bytes: pdf(60) })).body; // saved in the private store
    expect((await download(entryId, oldFile.id)).status).toBe(200);
    expect((await download(entryId, newFile.id)).status).toBe(200);
    delete process.env.ATTACHMENTS_READ_WRITE_TOKEN;
    expect((await download(entryId, oldFile.id)).status).toBe(200);
    expect((await download(entryId, newFile.id)).status).toBe(404); // private store no longer configured → clearly unavailable, not a crash
  });

  it("only ever fetches Vercel Blob addresses (a tampered record can't make the server call another site)", async () => {
    const entryId = seedEntry();
    h.state.attachments.push({ id: "evil", householdId: "b1", entryId, fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 10, storageKey: "https://evil.example.com/steal", createdAt: new Date() });
    h.state.attachments.push({ id: "internal", householdId: "b1", entryId, fileName: "y.pdf", contentType: "application/pdf", sizeBytes: 10, storageKey: "https://169.254.169.254/latest/meta-data", createdAt: new Date() });
    expect((await download(entryId, "evil")).status).toBe(404);
    expect((await download(entryId, "internal")).status).toBe(404);
    expect(h.blob.externalFetches).toEqual([]);
  });
});
