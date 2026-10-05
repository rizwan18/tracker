import { escapeFormula, toCsv } from "../../../lib/csv";
import { dayKey, directionLabel, formatDate, formatMoney, frequencyLabel, looseText, normalise, notFoundMessage, parseDate, parseDirection, parseMoney, parseRepeats, FREQUENCY_LABELS, type Direction } from "./format";
import type { ColumnSpec, PlannedRow, ReadTable, RowMessage } from "./table";

/**
 * Personal Finance income & expenses as a plain table: one row per transaction, readable column names,
 * categories / accounts / properties by name — no IDs. Property and Investment columns appear only when the
 * household has any, so most people see a short, simple sheet.
 */
export const PERSONAL_TITLE = "Income & expenses";

const ALL: ColumnSpec[] = [
  { key: "date", header: "Date", aliases: ["transaction date", "when"], required: true },
  { key: "description", header: "Description", aliases: ["details", "memo", "narration", "payee", "name"], required: true },
  { key: "amount", header: "Amount", aliases: ["value", "total", "amount aud"], required: true },
  { key: "type", header: "Type", aliases: ["direction", "kind", "income or expense"], required: true },
  { key: "category", header: "Category" },
  { key: "account", header: "Account", aliases: ["bank account", "account name"] },
  { key: "property", header: "Property" },
  { key: "investment", header: "Investment" },
  { key: "repeats", header: "Repeats", aliases: ["recurring", "frequency", "recurrence", "repeat"] },
  { key: "notes", header: "Notes", aliases: ["note", "comments", "comment"] },
];

/** Every column the importer understands. */
export const PERSONAL_READ_COLUMNS = ALL;

/** The columns to write: Property / Investment only when they'd be used. */
export function personalWriteColumns(opts: { properties: boolean; investments: boolean }): ColumnSpec[] {
  return ALL.filter((c) => (c.key !== "property" || opts.properties) && (c.key !== "investment" || opts.investments));
}

export const EXAMPLE_NOTE = "Example row - delete before importing";
const isExample = (notes: string) => normalise(notes).startsWith("examplerow");

export interface PersonalContext {
  categories: Array<{ id: string; name: string; direction: string }>;
  accounts: Array<{ id: string; name: string }>;
  properties: Array<{ id: string; name: string }>;
  investments: Array<{ id: string; name: string; ticker: string | null }>;
  /** How many transactions you already have for each date + type + amount + description (see `personalKey`). */
  existing: Map<string, number>;
}

export interface PersonalRecord {
  date: Date;
  description: string;
  amountCents: number;
  direction: Direction;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string | null;
  propertyId: string | null;
  investmentId: string | null;
  notes: string | null;
  isRecurring: boolean;
  recurrenceFrequency: string | null;
}

/** Two transactions are "the same" when date, type, amount and description match (ignoring case and spacing). */
export const personalKey = (date: Date, direction: string, cents: number, description: string): string => `${dayKey(date)}|${direction}|${cents}|${looseText(description)}`;

// ------------------------------------------------------------------ export

export interface PersonalExportData {
  transactions: Array<{
    date: Date; description: string; amount: number; direction: string; categoryId: string | null; accountId: string | null;
    propertyId: string | null; investmentId: string | null; notes: string | null; isRecurring: boolean; recurrenceFrequency: string | null;
  }>;
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  properties: Array<{ id: string; name: string }>;
  investments: Array<{ id: string; name: string }>;
}

const text = (v: string | null | undefined) => (v ? escapeFormula(v) : "");

