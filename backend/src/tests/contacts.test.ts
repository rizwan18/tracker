import { describe, it, expect } from "vitest";
import {
  contactKey, looseContactKey, findDuplicates, typesToString, typesFromString, planSupplierBackfill, type SupplierBackfillRecord,
} from "../services/business/contacts";
import { parseTypesCell, groupContactRows, readContactsCsv, contactsToCsv, contactsTemplateCsv, CONTACT_COLUMNS, type ExportContact } from "../services/business/contactsCsv";
import { contactSchema, contactPersonSchema, sourcingRecordSchema } from "../lib/validation";

describe("contact names and duplicate detection", () => {
  it("treats case, spacing and punctuation as the same name", () => {
    expect(contactKey("ABC Manufacturing Co., Ltd")).toBe(contactKey("  abc   manufacturing co ltd "));
    expect(contactKey("Smith & Sons")).toBe(contactKey("smith and sons"));
  });

  it("ignores endings like Co Ltd / Pty Ltd when looking for similar names", () => {
    expect(looseContactKey("ABC Manufacturing Co Ltd")).toBe("abc manufacturing");
    expect(looseContactKey("The ABC Manufacturing Pty Ltd")).toBe("abc manufacturing");
  });

  const existing = [
    { id: "1", name: "ABC Manufacturing Co Ltd", isArchived: false },
    { id: "2", name: "ABC Freight", isArchived: false },
    { id: "3", name: "XYZ Logistics", isArchived: true },
  ];

  it("flags an exact match as the same, and a name that differs only by its ending as similar", () => {
    expect(findDuplicates(existing, "abc manufacturing co. ltd")).toEqual([{ id: "1", name: "ABC Manufacturing Co Ltd", match: "same", isArchived: false }]);
    expect(findDuplicates(existing, "ABC Manufacturing")).toEqual([{ id: "1", name: "ABC Manufacturing Co Ltd", match: "similar", isArchived: false }]);
  });

  it("does not flag companies that merely share a first word, and finds archived ones", () => {
    expect(findDuplicates(existing, "ABC Customs")).toEqual([]);
    expect(findDuplicates(existing, "XYZ Logistics")[0]).toMatchObject({ id: "3", isArchived: true });
  });

  it("never flags a contact against itself when it is being edited", () => {
    expect(findDuplicates(existing, "ABC Freight", "2")).toEqual([]);
  });
});

describe("contact types", () => {
  it("stores several types in a fixed order and reads them back", () => {
    const stored = typesToString(["CUSTOMER", "SUPPLIER_MANUFACTURER"]);
    expect(stored).toBe(",SUPPLIER_MANUFACTURER,CUSTOMER,");
    expect(typesFromString(stored)).toEqual(["SUPPLIER_MANUFACTURER", "CUSTOMER"]);
  });
  it("falls back to Other when nothing usable is stored", () => {
    expect(typesFromString("")).toEqual(["OTHER"]);
    expect(typesFromString(",NOT_A_TYPE,")).toEqual(["OTHER"]);
    expect(typesToString([])).toBe(",OTHER,");
  });
  it("a type is matched exactly, so one type is never mistaken for another", () => {
    expect(",SUPPLIER_MANUFACTURER,".includes(",LOGISTICS,")).toBe(false);
  });
});

describe("contact validation", () => {
  const ok = { name: "ABC Manufacturing", types: ["SUPPLIER_MANUFACTURER"] };

  it("needs a name and at least one type", () => {
    expect(contactSchema.safeParse({ types: ["CUSTOMER"] }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "  ", types: ["CUSTOMER"] }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "X", types: [] }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "X", types: ["NOPE"] }).success).toBe(false);
  });

  it("allows one business to have several types, without repeats", () => {
    const r = contactSchema.parse({ ...ok, types: ["FREIGHT_FORWARDER", "SUPPLIER_MANUFACTURER", "FREIGHT_FORWARDER"] });
    expect(r.types).toEqual(["SUPPLIER_MANUFACTURER", "FREIGHT_FORWARDER"]);
  });

  it("checks email, website, ABN and currency, and turns blanks into null", () => {
    expect(contactSchema.safeParse({ ...ok, email: "not-an-email" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...ok, website: "javascript:alert(1)" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...ok, abn: "123" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...ok, currency: "dollars" }).success).toBe(false);
    const r = contactSchema.parse({ ...ok, email: "", phone: " ", website: "www.example.com", currency: "usd", abn: "" });
    expect(r).toMatchObject({ email: null, phone: null, website: "https://www.example.com", currency: "USD", abn: null });
  });

  it("a person needs a name", () => {
    expect(contactPersonSchema.safeParse({ role: "Sales" }).success).toBe(false);
    expect(contactPersonSchema.parse({ name: " John ", wechat: "john123" })).toMatchObject({ name: "John", wechat: "john123", email: null });
  });
});

