import type { Prisma } from "@prisma/client";
import { getFinancialYearId } from "../../lib/financialYear";
import { ACCOUNT_TYPES, BILL_FREQUENCIES, BILL_STATUSES, DIVIDEND_STATUSES, INVESTMENT_TRANSACTION_TYPES, INVESTMENT_TYPES, PROPERTY_TYPES, REMINDER_STATUSES, RENT_FREQUENCIES, TRANSACTION_DIRECTIONS } from "../../lib/constants";
import { deriveId, type ParsedFile } from "./parseExport";
import { RowReader, contentKeyOf } from "./rowReader";
import { ID_TABLES, SECTION_ORDER, type IdTable, type SectionName } from "./sections";

export interface ImportContext {
  householdId: string;
  userId: string;
  userEmail: string;
  /** What kind of portfolio is being imported into (only PERSONAL can have a PPR). */
  portfolioType: string;
  /** The household's categories and accounts, so the file's ones can be matched by name instead of duplicated. */
  categories: Array<{ id: string; name: string; direction: string }>;
  accounts: Array<{ id: string; name: string; type: string }>;
  /** The signed-in person's current principal place of residence, if any. */
  ppr: { id: string; name: string } | null;
  /** For every candidate id: does it exist at all, and does it exist in this household? */
  exists: Record<IdTable, { anywhere: Set<string>; inHousehold: Set<string> }>;
}

export interface SectionSummary {
  inFile: number;
  toAdd: number;
  alreadyThere: number;
  skipped: number;
}

export interface ProfileUpdate {
  fullName?: string;
  timezone?: string;
  easyViewEnabled?: boolean;
  householdName?: string;
}

export interface ImportPlan {
  summary: Record<SectionName, SectionSummary>;
  warnings: string[];
  errors: string[];
  profile: ProfileUpdate | null;
  creates: {
    accounts: Prisma.AccountCreateManyInput[];
    categories: Prisma.CategoryCreateManyInput[];
    properties: Prisma.PropertyCreateManyInput[];
    propertyOwnerships: Prisma.PropertyOwnershipCreateManyInput[];
    scheduleLines: Prisma.PropertyScheduleLineCreateManyInput[];
    yearDetails: Prisma.PropertyYearDetailCreateManyInput[];
    photos: Prisma.PropertyPhotoCreateManyInput[];
    investments: Prisma.InvestmentCreateManyInput[];
    investmentTransactions: Prisma.InvestmentTransactionCreateManyInput[];
    dividends: Prisma.DividendCreateManyInput[];
    disposals: Prisma.CapitalGainDisposalCreateManyInput[];
    transactions: Prisma.TransactionCreateManyInput[];
    bills: Prisma.BillCreateManyInput[];
    reminders: Prisma.ReminderCreateManyInput[];
    documents: Prisma.DocumentCreateManyInput[];
  };
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const FY_RE = /^\d{4}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every id (and derived id) the file might end up using, so the database can be asked about them in one go. */
export function collectCandidateIds(parsed: ParsedFile, householdId: string): Record<IdTable, string[]> {
  const out = {} as Record<IdTable, string[]>;
  for (const table of ID_TABLES) {
    const set = new Set<string>();
    for (const row of parsed.sections.get(table) ?? []) {
      const raw = (row.cells.id ?? "").trim();
      if (raw) {
        set.add(raw);
        set.add(deriveId(householdId, table, raw));
      } else {
        set.add(deriveId(householdId, table, `row:${contentKeyOf(row.cells)}`));
      }
    }
    out[table] = [...set];
  }
  return out;
}

export function emptyExistence(): ImportContext["exists"] {
  const out = {} as ImportContext["exists"];
  for (const table of ID_TABLES) out[table] = { anywhere: new Set(), inHousehold: new Set() };
  return out;
}

function emptySummary(): Record<SectionName, SectionSummary> {
  const out = {} as Record<SectionName, SectionSummary>;
  for (const s of SECTION_ORDER) out[s] = { inFile: 0, toAdd: 0, alreadyThere: 0, skipped: 0 };
  return out;
}

/**
 * Works out what importing the file would do — without touching the database.
 *
 * Rules:
 *  - Anything already in the household (same id) is left exactly as it is; only
 *    missing records are added, so importing the same file twice changes nothing.
 *  - Ids from the file are kept when free. If an id belongs to someone else's
 *    data, a stable replacement id is used instead (never overwrites anything).
 *  - Categories and accounts are matched by name to the ones already there.
 *  - The person importing becomes the owner of imported properties, and a
 *    second principal place of residence is imported as an investment property.
 *  - A row with a problem is skipped and reported; the rest still import.
 */
export function planImport(parsed: ParsedFile, ctx: ImportContext, opts: { includeProfile: boolean }): ImportPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const summary = emptySummary();
  const creates: ImportPlan["creates"] = {
    accounts: [], categories: [], properties: [], propertyOwnerships: [], scheduleLines: [], yearDetails: [], photos: [], investments: [],
    investmentTransactions: [], dividends: [], disposals: [], transactions: [], bills: [], reminders: [], documents: [],
  };
  const householdId = ctx.householdId;
  const userId = ctx.userId;