export function renderPersonalCsv(data: PersonalExportData): string {
  const cat = new Map(data.categories.map((c) => [c.id, c.name]));
  const acc = new Map(data.accounts.map((a) => [a.id, a.name]));
  const prop = new Map(data.properties.map((p) => [p.id, p.name]));
  const inv = new Map(data.investments.map((i) => [i.id, i.name]));
  const hasProperty = data.transactions.some((t) => t.propertyId) || data.properties.length > 0;
  const hasInvestment = data.transactions.some((t) => t.investmentId) || data.investments.length > 0;
  const cols = personalWriteColumns({ properties: hasProperty, investments: hasInvestment });

  const value: Record<string, (t: PersonalExportData["transactions"][number]) => string> = {
    date: (t) => formatDate(t.date),
    description: (t) => text(t.description),
    amount: (t) => formatMoney(Math.round(t.amount * 100)),
    type: (t) => directionLabel(t.direction),
    category: (t) => text(t.categoryId ? cat.get(t.categoryId) : ""),
    account: (t) => text(t.accountId ? acc.get(t.accountId) : ""),
    property: (t) => text(t.propertyId ? prop.get(t.propertyId) : ""),
    investment: (t) => text(t.investmentId ? inv.get(t.investmentId) : ""),
    repeats: (t) => (t.isRecurring ? frequencyLabel(t.recurrenceFrequency) || "Custom" : ""),
    notes: (t) => text(t.notes),
  };
  return toCsv([cols.map((c) => c.header), ...data.transactions.map((t) => cols.map((c) => value[c.key]!(t)))]);
}

/** A blank sheet with the right headings and two example rows built from the household's own categories and accounts. */
export function renderPersonalTemplate(ctx: Pick<PersonalContext, "categories" | "accounts" | "properties" | "investments">, today: Date): string {
  const cols = personalWriteColumns({ properties: ctx.properties.length > 0, investments: ctx.investments.length > 0 });
  const pick = (direction: string, prefer: string) => {
    const of = ctx.categories.filter((c) => c.direction === direction);
    return (of.find((c) => normalise(c.name) === normalise(prefer)) ?? of[0])?.name ?? "";
  };
  const account = ctx.accounts[0]?.name ?? "";
  const example = (values: Record<string, string>) => cols.map((c) => values[c.key] ?? "");
  return toCsv([
    cols.map((c) => c.header),
    example({ date: formatDate(today), description: "Weekly groceries", amount: "85.40", type: "Expense", category: pick("EXPENSE", "Groceries"), account, notes: EXAMPLE_NOTE }),
    example({ date: formatDate(today), description: "Salary", amount: "4500.00", type: "Income", category: pick("INCOME", "Salary"), account, notes: EXAMPLE_NOTE }),
  ]);
}

// ------------------------------------------------------------------ import

const MAX_DESCRIPTION = 500;
const MAX_NOTES = 2000;

