import { escapeFormula, toCsv } from "../../../lib/csv";
import { businessEntrySchema } from "../../../lib/validation";
import { entryData } from "../../business/entryData";
import { dayKey, directionLabel, formatDate, formatMoney, looseText, normalise, notFoundMessage, parseDate, parseDirection, parseMoney, type Direction } from "./format";
import type { ColumnSpec, PlannedRow, ReadTable, RowMessage } from "./table";

/**
 * Business Finance sales & expenses as a plain table. GST is two easy columns: the Amount including GST, and the
 * GST Amount that is part of it (0.00 = no GST). Each row becomes exactly the record the "add a sale/expense"
 * form would make, so BAS, the reports and the ledger work out the same way.
 */
export const BUSINESS_TITLE = "Sales & expenses";

export const BUSINESS_COLUMNS: ColumnSpec[] = [
  { key: "date", header: "Date", aliases: ["invoice date", "transaction date"], required: true },
  { key: "type", header: "Type", aliases: ["kind", "direction", "income or expense"], required: true },
  { key: "description", header: "Description", aliases: ["details", "memo"], required: true },
  { key: "contact", header: "Customer / Supplier", aliases: ["customer", "supplier", "contact", "customer supplier", "vendor", "client"] },
  { key: "reference", header: "Invoice Number", aliases: ["invoice", "invoice no", "invoice number", "bill number", "bill no", "invoice bill number", "reference", "ref"] },
  { key: "category", header: "Category", aliases: ["account", "ledger account", "income expense account"], required: true },
  { key: "amount", header: "Amount (incl. GST)", aliases: ["amount", "total", "total amount", "amount incl gst", "amount including gst", "gross"], required: true },
  { key: "gst", header: "GST Amount", aliases: ["gst", "gst included", "gst component", "tax"] },
  { key: "status", header: "Status", aliases: ["paid", "payment status"], required: true },
  { key: "paidDate", header: "Date Paid", aliases: ["paid date", "payment date", "date received", "received date"] },
  { key: "bank", header: "Paid From", aliases: ["paid to", "bank account", "bank", "paid from account", "received into", "paid into"] },
  { key: "dueDate", header: "Due Date", aliases: ["due"] },
  { key: "notes", header: "Notes", aliases: ["note", "comments", "comment"] },
];

export const BUSINESS_EXAMPLE_NOTE = "Example row - delete before importing";
const isExample = (notes: string) => normalise(notes).startsWith("examplerow");

export interface LedgerAccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  systemKey: string | null;
  isBank: boolean;
  isActive: boolean;
}

export interface BusinessContext {
  gstRegistered: boolean;
  accounts: LedgerAccountRow[];
  /** How many entries you already have for each date + type + total + description + invoice number. */
  existing: Map<string, number>;
}

/** Same rule as the entry form: a sale needs an income category; an expense an expense category (or an asset you're buying to keep). */
export const usableCategory = (a: LedgerAccountRow, kind: Direction): boolean =>
  a.isActive && (kind === "INCOME" ? a.type === "INCOME" : a.type === "EXPENSE" || (a.type === "ASSET" && !a.systemKey && !a.isBank));
const isBankAccount = (a: LedgerAccountRow) => a.isActive && a.isBank;
const matchesName = (a: LedgerAccountRow, typed: string) => normalise(a.name) === normalise(typed) || normalise(a.code) === normalise(typed) || normalise(`${a.code} ${a.name}`) === normalise(typed);

export const businessKey = (date: Date, kind: string, totalCents: number, description: string, reference: string | null): string =>
  `${dayKey(date)}|${kind}|${totalCents}|${looseText(description)}|${looseText(reference ?? "")}`;

export interface BusinessRecord {
  /** Exactly what is stored (before householdId / createdById / id are added) — built by the same code as the entry form. */
  data: ReturnType<typeof entryData>;
}

// ------------------------------------------------------------------ export

export interface BusinessExportData {
  entries: Array<{
    kind: string; date: Date; dueDate: Date | null; description: string; contactName: string | null; reference: string | null; accountId: string;
    totalCents: number; gstCents: number; status: string; paidDate: Date | null; bankAccountId: string | null; notes: string | null;
  }>;
  accounts: Array<{ id: string; name: string }>;
}

const text = (v: string | null | undefined) => (v ? escapeFormula(v) : "");

export function renderBusinessCsv(data: BusinessExportData): string {
  const name = new Map(data.accounts.map((a) => [a.id, a.name]));
  const row = (e: BusinessExportData["entries"][number]) => [
    formatDate(e.date), directionLabel(e.kind), text(e.description), text(e.contactName), text(e.reference), text(name.get(e.accountId)),
    formatMoney(e.totalCents), formatMoney(e.gstCents), e.status === "PAID" ? "Paid" : "Unpaid", e.paidDate ? formatDate(e.paidDate) : "",
    text(e.bankAccountId ? name.get(e.bankAccountId) : ""), e.dueDate ? formatDate(e.dueDate) : "", text(e.notes),
  ];
  return toCsv([BUSINESS_COLUMNS.map((c) => c.header), ...data.entries.map(row)]);
}

