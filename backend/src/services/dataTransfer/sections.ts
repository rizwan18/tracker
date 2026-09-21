/**
 * The layout of the "export all my data" CSV.
 *
 * One file, several sections. Each section starts with a row holding just its
 * name in square brackets (e.g. `[transactions]`), followed by a header row and
 * the data rows; a blank row separates sections. Columns ending in `_id` link
 * records together; the human-readable name columns beside them (property,
 * category, …) let the file be edited by hand in a spreadsheet.
 */
export const EXPORT_FORMAT_TITLE = "Revenue Expense Tracker export";
export const EXPORT_FORMAT_VERSION = 1;

export const SECTION_ORDER = [
  "profile",
  "accounts",
  "categories",
  "properties",
  "property_owners",
  "property_schedule_lines",
  "property_year_details",
  "property_photos",
  "investments",
  "investment_valuations",
  "investment_transactions",
  "dividends",
  "capital_gain_disposals",
  "transactions",
  "bills",
  "reminders",
  "documents",
] as const;
export type SectionName = (typeof SECTION_ORDER)[number];

export const SECTION_COLUMNS: Record<SectionName, readonly string[]> = {
  profile: ["full_name", "email", "timezone", "easy_view_enabled", "household_name"],
  accounts: ["id", "name", "type"],
  categories: ["id", "name", "direction", "is_custom"],
  properties: [
    "id", "name", "address", "property_type", "purchase_date", "purchase_price", "current_estimated_value", "loan_balance",
    "loan_interest_rate", "rental_agent", "tenant_name", "rent_amount", "rent_frequency", "rental_start_date",
    "available_for_rent_date", "schedule_initialised", "notes", "manager_name", "manager_company", "manager_email", "manager_phone",
    "manager_mobile", "manager_website", "manager_abn", "manager_address", "manager_notes",
  ],
  property_owners: ["property_id", "property", "owner_email", "ownership_percentage"],
  property_schedule_lines: ["id", "property_id", "property", "category_id", "category", "label", "is_manual", "sort_order"],
  property_year_details: ["id", "property_id", "property", "financial_year", "weeks_rented"],
  property_photos: ["id", "property_id", "property", "file_name", "content_type", "file_path", "thumb_path", "is_primary"],
  investments: ["id", "name", "ticker", "type", "notes", "current_value_override", "market", "currency"],
  investment_valuations: ["id", "investment_id", "investment", "as_at", "units", "market_price", "market_value", "market_value_aud", "currency", "source"],
  investment_transactions: ["id", "investment_id", "investment", "type", "date", "quantity", "price_per_unit", "brokerage", "notes"],
  dividends: [
    "id", "investment_id", "investment", "ex_dividend_date", "payment_date", "gross_amount", "franking_credit", "franked_amount",
    "unfranked_amount", "tax_withheld", "net_amount", "status", "notes", "financial_year",
  ],
  capital_gain_disposals: [
    "id", "investment_id", "investment", "purchase_date", "purchase_price", "purchase_costs", "sale_date", "sale_price", "sale_costs",
    "quantity", "ownership_percentage", "cost_base", "proceeds", "gross_gain_loss", "holding_period_days", "financial_year", "notes",
  ],
  transactions: [
    "id", "date", "description", "amount", "direction", "category_id", "category", "account_id", "account", "property_id", "property",
    "investment_id", "investment", "notes", "is_recurring", "recurrence_frequency", "potential_tax_category", "financial_year",
  ],
  bills: [
    "id", "name", "provider", "amount", "frequency", "next_due_date", "account_id", "account", "category_id", "category",
    "property_id", "property", "auto_renew", "reminder_days_before", "status", "notes",
  ],
  reminders: ["id", "bill_id", "transaction_id", "dividend_id", "title", "due_date", "days_before", "status", "notes"],
  documents: ["id", "file_name", "file_type", "file_path", "transaction_id", "property_id", "investment_id", "dividend_id", "capital_gain_disposal_id"],
};

