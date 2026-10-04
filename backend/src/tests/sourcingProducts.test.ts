import { describe, it, expect } from "vitest";
import { planProductBackfill, productKey, skuTaken } from "../services/business/products";
import { checkImageUpload, MAX_PHOTO_BYTES } from "../lib/images";
import { sourcingProductSchema, sourcingRecordSchema } from "../lib/validation";

const rec = (id: string, itemDescription: string, createdById = "u1") => ({ id, itemDescription, createdById });

describe("planProductBackfill (migrating existing sourcing records onto products)", () => {
  it("one product per distinct name, with every matching order under it", () => {
    const plan = planProductBackfill([rec("1", "VELTI Shower Filter"), rec("2", "Garden Hose"), rec("3", "VELTI Shower Filter")], []);
    expect(plan.create).toEqual([
      { name: "VELTI Shower Filter", createdById: "u1", recordIds: ["1", "3"] },
      { name: "Garden Hose", createdById: "u1", recordIds: ["2"] },
    ]);
    expect(plan.link).toEqual([]);
  });
  it("treats case and extra spaces as the same name, and uses the oldest order's wording", () => {
    const plan = planProductBackfill([rec("1", "VELTI Shower Filter"), rec("2", "  velti   SHOWER filter ")], []);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({ name: "VELTI Shower Filter", recordIds: ["1", "2"] });
  });
  it("does NOT merge names that merely look similar (it only trusts an exact name)", () => {
    const plan = planProductBackfill([rec("1", "VELTI Shower Filter"), rec("2", "VELTI Shower Filter V2"), rec("3", "Shower Filter")], []);
    expect(plan.create.map((c) => c.recordIds)).toEqual([["1"], ["2"], ["3"]]);
  });
  it("reuses a product that already exists instead of making a duplicate", () => {
    const plan = planProductBackfill([rec("1", "garden hose"), rec("2", "Brand New")], [{ id: "p-hose", name: "Garden Hose" }]);
    expect(plan.link).toEqual([{ productId: "p-hose", recordIds: ["1"] }]);
    expect(plan.create).toEqual([{ name: "Brand New", createdById: "u1", recordIds: ["2"] }]);
  });
  it("gives a blank description a placeholder name rather than losing the order", () => {
    expect(planProductBackfill([rec("1", "   ")], []).create[0]).toMatchObject({ name: "Untitled product", recordIds: ["1"] });
  });
  it("nothing to do → empty plan (so running it again changes nothing)", () => {
    expect(planProductBackfill([], [{ id: "p", name: "A" }])).toEqual({ link: [], create: [] });
  });
  it("every order appears in exactly one place — none lost, none duplicated", () => {
    const records = ["A", "a", "B", " b ", "C", "A"].map((n, i) => rec(String(i), n));
    const plan = planProductBackfill(records, [{ id: "pb", name: "B" }]);
    const ids = [...plan.create.flatMap((c) => c.recordIds), ...plan.link.flatMap((l) => l.recordIds)].sort();
    expect(ids).toEqual(records.map((r) => r.id).sort());
  });
  it("productKey ignores case and spacing only", () => {
    expect(productKey("  A   b ")).toBe("a b");
    expect(productKey("A-b")).not.toBe(productKey("A b"));
  });
});

describe("SKU uniqueness helper", () => {
  const products = [{ id: "1", sku: "ABC-1" }, { id: "2", sku: null }];
  it("detects a clash ignoring case and surrounding spaces", () => expect(skuTaken(products, " abc-1 ")).toBe(true));
  it("a product can keep its own SKU", () => expect(skuTaken(products, "ABC-1", "1")).toBe(false));
  it("no SKU never clashes", () => {
    expect(skuTaken(products, null)).toBe(false);
    expect(skuTaken(products, "")).toBe(false);
  });
  it("a different SKU is free", () => expect(skuTaken(products, "ABC-2")).toBe(false));
});

describe("product picture validation", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  it("accepts JPG, PNG and WebP by their real contents", () => {
    expect(checkImageUpload(JPG)).toEqual({ ok: true, type: "image/jpeg" });
    expect(checkImageUpload(PNG)).toEqual({ ok: true, type: "image/png" });
    expect(checkImageUpload(WEBP)).toEqual({ ok: true, type: "image/webp" });
  });
  it("rejects scripts, web pages, SVG, PDF and GIF", () => {
    for (const text of ["<html>", "<svg xmlns=…/>", "%PDF-1.7", "GIF89a....", "#!/bin/sh\nrm -rf /"]) {
      const r = checkImageUpload(new TextEncoder().encode(text));
      expect(r).toMatchObject({ ok: false, code: "NOT_AN_IMAGE" });
    }
  });
  it("rejects an empty file", () => expect(checkImageUpload(new Uint8Array())).toMatchObject({ ok: false, code: "EMPTY" }));
  it("rejects a file over the limit, and just at the limit is fine", () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(PNG);
    expect(checkImageUpload(big)).toMatchObject({ ok: false, code: "TOO_LARGE" });
    const edge = new Uint8Array(MAX_PHOTO_BYTES);
    edge.set(PNG);
    expect(checkImageUpload(edge).ok).toBe(true);
  });
  it("the messages are readable and leak nothing technical", () => {
    for (const bytes of [new Uint8Array(), new TextEncoder().encode("<html>")]) {
      const r = checkImageUpload(bytes);
      if (!r.ok) expect(r.message).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe("product and order validation", () => {
  it("a product needs a name; SKU and description are optional and tidied", () => {
    expect(sourcingProductSchema.safeParse({ name: "" }).success).toBe(false);
    expect(sourcingProductSchema.safeParse({}).success).toBe(false);
    expect(sourcingProductSchema.parse({ name: " Shower Filter ", sku: "  ", description: "" })).toEqual({ name: "Shower Filter", sku: null, description: null });
    expect(sourcingProductSchema.parse({ name: "X", sku: " V-1 " }).sku).toBe("V-1");
  });
  it("limits lengths", () => {
    expect(sourcingProductSchema.safeParse({ name: "x".repeat(151) }).success).toBe(false);
    expect(sourcingProductSchema.safeParse({ name: "x", sku: "x".repeat(61) }).success).toBe(false);
  });
  it("an order may name its product, but it's optional (older clients)", () => {
    const base = { origin: "LOCAL", itemDescription: "x", quantity: 5, unitCostCents: 100, supplierName: "S" };
    expect(sourcingRecordSchema.parse(base).productId).toBeUndefined();
    expect(sourcingRecordSchema.parse({ ...base, productId: "abc" }).productId).toBe("abc");
    expect(sourcingRecordSchema.safeParse({ ...base, productId: "" }).success).toBe(false);
  });
});