export function renderBusinessTemplate(ctx: Pick<BusinessContext, "accounts" | "gstRegistered">, today: Date): string {
  const first = (kind: Direction, prefer: string) => {
    const of = ctx.accounts.filter((a) => usableCategory(a, kind));
    return (of.find((a) => normalise(a.name) === normalise(prefer)) ?? of[0])?.name ?? "";
  };
  const bank = ctx.accounts.find(isBankAccount)?.name ?? "";
  const due = new Date(today.getTime() + 14 * 86_400_000);
  const expGst = ctx.gstRegistered ? "10.00" : "0.00";
  const incGst = ctx.gstRegistered ? "100.00" : "0.00";
  return toCsv([
    BUSINESS_COLUMNS.map((c) => c.header),
    [formatDate(today), "Expense", "Office supplies", "Officeworks", "INV-4471", first("EXPENSE", "Office Expenses"), "110.00", expGst, "Paid", formatDate(today), bank, "", BUSINESS_EXAMPLE_NOTE],
    [formatDate(today), "Income", "Website design", "Acme Pty Ltd", "1001", first("INCOME", "Sales"), "1100.00", incGst, "Unpaid", "", "", formatDate(due), BUSINESS_EXAMPLE_NOTE],
  ]);
}

// ------------------------------------------------------------------ import

const STATUS_PAID = new Set(["paid", "yes", "received", "settled", "complete", "completed"]);
const STATUS_UNPAID = new Set(["unpaid", "no", "owing", "outstanding", "due", "open", "pending", "unreceived"]);
const previewColumns = ["Date", "Type", "Description", "Category", "Amount (incl. GST)", "GST Amount", "Status"];