describe("an order's supplier", () => {
  const base = { origin: "OVERSEAS", itemDescription: "Cushion", quantity: 10, unitCostCents: 100 };
  it("can be a picked contact instead of typed details", () => {
    expect(sourcingRecordSchema.safeParse({ ...base, supplierId: "c1" }).success).toBe(true);
  });
  it("still needs a supplier name (and a country for overseas) when no contact is picked", () => {
    expect(sourcingRecordSchema.safeParse({ ...base }).success).toBe(false);
    expect(sourcingRecordSchema.safeParse({ ...base, supplierName: "Acme" }).success).toBe(false);
    expect(sourcingRecordSchema.safeParse({ ...base, supplierName: "Acme", supplierCountry: "China" }).success).toBe(true);
    expect(sourcingRecordSchema.safeParse({ ...base, origin: "LOCAL", supplierName: "Acme" }).success).toBe(true);
  });
});

describe("linking existing orders to supplier contacts (backfill plan)", () => {
  let n = 0;
  const rec = (over: Partial<SupplierBackfillRecord>): SupplierBackfillRecord => ({
    id: `r${++n}`, supplierName: "Acme Co", supplierCountry: null, supplierContactName: null, supplierEmail: null, supplierPhone: null, supplierWebsite: null, supplierAddress: null,
    createdById: "u1", createdAt: new Date(2026, 0, n), ...over,
  });

  it("makes ONE contact for orders from the same supplier, however it was typed", () => {
    const plan = planSupplierBackfill([rec({ supplierName: "Acme Co." }), rec({ supplierName: "  acme   co " }), rec({ supplierName: "Other Ltd" })], []);
    expect(plan.create.map((c) => c.name)).toEqual(["Acme Co.", "Other Ltd"]);
    expect(plan.create[0]!.recordIds).toHaveLength(2);
    expect(plan.link).toEqual([]);
  });

  it("uses the newest details and keeps every person named", () => {
    const plan = planSupplierBackfill(
      [
        rec({ supplierName: "Acme", supplierEmail: "old@acme.com", supplierContactName: "John", supplierCountry: "China" }),
        rec({ supplierName: "Acme", supplierEmail: "new@acme.com", supplierContactName: "Mary", supplierPhone: "123" }),
        rec({ supplierName: "Acme", supplierContactName: "john" }),
      ],
      []
    );
    expect(plan.create[0]).toMatchObject({ email: "new@acme.com", phone: "123", country: "China", people: ["John", "Mary"] });
  });

  it("reuses a contact you already have rather than making a duplicate", () => {
    const a = rec({ supplierName: "ABC Manufacturing Co Ltd" });
    const plan = planSupplierBackfill([a], [{ id: "c9", name: "abc manufacturing co. ltd" }]);
    expect(plan.create).toEqual([]);
    expect(plan.link).toEqual([{ contactId: "c9", recordIds: [a.id] }]);
  });

  it("does not guess that two differently-named suppliers are the same business", () => {
    const plan = planSupplierBackfill([rec({ supplierName: "ABC Manufacturing" }), rec({ supplierName: "ABC Manufacturing Co Ltd" })], []);
    expect(plan.create).toHaveLength(2);
  });

  it("does nothing when there is nothing to link", () => {
    expect(planSupplierBackfill([], [{ id: "c1", name: "X" }])).toEqual({ link: [], create: [] });
  });
});

describe("contact types in a spreadsheet", () => {
  it("understands the full labels, even though one contains a slash", () => {
    expect(parseTypesCell("Supplier / Manufacturer")).toEqual({ types: ["SUPPLIER_MANUFACTURER"], unknown: [] });
    expect(parseTypesCell("Supplier / Manufacturer; Freight Forwarder")).toEqual({ types: ["SUPPLIER_MANUFACTURER", "FREIGHT_FORWARDER"], unknown: [] });
  });
  it("understands everyday words and the internal names", () => {
    expect(parseTypesCell("supplier, customer").types).toEqual(["SUPPLIER_MANUFACTURER", "CUSTOMER"]);
    expect(parseTypesCell("3PL").types).toEqual(["WAREHOUSE_3PL"]);
    expect(parseTypesCell("Customs Agent|Inspection").types).toEqual(["INSPECTION", "CUSTOMS_AGENT"]);
    expect(parseTypesCell("FREIGHT_FORWARDER").types).toEqual(["FREIGHT_FORWARDER"]);
  });
  it("reports what it could not understand", () => {
    expect(parseTypesCell("Supplier; Spaceship")).toEqual({ types: ["SUPPLIER_MANUFACTURER"], unknown: ["Spaceship"] });
    expect(parseTypesCell("")).toEqual({ types: [], unknown: [] });
  });
});

