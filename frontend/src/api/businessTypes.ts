export type LedgerType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
export type LedgerGroup = "CURRENT_ASSET" | "NON_CURRENT_ASSET" | "CURRENT_LIABILITY" | "NON_CURRENT_LIABILITY" | "EQUITY" | "REVENUE" | "COST_OF_SALES" | "OTHER_INCOME" | "OPERATING_EXPENSE";

export interface BusinessProfile {
  businessName: string;
  abn: string | null;
  abnFormatted: string | null;
  entityType: "COMPANY" | "SOLE_TRADER" | "PARTNERSHIP" | "TRUST";
  gstRegistered: boolean;
  gstBasis: "ACCRUAL" | "CASH";
}

export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  type: LedgerType;
  group: LedgerGroup;
  isBank: boolean;
  isActive: boolean;
  isSystem: boolean;
  balanceCents: number;
  hasActivity: boolean;
}

export interface BusinessEntry {
  id: string;
  kind: "INCOME" | "EXPENSE";
  date: string;
  dueDate: string | null;
  description: string;
  contactName: string | null;
  reference: string | null;
  account: { id: string; code: string; name: string };
  totalCents: number;
  gstCents: number;
  netCents: number;
  gstMode: "INCLUSIVE" | "EXCLUSIVE" | "FREE";
  status: "PAID" | "UNPAID";
  paidDate: string | null;
  bankAccount: { id: string; code: string; name: string } | null;
  notes: string | null;
}

export interface BusinessSummary {
  financialYear: string;
  asAt: string;
  incomeCents: number;
  expensesCents: number;
  netProfitCents: number;
  cashCents: number;
  receivablesCents: number;
  receivablesOverdueCents: number;
  payablesCents: number;
  payablesOverdueCents: number;
  gstRegistered: boolean;
  netGstCents: number;
  months: MonthlyRow[];
  recent: BusinessEntry[];
  hasData: boolean;
}

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amountCents: number;
}
export interface Section {
  lines: StatementLine[];
  totalCents: number;
}
export interface IncomeStatement {
  revenue: Section;
  costOfSales: Section;
  grossProfitCents: number;
  otherIncome: Section;
  operatingExpenses: Section;
  totalExpensesCents: number;
  netProfitCents: number;
}
export interface BalanceSheet {
  currentAssets: Section;
  nonCurrentAssets: Section;
  totalAssetsCents: number;
  currentLiabilities: Section;
  nonCurrentLiabilities: Section;
  totalLiabilitiesCents: number;
  netAssetsCents: number;
  equity: Section;
  balanced: boolean;
}
export interface TrialBalance {
  rows: Array<{ accountId: string; code: string; name: string; type: string; debitCents: number; creditCents: number }>;
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
}
export interface GstReport {
  basis: "ACCRUAL" | "CASH";
  g1TotalSalesCents: number;
  g3GstFreeSalesCents: number;
  oneAGstOnSalesCents: number;
  g10CapitalPurchasesCents: number;
  g11NonCapitalPurchasesCents: number;
  oneBGstOnPurchasesCents: number;
  netGstCents: number;
  salesCount: number;
  purchaseCount: number;
}
export type AgedBucket = "current" | "days1to30" | "days31to60" | "days61to90" | "over90";
export interface AgedReport {
  rows: Array<{ id: string; contactName: string; reference: string | null; description: string; date: string; dueDate: string; daysOverdue: number; bucket: AgedBucket; totalCents: number }>;
  contacts: Array<{ contactName: string; totals: Record<AgedBucket, number>; totalCents: number }>;
  totals: Record<AgedBucket, number>;
  totalCents: number;
}
export interface CashSummary {
  accounts: Array<{ accountId: string; code: string; name: string; openingCents: number; moneyInCents: number; moneyOutCents: number; closingCents: number }>;
  openingCents: number;
  moneyInCents: number;
  moneyOutCents: number;
  closingCents: number;
}
export interface MonthlyRow {
  month: string;
  incomeCents: number;
  expensesCents: number;
  netCents: number;
}
export interface LedgerReport {
  openingCents: number;
  rows: Array<{ date: string; description: string; reference: string | null; debitCents: number; creditCents: number; balanceCents: number }>;
  closingCents: number;
  totalDebitCents: number;
  totalCreditCents: number;
}
export interface ManualJournal {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  lines: Array<{ accountCode: string; accountName: string; debitCents: number; creditCents: number; memo: string | null }>;
  totalCents: number;
}
