import { describe, it, expect } from "vitest";
import { detectImageType, safeFileName, MAX_PHOTOS_PER_PROPERTY } from "../lib/images";
import { propertyManagerSchema } from "../lib/validation";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("detectImageType — believe the file's own bytes, not its name", () => {
  it("recognises JPEG, PNG and WebP", () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("image/png");
    expect(detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
  });
  it("rejects anything else, including web pages, scripts, SVG and empty files", () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(detectImageType(text("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(detectImageType(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(detectImageType(text("GIF89a"))).toBeNull();
    expect(detectImageType(bytes())).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull(); // too short to be a JPEG signature
    expect(detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull(); // RIFF but a WAV
  });
});

describe("safeFileName", () => {
  it("keeps a readable name, fixes the extension to the real type, and strips path tricks", () => {
    expect(safeFileName("Front of house.HEIC", "image/jpeg")).toBe("Front of house.jpg");
    expect(safeFileName("../../etc/passwd.png", "image/png")).toBe("etcpasswd.png");
    expect(safeFileName("<script>.jpg", "image/webp")).toBe("script.webp");
    expect(safeFileName("", "image/jpeg")).toBe("photo.jpg");
    expect(safeFileName("a".repeat(200) + ".jpg", "image/jpeg").length).toBeLessThanOrEqual(64);
  });
  it("has a sensible picture limit", () => {
    expect(MAX_PHOTOS_PER_PROPERTY).toBeGreaterThanOrEqual(6);
  });
});

describe("property manager details validation", () => {
  it("accepts a full set and trims", () => {
    const r = propertyManagerSchema.parse({ managerName: "  Jo Agent ", managerCompany: "Ray White Hawthorn", managerEmail: "jo@raywhite.example", managerPhone: "03 9999 0000", managerAddress: "1 High St, Hawthorn VIC 3122", managerNotes: "Call before 5pm" });
    expect(r).toMatchObject({ managerName: "Jo Agent", managerEmail: "jo@raywhite.example" });
  });
  it("treats blanks as not set", () => {
    const r = propertyManagerSchema.parse({ managerName: "", managerEmail: "  ", managerPhone: null });
    expect(r).toEqual({ managerName: null, managerCompany: null, managerEmail: null, managerPhone: null, managerAddress: null, managerNotes: null });
  });
  it("rejects an email that isn't one, and over-long text", () => {
    expect(propertyManagerSchema.safeParse({ managerEmail: "not an email" }).success).toBe(false);
    expect(propertyManagerSchema.safeParse({ managerEmail: "a@b" }).success).toBe(false);
    expect(propertyManagerSchema.safeParse({ managerName: "x".repeat(121) }).success).toBe(false);
    expect(propertyManagerSchema.safeParse({ managerNotes: "x".repeat(2001) }).success).toBe(false);
  });
});