  const rowsOf = (section: SectionName) => parsed.sections.get(section) ?? [];
  const reader = (section: SectionName, row: ReturnType<typeof rowsOf>[number]) => new RowReader(section, row, errors);
  const warn = (r: RowReader, message: string) => warnings.push(`${r.section.replace(/_/g, " ")}, row ${r.rowNo}: ${message}`);

  // file id -> the id the record has (or will have) in this household
  const idMap = {} as Record<IdTable, Map<string, string>>;
  const seen = {} as Record<IdTable, Set<string>>;
  for (const t of ID_TABLES) {
    idMap[t] = new Map();
    seen[t] = new Set();
  }

  // name lookups (null = ambiguous, never guessed)
  type NameIndex = Map<string, string | null>;
  const index = (m: NameIndex, key: string, id: string) => {
    const cur = m.get(key);
    if (cur === undefined) m.set(key, id);
    else if (cur !== id) m.set(key, null);
  };
  const names = { properties: new Map() as NameIndex, investments: new Map() as NameIndex, accounts: new Map() as NameIndex, categories: new Map() as NameIndex, categoriesAny: new Map() as NameIndex };
  const lower = (s: string) => s.trim().toLowerCase();
  for (const c of ctx.categories) {
    index(names.categories, `${c.direction}|${lower(c.name)}`, c.id);
    index(names.categoriesAny, lower(c.name), c.id);
  }
  for (const a of ctx.accounts) index(names.accounts, lower(a.name), a.id);

  function decideId(table: IdTable, r: RowReader): { raw: string; id: string; exists: boolean } {
    const raw = r.raw("id").trim();
    const ex = ctx.exists[table];
    if (raw && ID_RE.test(raw)) {
      if (ex.inHousehold.has(raw)) return { raw, id: raw, exists: true };
      if (!ex.anywhere.has(raw)) return { raw, id: raw, exists: false };
    }
    const derived = deriveId(householdId, table, raw || `row:${r.contentKey()}`);
    return { raw, id: derived, exists: ex.inHousehold.has(derived) };
  }

  /** Common bookkeeping for every id-bearing row. `build` reads the fields and returns the record to create. */
  function addRow<T>(section: IdTable, r: RowReader, build: (id: string) => T | null, push: (rec: T) => void, onIndexed?: (finalId: string) => void) {
    summary[section].inFile++;
    const decision = decideId(section, r);
    if (decision.raw && seen[section].has(decision.raw)) {
      warn(r, `the id “${decision.raw}” appears more than once — only the first is used.`);
      summary[section].skipped++;
      return;
    }
    const rec = build(decision.id);
    if (r.failed || rec === null) {
      summary[section].skipped++;
      return;
    }
    if (decision.raw) {
      seen[section].add(decision.raw);
      idMap[section].set(decision.raw, decision.id);
    }
    onIndexed?.(decision.id);
    if (decision.exists) summary[section].alreadyThere++;
    else {
      summary[section].toAdd++;
      push(rec);
    }
  }

