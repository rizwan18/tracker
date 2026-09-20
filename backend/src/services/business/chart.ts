/** Chart of accounts for a small Australian business. */

export const ACCOUNT_TYPES_LEDGER = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type LedgerAccountType = (typeof ACCOUNT_TYPES_LEDGER)[number];

export const ACCOUNT_GROUPS = [
  "CURRENT_ASSET",
  "NON_CURRENT_ASSET",
  "CURRENT_LIABILITY",
  "NON_CURRENT_LIABILITY",
  "EQUITY",
  "REVENUE",
  "COST_OF_SALES",
  "OTHER_INCOME",
  "OPERATING_EXPENSE",
] as const;
export type LedgerAccountGroup = (typeof ACCOUNT_GROUPS)[number];

/** Which groups make sense for each type (used to validate new accounts). */
export const GROUPS_BY_TYPE: Record<LedgerAccountType, readonly LedgerAccountGroup[]> = {
  ASSET: ["CURRENT_ASSET", "NON_CURRENT_ASSET"],
  LIABILITY: ["CURRENT_LIABILITY", "NON_CURRENT_LIABILITY"],
  EQUITY: ["EQUITY"],
  INCOME: ["REVENUE", "OTHER_INCOME"],
  EXPENSE: ["COST_OF_SALES", "OPERATING_EXPENSE"],
};

export type SystemKey = "ACCOUNTS_RECEIVABLE" | "ACCOUNTS_PAYABLE" | "GST_COLLECTED" | "GST_PAID" | "RETAINED_EARNINGS";

export interface DefaultAccount {
  code: string;
  name: string;
  type: LedgerAccountType;
  group: LedgerAccountGroup;
  systemKey?: SystemKey;
  isBank?: boolean;
}

export const DEFAULT_CHART: DefaultAccount[] = [
  // Assets
  { code: "1000", name: "Cash at Bank", type: "ASSET", group: "CURRENT_ASSET", isBank: true },
  { code: "1010", name: "Cash on Hand", type: "ASSET", group: "CURRENT_ASSET", isBank: true },
  { code: "1100", name: "Accounts Receivable", type: "ASSET", group: "CURRENT_ASSET", systemKey: "ACCOUNTS_RECEIVABLE" },
  { code: "1200", name: "Inventory (Stock on Hand)", type: "ASSET", group: "CURRENT_ASSET" },
  { code: "1300", name: "Prepayments", type: "ASSET", group: "CURRENT_ASSET" },
  { code: "1400", name: "GST Paid on Purchases", type: "ASSET", group: "CURRENT_ASSET", systemKey: "GST_PAID" },
  { code: "1500", name: "Equipment & Plant", type: "ASSET", group: "NON_CURRENT_ASSET" },
  { code: "1510", name: "Accumulated Depreciation – Equipment", type: "ASSET", group: "NON_CURRENT_ASSET" },
  { code: "1600", name: "Motor Vehicles", type: "ASSET", group: "NON_CURRENT_ASSET" },
  { code: "1610", name: "Accumulated Depreciation – Vehicles", type: "ASSET", group: "NON_CURRENT_ASSET" },
  // Liabilities
  { code: "2000", name: "Accounts Payable", type: "LIABILITY", group: "CURRENT_LIABILITY", systemKey: "ACCOUNTS_PAYABLE" },
  { code: "2100", name: "Credit Card", type: "LIABILITY", group: "CURRENT_LIABILITY", isBank: true },
  { code: "2200", name: "GST Collected on Sales", type: "LIABILITY", group: "CURRENT_LIABILITY", systemKey: "GST_COLLECTED" },
  { code: "2300", name: "PAYG Withholding Payable", type: "LIABILITY", group: "CURRENT_LIABILITY" },
  { code: "2310", name: "Superannuation Payable", type: "LIABILITY", group: "CURRENT_LIABILITY" },
  { code: "2400", name: "Loans – Current", type: "LIABILITY", group: "CURRENT_LIABILITY" },
  { code: "2500", name: "Loans – Non-current", type: "LIABILITY", group: "NON_CURRENT_LIABILITY" },
  // Equity
  { code: "3000", name: "Owner's Contributions / Share Capital", type: "EQUITY", group: "EQUITY" },
  { code: "3100", name: "Retained Earnings (Opening)", type: "EQUITY", group: "EQUITY", systemKey: "RETAINED_EARNINGS" },
  { code: "3200", name: "Owner's Drawings / Dividends", type: "EQUITY", group: "EQUITY" },
  // Income
  { code: "4000", name: "Sales", type: "INCOME", group: "REVENUE" },
  { code: "4100", name: "Service Revenue", type: "INCOME", group: "REVENUE" },
  { code: "4900", name: "Interest Income", type: "INCOME", group: "OTHER_INCOME" },
  { code: "4910", name: "Other Income", type: "INCOME", group: "OTHER_INCOME" },
  // Cost of sales
  { code: "5000", name: "Cost of Goods Sold", type: "EXPENSE", group: "COST_OF_SALES" },
  // Operating expenses
  { code: "6000", name: "Advertising & Marketing", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6010", name: "Bank Fees & Charges", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6020", name: "Accounting & Legal Fees", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6030", name: "Computer & Software", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6040", name: "Depreciation", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6050", name: "Insurance", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6060", name: "Interest Expense", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6070", name: "Motor Vehicle Expenses", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6080", name: "Office Supplies", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6090", name: "Rent", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6100", name: "Repairs & Maintenance", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6110", name: "Superannuation", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6120", name: "Telephone & Internet", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6130", name: "Travel", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6140", name: "Utilities", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6150", name: "Wages & Salaries", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6160", name: "Subscriptions & Memberships", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6170", name: "Training & Education", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6180", name: "Meals & Entertainment", type: "EXPENSE", group: "OPERATING_EXPENSE" },
  { code: "6190", name: "Other Expenses", type: "EXPENSE", group: "OPERATING_EXPENSE" },
];

/** Assets and expenses increase with debits; liabilities, equity and income increase with credits. */
export function isDebitNormal(type: string): boolean {
  return type === "ASSET" || type === "EXPENSE";
}

/** Fixed (non-current) assets — purchases of these are "capital purchases" on the BAS. */
export function isFixedAsset(account: { type: string; group: string }): boolean {
  return account.type === "ASSET" && account.group === "NON_CURRENT_ASSET";
}