export function planBusiness(table: ReadTable, ctx: BusinessContext): { rows: PlannedRow<BusinessRecord>[]; previewColumns: string[] } {
  const remaining = new Map(ctx.existing);
  const seenInFile = new Map<string, number>();
  const banks = ctx.accounts.filter(isBankAccount);

  const rows = table.rows.map((row): PlannedRow<BusinessRecord> => {
    const c = row.cells;
    const errors: string[] = [];
    const warnings: string[] = [];

    let date: Date | null = null;
    if (!c.date) errors.push("Please enter a Date.");
    else if (!(date = parseDate(c.date))) errors.push(`Date “${c.date}” is not valid. Please use day/month/year, like 25/10/2026.`);

    let kind: Direction | null = null;
    if (!c.type) errors.push("Please enter the Type (Income or Expense).");
    else if (!(kind = parseDirection(c.type))) errors.push(`Type “${c.type}” isn't recognised. Please use Income or Expense.`);

    if (!c.description) errors.push("Please enter a Description.");
    else if (c.description.length > 300) errors.push("The Description is too long (over 300 characters).");
    if (c.contact && c.contact.length > 150) errors.push("The Customer / Supplier name is too long (over 150 characters).");
    if (c.reference && c.reference.length > 60) errors.push("The Invoice Number is too long (over 60 characters).");

    // Category (the chart-of-accounts name or code)
    let accountId: string | null = null;
    let categoryName: string | null = null;
    if (!c.category) errors.push("Please enter a Category.");
    else {
      const named = ctx.accounts.filter((a) => a.isActive && matchesName(a, c.category!));
      const fit = kind ? named.find((a) => usableCategory(a, kind!)) : named[0];
      if (fit) {
        accountId = fit.id;
        categoryName = fit.name;
      } else if (named.length > 0 && kind) {
        errors.push(`Category “${c.category}” can't be used for ${kind === "INCOME" ? "an Income" : "an Expense"} row — ${kind === "INCOME" ? "a sale needs an income category" : "an expense needs an expense category (or an asset account such as equipment)"}. Please choose another category or change the Type.`);
      } else {
        const options = (kind ? ctx.accounts.filter((a) => usableCategory(a, kind!)) : ctx.accounts.filter((a) => usableCategory(a, "INCOME") || usableCategory(a, "EXPENSE"))).map((a) => a.name);
        errors.push(notFoundMessage("Category", c.category, options));
      }
    }

    // Amount & GST
    let amountCents: number | null = null;
    if (!c.amount) errors.push("Please enter the Amount (including GST).");
    else {
      amountCents = parseMoney(c.amount);
      if (amountCents === null) errors.push(`Amount “${c.amount}” is not a valid number. Use a plain number like 110.00.`);
      else if (amountCents < 0) errors.push("The Amount should be a positive number — use the Type column to say whether it is Income or Expense.");
      else if (amountCents === 0) errors.push("The Amount must be more than zero.");
    }
    let gstCents = 0;
    if (c.gst) {
      const g = parseMoney(c.gst);
      if (g === null) errors.push(`GST Amount “${c.gst}” is not a valid number. Use a plain number like 10.00, or 0 for no GST.`);
      else if (g < 0) errors.push("The GST Amount can't be negative.");
      else if (amountCents !== null && amountCents > 0 && g > amountCents) errors.push("The GST Amount can't be more than the Amount.");
      else gstCents = g;
    } else if (ctx.gstRegistered) {
      warnings.push("The GST Amount is blank, so it was treated as no GST. Enter the GST from the tax invoice if there is any.");
    }
    if (!ctx.gstRegistered && gstCents > 0) {
      warnings.push("The GST Amount was ignored because your business isn't registered for GST.");
      gstCents = 0;
    }

    // Status, payment date, bank account
    let status: "PAID" | "UNPAID" | null = null;
    const statusWord = normalise(c.status ?? "");
    if (statusWord === "") {
      if (c.bank) status = "PAID";
      else errors.push("Please enter the Status (Paid or Unpaid).");
    } else if (STATUS_PAID.has(statusWord)) status = "PAID";
    else if (STATUS_UNPAID.has(statusWord)) status = "UNPAID";
    else errors.push(`Status “${c.status}” isn't recognised. Please use Paid or Unpaid.`);

    let paidDate: Date | null = null;
    let bankAccountId: string | null = null;
    if (status === "PAID") {
      if (c.paidDate) {
        paidDate = parseDate(c.paidDate);
        if (!paidDate) errors.push(`Date Paid “${c.paidDate}” is not valid. Please use day/month/year, like 25/10/2026.`);
      } else if (date) {
        paidDate = date;
        warnings.push("Date Paid is blank, so the Date was used.");
      }
      if (!c.bank) errors.push(`Please enter Paid From — the bank account ${kind === "INCOME" ? "the money went into" : "it was paid from"}.${banks.length > 0 && banks.length <= 8 ? ` Your bank accounts are: ${banks.map((b) => b.name).join(", ")}.` : ""}`);
      else {
        const bank = banks.find((a) => matchesName(a, c.bank!));
        if (bank) bankAccountId = bank.id;
        else errors.push(notFoundMessage("Paid From", c.bank, banks.map((b) => b.name)));
      }
    } else if (status === "UNPAID" && (c.paidDate || c.bank)) {
      warnings.push("Date Paid and Paid From were ignored because the Status is Unpaid.");
    }
    let dueDate: Date | null = null;
    if (c.dueDate) {
      dueDate = parseDate(c.dueDate);
      if (!dueDate) errors.push(`Due Date “${c.dueDate}” is not valid. Please use day/month/year, like 25/10/2026.`);
    }
    if (c.notes && c.notes.length > 2000) errors.push("The Notes are too long (over 2000 characters).");
    if (c.notes && isExample(c.notes)) errors.push("This is an example row from the template. Delete it, or replace it with a real sale or expense.");

    // The same validation the entry form applies — a safety net, so an import can never store something the form would refuse.
    let record: BusinessRecord | null = null;
    if (errors.length === 0 && date && kind && accountId && amountCents !== null && status) {
      const parsed = businessEntrySchema.safeParse({
        kind, date, dueDate, description: c.description, contactName: c.contact || null, reference: c.reference || null, accountId, amountCents,
        gstMode: "MANUAL", gstCents, status, paidDate, bankAccountId, notes: c.notes || null,
      });
      if (!parsed.success) for (const issue of parsed.error.issues) errors.push(issue.message);
      else record = { data: entryData(parsed.data, ctx.gstRegistered) };
    }

    const display = [
      date ? formatDate(date) : c.date ?? "",
      kind ? directionLabel(kind) : c.type ?? "",
      c.description ?? "",
      categoryName ?? c.category ?? "",
      amountCents !== null && amountCents >= 0 ? formatMoney(amountCents) : c.amount ?? "",
      c.gst || ctx.gstRegistered ? formatMoney(gstCents) : "",
      status === "PAID" ? "Paid" : status === "UNPAID" ? "Unpaid" : c.status ?? "",
    ];
    const messages: RowMessage[] = [...errors.map((t) => ({ level: "error" as const, text: t })), ...warnings.map((t) => ({ level: "warning" as const, text: t }))];
    if (errors.length > 0 || !record) return { rowNumber: row.rowNumber, status: "error", cells: display, messages, record: null };

    const key = businessKey(record.data.date, record.data.kind, record.data.totalCents, record.data.description, record.data.reference);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      messages.push({ level: "info", text: "You already have this entry (same date, type, amount, description and invoice number)." });
      return { rowNumber: row.rowNumber, status: "duplicate", cells: display, messages, record };
    }
    const earlier = seenInFile.get(key);
    if (earlier !== undefined) messages.push({ level: "warning", text: `This looks identical to row ${earlier}. It will still be imported — delete the row if it's a repeat.` });
    else seenInFile.set(key, row.rowNumber);
    return { rowNumber: row.rowNumber, status: "ready", cells: display, messages, record };
  });
  return { rows, previewColumns };
}