  type RefTable = "properties" | "investments" | "accounts" | "categories" | "transactions" | "bills" | "dividends" | "capital_gain_disposals";
  function ref(table: RefTable, r: RowReader, idCol: string, nameCol: string | null, direction?: string): { id: string | null; given: boolean; label: string } {
    const rawId = r.raw(idCol).trim();
    if (rawId) {
      const mapped = idMap[table].get(rawId);
      if (mapped) return { id: mapped, given: true, label: rawId };
    }
    const name = nameCol ? r.str(nameCol, 200) : null;
    if (name) {
      let found: string | null | undefined;
      if (table === "properties") found = names.properties.get(lower(name));
      else if (table === "investments") found = names.investments.get(lower(name));
      else if (table === "accounts") found = names.accounts.get(lower(name));
      else if (table === "categories") found = direction ? names.categories.get(`${direction}|${lower(name)}`) : names.categoriesAny.get(lower(name));
      if (found) return { id: found, given: true, label: name };
    }
    return { id: null, given: !!rawId || !!name, label: name || rawId };
  }
  const optionalRef = (table: RefTable, r: RowReader, idCol: string, nameCol: string | null, what: string, direction?: string): string | null => {
    const res = ref(table, r, idCol, nameCol, direction);
    if (res.given && !res.id) warn(r, `${what} “${res.label}” isn't in the file or your account, so it was left blank.`);
    return res.id;
  };
  const requiredRef = (table: RefTable, r: RowReader, idCol: string, nameCol: string | null, what: string, direction?: string): string | null => {
    const res = ref(table, r, idCol, nameCol, direction);
    if (!res.id) r.fail(res.given ? `it belongs to ${what} “${res.label}”, which isn't in the file.` : `“${idCol}” is required.`);
    return res.id;
  };

  // ---- profile -------------------------------------------------------------
  let profile: ImportPlan["profile"] = null;
  const profileRow = rowsOf("profile")[0];
  if (profileRow) {
    summary.profile.inFile = 1;
    const r = reader("profile", profileRow);
    const update: ProfileUpdate = {};
    const fullName = r.str("full_name", 100);
    const tz = r.str("timezone", 60);
    const household = r.str("household_name", 100);
    const easy = r.raw("easy_view_enabled").trim() === "" ? null : r.bool("easy_view_enabled");
    if (fullName) update.fullName = fullName;
    if (household) update.householdName = household;
    if (easy !== null) update.easyViewEnabled = easy;
    if (tz) {
      try {
        new Intl.DateTimeFormat("en-AU", { timeZone: tz });
        update.timezone = tz;
      } catch {
        warn(r, `the timezone “${tz}” isn't recognised, so your timezone wasn't changed.`);
      }
    }
    if (r.failed) summary.profile.skipped = 1;
    else if (opts.includeProfile && Object.keys(update).length > 0) {
      profile = update;
      summary.profile.toAdd = 1;
    } else summary.profile.alreadyThere = 1;
  }

  // ---- accounts & categories (matched by name so defaults aren't duplicated) --
  for (const row of rowsOf("accounts")) {
    const r = reader("accounts", row);
    summary.accounts.inFile++;
    const name = r.requiredStr("name", 100);
    const type = r.oneOf("type", ACCOUNT_TYPES, { fallback: "OTHER" });
    if (r.failed || !name || !type) {
      summary.accounts.skipped++;
      continue;
    }
    const raw = r.raw("id").trim();
    const existingId = names.accounts.get(lower(name));
    if (existingId) {
      if (raw) idMap.accounts.set(raw, existingId);
      summary.accounts.alreadyThere++;
      continue;
    }
    const decision = decideId("accounts", r);
    if (decision.raw) idMap.accounts.set(decision.raw, decision.id);
    index(names.accounts, lower(name), decision.id);
    if (decision.exists) summary.accounts.alreadyThere++;
    else {
      summary.accounts.toAdd++;
      creates.accounts.push({ id: decision.id, householdId, name, type });
    }
  }