export function planPersonal(table: ReadTable, ctx: PersonalContext): { rows: PlannedRow<PersonalRecord>[]; previewColumns: string[] } {
  const has = (k: string) => table.present.has(k);
  const previewColumns = ["Date", "Description", "Amount", "Type", "Category", "Account", ...(has("property") ? ["Property"] : []), ...(has("investment") ? ["Investment"] : []), ...(has("repeats") ? ["Repeats"] : [])];
  const categoryNames = ctx.categories.map((c) => c.name);
  const remaining = new Map(ctx.existing);
  const seenInFile = new Map<string, number>();

  const rows = table.rows.map((row): PlannedRow<PersonalRecord> => {
    const c = row.cells;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Date
    let date: Date | null = null;
    if (!c.date) errors.push("Please enter a Date.");
    else if (!(date = parseDate(c.date))) errors.push(`Date “${c.date}” is not valid. Please use day/month/year, like 25/10/2026.`);

    // Description
    if (!c.description) errors.push("Please enter a Description.");
    else if (c.description.length > MAX_DESCRIPTION) errors.push(`The Description is too long (over ${MAX_DESCRIPTION} characters).`);

    // Type
    let direction: Direction | null = null;
    if (!c.type) errors.push("Please enter the Type (Income or Expense).");
    else if (!(direction = parseDirection(c.type))) errors.push(`Type “${c.type}” isn't recognised. Please use Income or Expense.`);

    // Amount
    let cents: number | null = null;
    if (!c.amount) errors.push("Please enter an Amount.");
    else {
      cents = parseMoney(c.amount);
      if (cents === null) errors.push(`Amount “${c.amount}” is not a valid number. Use a plain number like 85.40.`);
      else if (cents < 0) errors.push("The Amount should be a positive number — use the Type column to say whether it is Income or Expense.");
      else if (cents === 0) errors.push("The Amount must be more than zero.");
      else if (cents > 99_999_999_999) errors.push("That Amount is too large.");
    }

    // Category
    let categoryId: string | null = null;
    let categoryName: string | null = null;
    if (c.category) {
      const same = ctx.categories.filter((x) => normalise(x.name) === normalise(c.category!));
      const fit = direction ? same.find((x) => x.direction === direction) : same[0];
      if (fit) {
        categoryId = fit.id;
        categoryName = fit.name;
      } else if (same.length > 0 && direction) {
        errors.push(`Category “${c.category}” is ${same[0]!.direction === "INCOME" ? "an income" : "an expense"} category, so it can't be used for ${direction === "INCOME" ? "an Income" : "an Expense"} row. Please choose another category or change the Type.`);
      } else if (same.length === 0) {
        errors.push(notFoundMessage("Category", c.category, direction ? ctx.categories.filter((x) => x.direction === direction).map((x) => x.name) : categoryNames));
      }
    }

    // Account / Property / Investment
    const lookup = <T extends { id: string; name: string }>(column: string, typed: string | undefined, list: T[], extra?: (x: T) => string | null): string | null => {
      if (!typed) return null;
      const hit = list.find((x) => normalise(x.name) === normalise(typed) || (extra && extra(x) !== null && normalise(extra(x)!) === normalise(typed)));
      if (hit) return hit.id;
      errors.push(notFoundMessage(column, typed, list.map((x) => x.name)));
      return null;
    };
    const accountId = lookup("Account", c.account, ctx.accounts);
    const propertyId = lookup("Property", c.property, ctx.properties);
    const investmentId = lookup("Investment", c.investment, ctx.investments, (i) => i.ticker);

    // Repeats
    let isRecurring = false;
    let recurrenceFrequency: string | null = null;
    if (c.repeats) {
      const r = parseRepeats(c.repeats);
      if (r === "unknown") errors.push(`Repeats “${c.repeats}” isn't recognised. Please use ${FREQUENCY_LABELS.join(", ")} — or leave it blank if it doesn't repeat.`);
      else if (r.repeats) {
        isRecurring = true;
        recurrenceFrequency = r.frequency;
      }
    }

    // Notes
    if (c.notes && c.notes.length > MAX_NOTES) errors.push(`The Notes are too long (over ${MAX_NOTES} characters).`);
    if (c.notes && isExample(c.notes)) errors.push("This is an example row from the template. Delete it, or replace it with a real transaction.");

    const display = [
      date ? formatDate(date) : c.date ?? "",
      c.description ?? "",
      cents !== null ? (cents < 0 ? c.amount! : (cents / 100).toFixed(2)) : c.amount ?? "",
      direction ? directionLabel(direction) : c.type ?? "",
      categoryName ?? c.category ?? "",
      c.account ?? "",
      ...(has("property") ? [c.property ?? ""] : []),
      ...(has("investment") ? [c.investment ?? ""] : []),
      ...(has("repeats") ? [recurrenceFrequency ? frequencyLabel(recurrenceFrequency) : ""] : []),
    ];
    const messages: RowMessage[] = [...errors.map((text) => ({ level: "error" as const, text })), ...warnings.map((text) => ({ level: "warning" as const, text }))];

    if (errors.length > 0 || !date || !direction || cents === null) return { rowNumber: row.rowNumber, status: "error", cells: display, messages, record: null };

    const record: PersonalRecord = {
      date, description: c.description!, amountCents: cents, direction, categoryId, categoryName, accountId, propertyId, investmentId,
      notes: c.notes || null, isRecurring, recurrenceFrequency,
    };

    const key = personalKey(date, direction, cents, c.description!);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      messages.push({ level: "info", text: "You already have this transaction (same date, description, amount and type)." });
      return { rowNumber: row.rowNumber, status: "duplicate", cells: display, messages, record };
    }
    const earlier = seenInFile.get(key);
    if (earlier !== undefined) messages.push({ level: "warning", text: `This looks identical to row ${earlier}. It will still be imported — delete the row if it's a repeat.` });
    else seenInFile.set(key, row.rowNumber);
    return { rowNumber: row.rowNumber, status: "ready", cells: display, messages, record };
  });
  return { rows, previewColumns };
}