describe("contacts CSV", () => {
  const contact = (over: Partial<ExportContact> = {}): ExportContact => ({
    id: "c1", name: "ABC Manufacturing Co Ltd", types: ",SUPPLIER_MANUFACTURER,FREIGHT_FORWARDER,", country: "China", state: "Guangdong", city: "Shenzhen", address: "Building 5",
    website: "https://example.com", email: "info@abc.com", phone: "+86 1", mobile: null, whatsapp: null, wechat: "abcfactory", otherContact: null, abn: null,
    registrationNumber: null, taxNumber: null, paymentTerms: "30/70", currency: "USD", notes: "=HYPERLINK(\"x\")", isArchived: false, createdAt: new Date(), updatedAt: new Date(),
    people: [
      { id: "p1", name: "John Smith", role: "Sales", email: "john@abc.com", phone: null, mobile: null, whatsapp: null, wechat: null, notes: null, isPrimary: true },
      { id: "p2", name: "Mary", role: "Accounts", email: null, phone: null, mobile: null, whatsapp: null, wechat: null, notes: null, isPrimary: false },
    ],
    ...over,
  });

  it("uses human column names and no database ids", () => {
    const csv = contactsToCsv([contact()]);
    const header = csv.replace(/^\uFEFF/, "").split("\r\n")[0]!;
    expect(header.startsWith("Company Name,Contact Type,Contact Person,Role,Email,Phone,Mobile,WhatsApp,WeChat,Address,City,State,Country,Website,Notes")).toBe(true);
    expect(csv).not.toMatch(/\bc1\b|\bp1\b/);
  });

  it("writes a company row, then one row per person with only their own details, and protects against spreadsheet formulas", () => {
    const rows = contactsToCsv([contact()]).replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toContain("info@abc.com");
    expect(rows[1]).not.toContain("John");
    expect(rows[2]).toContain("John Smith");
    expect(rows[2]).toContain("john@abc.com");
    expect(rows[3]).toContain("Mary");
    expect(rows[3]).not.toContain("info@abc.com"); // Mary has none of her own, so nothing is repeated
    expect(rows[1]).toContain("'=HYPERLINK"); // never starts with "="
  });

  it("keeps a company with one ordinary person, or nobody, to a single row", () => {
    const one = contact({ people: [{ id: "p1", name: "John Smith", role: "Sales", email: null, phone: null, mobile: null, whatsapp: null, wechat: null, notes: null, isPrimary: true }] });
    const rows = contactsToCsv([one]).trim().split("\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("John Smith");
    expect(rows[1]).toContain("info@abc.com");
    expect(contactsToCsv([contact({ people: [] })]).trim().split("\r\n")).toHaveLength(2);
  });

  it("round-trips: what is exported can be read back as the same company with the same people", () => {
    const { rows } = readContactsCsv(contactsToCsv([contact()]));
    const { groups } = groupContactRows(rows);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.name).toBe("ABC Manufacturing Co Ltd");
    expect(g.types).toEqual(["SUPPLIER_MANUFACTURER", "FREIGHT_FORWARDER"]);
    expect(g.company).toMatchObject({ country: "China", city: "Shenzhen", wechat: "abcfactory", currency: "USD", notes: '=HYPERLINK("x")' });
    expect(g.company.email).toBe("info@abc.com");
    expect(g.people.map((p) => [p.name, p.role, p.email])).toEqual([["John Smith", "Sales", "john@abc.com"], ["Mary", "Accounts", ""]]);
  });

  it("groups rows of the same company (however typed) into one contact with several people", () => {
    const csv = "Company Name,Contact Person,Email\nABC Mfg Co Ltd,John,john@abc.com\nabc mfg co. ltd,Mary,mary@abc.com\nXYZ,,x@x.com\n";
    const { groups } = groupContactRows(readContactsCsv(csv).rows);
    expect(groups.map((g) => [g.name, g.people.map((p) => p.name)])).toEqual([["ABC Mfg Co Ltd", ["John", "Mary"]], ["XYZ", []]]);
    expect(groups[0]!.company.email).toBe("john@abc.com");
    expect(groups[0]!.people[1]!.email).toBe("mary@abc.com");
    expect(groups[0]!.types).toEqual(["OTHER"]); // no type given → Other
  });

  it("accepts other headings for the same columns, and says which it ignored", () => {
    const csv = "Business,Type,Position,Telephone,Province,Favourite colour\nAcme,Supplier,Buyer,123,NSW,blue\n";
    const r = readContactsCsv(csv);
    expect(r.ignoredColumns).toEqual(["Favourite colour"]);
    expect(r.rows[0]!.cells).toMatchObject({ name: "Acme", types: "Supplier", role: "Buyer", phone: "123", state: "NSW" });
  });

  it("needs a Company Name column, and skips the template's example row", () => {
    expect(() => readContactsCsv("Email\na@b.com\n")).toThrow(/Company Name/);
    expect(() => readContactsCsv(contactsTemplateCsv())).toThrow(/no contacts/);
    expect(contactsTemplateCsv()).toContain("Example row - delete before importing");
    expect(CONTACT_COLUMNS.map((c) => c.header)).toContain("WeChat");
  });
});