  for (const row of rowsOf("categories")) {
    const r = reader("categories", row);
    summary.categories.inFile++;
    const name = r.requiredStr("name", 100);
    const direction = r.oneOf("direction", TRANSACTION_DIRECTIONS, { required: true });
    const isCustom = r.bool("is_custom", false);
    if (r.failed || !name || !direction) {
      summary.categories.skipped++;
      continue;
    }
    const raw = r.raw("id").trim();
    const existingId = names.categories.get(`${direction}|${lower(name)}`);
    if (existingId) {
      if (raw) idMap.categories.set(raw, existingId);
      index(names.categoriesAny, lower(name), existingId);
      summary.categories.alreadyThere++;
      continue;
    }
    const decision = decideId("categories", r);
    if (decision.raw) idMap.categories.set(decision.raw, decision.id);
    index(names.categories, `${direction}|${lower(name)}`, decision.id);
    index(names.categoriesAny, lower(name), decision.id);
    if (decision.exists) summary.categories.alreadyThere++;
    else {
      summary.categories.toAdd++;
      creates.categories.push({ id: decision.id, householdId, name, direction, isCustom });
    }
  }

  // ---- properties -----------------------------------------------------------
  let pprTaken: { name: string } | null = ctx.ppr;
  const newProperties: Array<{ raw: string; id: string }> = [];
  for (const row of rowsOf("properties")) {
    const r = reader("properties", row);
    addRow(
      "properties",
      r,
      (id) => {
        const name = r.requiredStr("name", 200);
        let propertyType = r.oneOf("property_type", PROPERTY_TYPES, { fallback: "INVESTMENT" });
        const rec: Prisma.PropertyCreateManyInput = {
          id,
          householdId,
          name: name ?? "",
          address: r.str("address"),
          propertyType: propertyType ?? "INVESTMENT",
          purchaseDate: r.date("purchase_date"),
          purchasePrice: r.num("purchase_price", { min: 0 }),
          currentEstimatedValue: r.num("current_estimated_value", { min: 0 }),
          loanBalance: r.num("loan_balance", { min: 0 }),
          loanInterestRate: r.num("loan_interest_rate", { min: 0, max: 100 }),
          rentalAgent: r.str("rental_agent", 200),
          tenantName: r.str("tenant_name", 200),
          rentAmount: r.num("rent_amount", { min: 0 }),
          rentFrequency: r.oneOf("rent_frequency", RENT_FREQUENCIES),
          rentalStartDate: r.date("rental_start_date"),
          availableForRentDate: r.date("available_for_rent_date"),
          scheduleInitialised: r.bool("schedule_initialised", false),
          notes: r.str("notes", 5000),
          managerName: r.str("manager_name", 120),
          managerCompany: r.str("manager_company", 120),
          managerEmail: r.str("manager_email", 200),
          managerPhone: r.str("manager_phone", 40),
          managerAddress: r.str("manager_address", 300),
          managerNotes: r.str("manager_notes", 2000),
        };
        if (r.failed) return null;
        // Business rule: a person can only have one principal place of residence.
        if (propertyType === "PPR" && ctx.portfolioType !== "PERSONAL") {
          warn(r, `a principal place of residence can only be recorded in a Personal Finance portfolio, so “${name}” was imported as an investment property.`);
          propertyType = "INVESTMENT";
          rec.propertyType = "INVESTMENT";
        } else if (propertyType === "PPR") {
          if (pprTaken && !ctx.exists.properties.inHousehold.has(id)) {
            warn(r, `you already have a principal place of residence (“${pprTaken.name}”), so “${name}” was imported as an investment property. You can change it later.`);
            propertyType = "INVESTMENT";
            rec.propertyType = "INVESTMENT";
          } else if (!pprTaken) {
            pprTaken = { name: name ?? "" };
          }
        }
        return rec;
      },
      (rec) => creates.properties.push(rec),
      (finalId) => {
        const nm = r.str("name", 200);
        if (nm) index(names.properties, lower(nm), finalId);
        if (!ctx.exists.properties.inHousehold.has(finalId)) newProperties.push({ raw: r.raw("id").trim(), id: finalId });
      }
    );
  }

