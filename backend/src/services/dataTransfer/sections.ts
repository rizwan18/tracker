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
    "manager_address", "manager_notes",
  ],
  property_owners: ["property_id", "property", "owner_email", "ownership_percentage"],
  property_schedule_lines: ["id", "property_id", "property", "category_id", "category", "label", "is_manual", "sort_order"],
  property_year_details: ["id", "property_id", "property", "financial_year", "weeks_rented"],
  property_photos: ["id", "property_id", "property", "file_name", "content_type", "file_path", "thumb_path", "is_primary"],
  investments: ["id", "name", "ticker", "type", "notes", "current_value_override"],
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
  investment_transactions: "Investment buys & sells",
  dividends: "Dividends",
  capital_gain_disposals: "Capital gains disposals",
  transactions: "Income & expenses",
  bills: "Bills",
  reminders: "Reminders",
  documents: "Document links",
};