/** Sections whose rows carry an `id` column (everything except profile and property_owners). */
export const ID_TABLES = [
  "accounts",
  "categories",
  "properties",
  "property_schedule_lines",
  "property_year_details",
  "property_photos",
  "investments",
  "investment_valuations",
  "investment_transactions",
  "dividends",
  "capital_gain_disposals",
  "transactions",
  "bills",
  "reminders",
  "documents",
] as const;
export type IdTable = (typeof ID_TABLES)[number];

export const SECTION_LABELS: Record<SectionName, string> = {
  profile: "Profile & preferences",
  accounts: "Accounts",
  categories: "Categories",
  properties: "Properties",
  property_owners: "Property ownership",
  property_schedule_lines: "Rental schedule lines",
  property_year_details: "Rental details by year",
  property_photos: "Property pictures (links)",
  investments: "Investments",
  investment_valuations: "Share & ETF holdings (units and prices)",
  investment_transactions: "Investment buys & sells",
  dividends: "Dividends",
  capital_gain_disposals: "Capital gains disposals",
  transactions: "Income & expenses",
  bills: "Bills",
  reminders: "Reminders",
  documents: "Document links",
};

/**
 * What an export/import can be limited to. "all" is the "Your data" backup (every section).
 * The two portfolio scopes use exactly the same sectioned format and the same columns —
 * they simply carry the sections that belong to that portfolio, so a portfolio file and a full
 * backup can be imported into either place.
 */
export type ExportScope = "all" | "properties" | "investments";

export const EXPORT_SCOPES: Record<ExportScope, { label: string; sections: readonly SectionName[]; fileName: (stamp: string) => string }> = {
  all: { label: "all your data", sections: SECTION_ORDER, fileName: (stamp) => `revenue-expense-tracker-${stamp}.csv` },
  properties: {
    label: "property portfolio",
    // `categories` carries only the categories the rental-schedule lines refer to.
    sections: ["categories", "properties", "property_owners", "property_schedule_lines", "property_year_details", "property_photos"],
    fileName: () => "property_portfolio.csv",
  },
  investments: {
    label: "investment portfolio",
    sections: ["investments", "investment_valuations", "investment_transactions", "dividends", "capital_gain_disposals"],
    fileName: () => "investment_portfolio.csv",
  },
};

export function isExportScope(value: unknown): value is ExportScope {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EXPORT_SCOPES, value);
}

/**
 * Columns a section must have for its rows to be usable. A group (an array) means any one of the
 * names will do — a record can be pointed at by its id or by its readable name.
 * Derived from the fields the importer requires of every row.
 */
export const REQUIRED_COLUMNS: Partial<Record<SectionName, ReadonlyArray<string | readonly string[]>>> = {
  accounts: ["name"],
  categories: ["name", "direction"],
  properties: ["name"],
  property_owners: ["property_id"],
  property_schedule_lines: [["property_id", "property"], ["category_id", "category"]],
  property_year_details: [["property_id", "property"], "financial_year"],
  property_photos: [["property_id", "property"], "file_name", "content_type", "file_path"],
  investments: ["name", "type"],
  investment_valuations: [["investment_id", "investment"], "as_at", "units", "market_price", "market_value", "market_value_aud"],
  investment_transactions: [["investment_id", "investment"], "type", "date", "quantity", "price_per_unit"],
  dividends: [["investment_id", "investment"], "gross_amount", "net_amount"],
  capital_gain_disposals: [["investment_id", "investment"], "purchase_date", "purchase_price", "sale_date", "sale_price", "quantity", "cost_base", "proceeds", "gross_gain_loss"],
  transactions: ["date", "description", "amount", "direction"],
  bills: ["name", "amount", "frequency", "next_due_date"],
  reminders: ["title", "due_date"],
  documents: ["file_name", "file_type", "file_path"],
};

/** Names of the required columns a header row doesn't have (a group is reported as "a or b"). */
export function missingRequiredColumns(section: SectionName, headers: readonly string[]): string[] {
  const have = new Set(headers);
  const missing: string[] = [];
  for (const need of REQUIRED_COLUMNS[section] ?? []) {
    if (typeof need === "string") {
      if (!have.has(need)) missing.push(need);
    } else if (!need.some((n) => have.has(n))) {
      missing.push(need.join(" or "));
    }
  }
  return missing;
}