  // Ownership: the person importing becomes the owner of every property added by this import.
  {
    const rows = rowsOf("property_owners");
    summary.property_owners.inFile = rows.length;
    const byProperty = new Map<string, Array<{ email: string; pct: number | null }>>();
    for (const row of rows) {
      const r = reader("property_owners", row);
      const pct = r.num("ownership_percentage", { min: 0, max: 100 });
      if (r.failed) {
        summary.property_owners.skipped++;
        continue;
      }
      const rawId = r.raw("property_id").trim();
      const list = byProperty.get(rawId) ?? [];
      list.push({ email: r.raw("owner_email").trim().toLowerCase(), pct });
      byProperty.set(rawId, list);
    }
    let usedRows = 0;
    for (const p of newProperties) {
      const list = byProperty.get(p.raw) ?? [];
      const mine = list.find((o) => o.email === ctx.userEmail.toLowerCase()) ?? list[0];
      creates.propertyOwnerships.push({ propertyId: p.id, userId, percentage: mine?.pct ?? 100 });
      if (mine) usedRows++;
    }
    summary.property_owners.toAdd = newProperties.length;
    summary.property_owners.alreadyThere = Math.max(0, rows.length - summary.property_owners.skipped - usedRows);
    const others = [...byProperty.values()].flat().filter((o) => o.email && o.email !== ctx.userEmail.toLowerCase()).length;
    if (others > 0) warnings.push(`Ownership details for other people (${others}) weren't imported — you're recorded as the owner of the properties added.`);
  }

  // ---- rental schedule ---------------------------------------------------------
  for (const row of rowsOf("property_schedule_lines")) {
    const r = reader("property_schedule_lines", row);
    addRow(
      "property_schedule_lines",
      r,
      (id) => {
        const propertyId = requiredRef("properties", r, "property_id", "property", "a property");
        const categoryId = requiredRef("categories", r, "category_id", "category", "a category");
        const rec = {
          id,
          propertyId: propertyId ?? "",
          categoryId: categoryId ?? "",
          label: r.str("label", 100),
          isManual: r.bool("is_manual", false),
          sortOrder: r.int("sort_order", { min: 0, max: 100000 }) ?? 0,
        };
        return r.failed ? null : rec;
      },
      (rec) => creates.scheduleLines.push(rec)
    );
  }
  for (const row of rowsOf("property_year_details")) {
    const r = reader("property_year_details", row);
    addRow(
      "property_year_details",
      r,
      (id) => {
        const propertyId = requiredRef("properties", r, "property_id", "property", "a property");
        const fy = r.requiredStr("financial_year", 7);
        if (fy && !FY_RE.test(fy)) r.fail(`“financial_year” should look like 2026-27, but is “${fy}”.`);
        const rec = { id, propertyId: propertyId ?? "", financialYear: fy ?? "", weeksRented: r.int("weeks_rented", { min: 0, max: 52 }) };
        return r.failed ? null : rec;
      },
      (rec) => creates.yearDetails.push(rec)
    );
  }

  // ---- property pictures (links to image files already in storage) ---------------
  const primarySeen = new Set<string>();
  for (const row of rowsOf("property_photos")) {
    const r = reader("property_photos", row);
    addRow(
      "property_photos",
      r,
      (id) => {
        const propertyId = requiredRef("properties", r, "property_id", "property", "a property");
        const filePath = r.requiredStr("file_path", 2000);
        const thumbPath = r.str("thumb_path", 2000);
        for (const [value, col] of [[filePath, "file_path"], [thumbPath, "thumb_path"]] as const) {
          if (value && !/^https:\/\//i.test(value)) r.fail(`“${col}” must be an https:// link.`);
        }
        const contentType = r.oneOf("content_type", ["IMAGE/JPEG", "IMAGE/PNG", "IMAGE/WEBP"] as const, { required: true });
        const wantsPrimary = r.bool("is_primary", false);
        // Only one main picture per property, and never take the role over on a property that already exists.
        const isPrimary = wantsPrimary && !!propertyId && !primarySeen.has(propertyId) && !ctx.exists.properties.inHousehold.has(propertyId);
        if (isPrimary && propertyId) primarySeen.add(propertyId);
        const rec = {
          id,
          propertyId: propertyId ?? "",
          fileName: r.requiredStr("file_name", 200) ?? "",
          contentType: contentType ? contentType.toLowerCase() : "image/jpeg",
          filePath: filePath ?? "",
          thumbPath,
          isPrimary,
        };
        return r.failed ? null : rec;
      },
      (rec) => creates.photos.push(rec)
    );
  }

  // ---- investments -----------------------------------------------------------
  for (const row of rowsOf("investments")) {
    const r = reader("investments", row);
    addRow(
      "investments",
      r,
      (id) => {
        const rec = {
          id,
          householdId,
          name: r.requiredStr("name", 200) ?? "",
          ticker: r.str("ticker", 30),
          type: r.oneOf("type", INVESTMENT_TYPES, { required: true }) ?? "OTHER",
          notes: r.str("notes", 5000),
          currentValueOverride: r.num("current_value_override", { min: 0 }),
        };
        return r.failed ? null : rec;
      },
      (rec) => creates.investments.push(rec),
      (finalId) => {
        const nm = r.str("name", 200);
        if (nm) index(names.investments, lower(nm), finalId);
      }
    );
  }
  for (const row of rowsOf("investment_transactions")) {
    const r = reader("investment_transactions", row);
    addRow(
      "investment_transactions",
      r,
      (id) => {
        const investmentId = requiredRef("investments", r, "investment_id", "investment", "an investment");
        const rec = {
          id,
          investmentId: investmentId ?? "",
          type: r.oneOf("type", INVESTMENT_TRANSACTION_TYPES, { required: true }) ?? "BUY",
          date: r.date("date", true) ?? new Date(0),
          quantity: r.num("quantity", { required: true, min: 0 }) ?? 0,
          pricePerUnit: r.num("price_per_unit", { required: true, min: 0 }) ?? 0,
          brokerage: r.num("brokerage", { min: 0 }) ?? 0,
          notes: r.str("notes", 5000),
        };
        return r.failed ? null : rec;
      },
      (rec) => creates.investmentTransactions.push(rec)
    );
  }
  for (const row of rowsOf("dividends")) {
    const r = reader("dividends", row);
    addRow(
      "dividends",
      r,
      (id) => {
        const investmentId = requiredRef("investments", r, "investment_id", "investment", "an investment");
        const exDividendDate = r.date("ex_dividend_date");
        const paymentDate = r.date("payment_date");
        const rec = {
          id,
          investmentId: investmentId ?? "",
          exDividendDate,
          paymentDate,
          grossAmount: r.num("gross_amount", { required: true, min: 0 }) ?? 0,
          frankingCredit: r.num("franking_credit", { min: 0 }) ?? 0,
          frankedAmount: r.num("franked_amount", { min: 0 }) ?? 0,
          unfrankedAmount: r.num("unfranked_amount", { min: 0 }) ?? 0,
          taxWithheld: r.num("tax_withheld", { min: 0 }) ?? 0,
          netAmount: r.num("net_amount", { required: true, min: 0 }) ?? 0,
          status: r.oneOf("status", DIVIDEND_STATUSES, { fallback: "EXPECTED" }) ?? "EXPECTED",
          notes: r.str("notes", 5000),
          financialYear: getFinancialYearId(paymentDate ?? exDividendDate ?? new Date()),
        };
        return r.failed ? null : rec;
      },
      (rec) => creates.dividends.push(rec)
    );
  }
  for (const row of rowsOf("capital_gain_disposals")) {
    const r = reader("capital_gain_disposals", row);
    addRow(
      "capital_gain_disposals",
      r,
      (id) => {
        const investmentId = requiredRef("investments", r, "investment_id", "investment", "an investment");
        const purchaseDate = r.date("purchase_date", true);
        const saleDate = r.date("sale_date", true);
        const rec = {
          id,
          householdId,
          investmentId: investmentId ?? "",
          purchaseDate: purchaseDate ?? new Date(0),
          purchasePrice: r.num("purchase_price", { required: true, min: 0 }) ?? 0,
          purchaseCosts: r.num("purchase_costs", { min: 0 }) ?? 0,
          saleDate: saleDate ?? new Date(0),
          salePrice: r.num("sale_price", { required: true, min: 0 }) ?? 0,
          saleCosts: r.num("sale_costs", { min: 0 }) ?? 0,
          quantity: r.num("quantity", { required: true, min: 0 }) ?? 0,
          ownershipPercentage: r.num("ownership_percentage", { min: 0, max: 100 }) ?? 100,
          costBase: r.num("cost_base", { required: true }) ?? 0,
          proceeds: r.num("proceeds", { required: true }) ?? 0,
          grossGainLoss: r.num("gross_gain_loss", { required: true }) ?? 0,
          holdingPeriodDays: r.int("holding_period_days", { min: 0 }) ?? (purchaseDate && saleDate ? Math.max(0, Math.floor((saleDate.getTime() - purchaseDate.getTime()) / DAY_MS)) : 0),
          financialYear: getFinancialYearId(saleDate ?? new Date()),
          notes: r.str("notes", 5000),
        };
        return r.failed ? null : rec;
      },
      (rec) => creates.disposals.push(rec)
    );
  }

  // ---- transactions ------------------------------------------------------------
  for (const row of rowsOf("transactions")) {
    const r = reader("transactions", row);
    addRow(
      "transactions",
      r,
      (id) => {
        const date = r.date("date", true);
        const direction = r.oneOf("direction", TRANSACTION_DIRECTIONS, { required: true });
        const rec = {
          id,
          householdId,
          userId,
          date: date ?? new Date(0),
          description: r.requiredStr("description", 500) ?? "",
          amount: r.num("amount", { required: true, min: 0.000001 }) ?? 0,
          direction: direction ?? "EXPENSE",
          categoryId: optionalRef("categories", r, "category_id", "category", "the category", direction ?? undefined),
          accountId: optionalRef("accounts", r, "account_id", "account", "the account"),
          propertyId: optionalRef("properties", r, "property_id", "property", "the property"),
          investmentId: optionalRef("investments", r, "investment_id", "investment", "the investment"),
          notes: r.str("notes", 5000),
          isRecurring: r.bool("is_recurring", false),
          recurrenceFrequency: r.oneOf("recurrence_frequency", BILL_FREQUENCIES),
          potentialTaxCategory: r.str("potential_tax_category", 200),
          financialYear: getFinancialYearId(date ?? new Date()),
        };
        return r.failed ? null : rec;
      },
      (rec) => creates.transactions.push(rec)
    );
  }

  // ---- bills & reminders ---------------------------------------------------------
  const newBills: Array<{ id: string; name: string; nextDueDate: Date; reminderDaysBefore: number; status: string }> = [];
  for (const row of rowsOf("bills")) {
    const r = reader("bills", row);
    addRow(
      "bills",
      r,
      (id) => {
        const rec = {
          id,
          householdId,
          name: r.requiredStr("name", 200) ?? "",
          provider: r.str("provider", 200),
          amount: r.num("amount", { required: true, min: 0 }) ?? 0,
          frequency: r.oneOf("frequency", BILL_FREQUENCIES, { required: true }) ?? "MONTHLY",
          nextDueDate: r.date("next_due_date", true) ?? new Date(0),
          accountId: optionalRef("accounts", r, "account_id", "account", "the account"),
          categoryId: optionalRef("categories", r, "category_id", "category", "the category"),
          propertyId: optionalRef("properties", r, "property_id", "property", "the property"),
          autoRenew: r.bool("auto_renew", false),
          reminderDaysBefore: r.int("reminder_days_before", { min: 0, max: 365 }) ?? 7,
          status: r.oneOf("status", BILL_STATUSES, { fallback: "UPCOMING" }) ?? "UPCOMING",
          notes: r.str("notes", 5000),
        };
        return r.failed ? null : rec;
      },
      (rec) => {
        creates.bills.push(rec);
        newBills.push({ id: rec.id ?? "", name: rec.name, nextDueDate: rec.nextDueDate as Date, reminderDaysBefore: rec.reminderDaysBefore ?? 7, status: rec.status ?? "UPCOMING" });
      }
    );
  }
  const billsWithReminder = new Set<string>();
  for (const row of rowsOf("reminders")) {
    const r = reader("reminders", row);
    addRow(
      "reminders",
      r,
      (id) => {
        const bill = ref("bills", r, "bill_id", null);
        const tx = ref("transactions", r, "transaction_id", null);
        const div = ref("dividends", r, "dividend_id", null);
        for (const [res, what] of [[bill, "a bill"], [tx, "a transaction"], [div, "a dividend"]] as const) {
          if (res.given && !res.id) r.fail(`it belongs to ${what} (“${res.label}”) that isn't in the file.`);
        }
        const rec = {
          id,
          householdId,
          billId: bill.id,
          transactionId: tx.id,
          dividendId: div.id,
          title: r.requiredStr("title", 300) ?? "",
          dueDate: r.date("due_date", true) ?? new Date(0),
          daysBefore: r.int("days_before", { min: 0, max: 365 }) ?? 7,
          status: r.oneOf("status", REMINDER_STATUSES, { fallback: "PENDING" }) ?? "PENDING",
          notes: r.str("notes", 5000),
        };
        if (!r.failed && rec.billId) billsWithReminder.add(rec.billId);
        return r.failed ? null : rec;
      },
      (rec) => creates.reminders.push(rec)
    );
  }
  // Bills typed in by hand won't have a reminder yet — give upcoming ones the usual one.
  for (const bill of newBills) {
    if (bill.status !== "UPCOMING" || billsWithReminder.has(bill.id)) continue;
    const when = new Date(bill.nextDueDate);
    when.setDate(when.getDate() - bill.reminderDaysBefore);
    creates.reminders.push({
      id: deriveId(householdId, "reminders", `bill:${bill.id}`),
      householdId,
      billId: bill.id,
      title: `${bill.name} due`,
      dueDate: when,
      daysBefore: bill.reminderDaysBefore,
      status: "PENDING",
    });
  }

  // ---- documents (links to files already in storage) ----------------------------
  for (const row of rowsOf("documents")) {
    const r = reader("documents", row);
    addRow(
      "documents",
      r,
      (id) => {
        const filePath = r.requiredStr("file_path", 2000);
        if (filePath && !/^https:\/\//i.test(filePath)) r.fail("“file_path” must be an https:// link.");
        const rec = {
          id,
          householdId,
          fileName: r.requiredStr("file_name", 300) ?? "",
          fileType: r.requiredStr("file_type", 100) ?? "",
          filePath: filePath ?? "",
          transactionId: optionalRef("transactions", r, "transaction_id", null, "the transaction"),
          propertyId: optionalRef("properties", r, "property_id", null, "the property"),
          investmentId: optionalRef("investments", r, "investment_id", null, "the investment"),
          dividendId: optionalRef("dividends", r, "dividend_id", null, "the dividend"),
          capitalGainDisposalId: optionalRef("capital_gain_disposals", r, "capital_gain_disposal_id", null, "the disposal"),
        };
        return r.failed ? null : rec;
      },
      (rec) => creates.documents.push(rec)
    );
  }

  for (const name of parsed.unknownSections) warnings.push(`The section [${name}] isn't recognised and was ignored.`);
  return { summary, warnings, errors, profile, creates };
}
