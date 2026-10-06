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
  /** The customer/supplier picked from Contacts, when there is one. */
  contactId: string | null;
  contact: ContactRef | null;
  reference: string | null;
  account: { id: string; code: string; name: string };
  totalCents: number;
  gstCents: number;
  netCents: number;
  gstMode: "INCLUSIVE" | "EXCLUSIVE" | "FREE" | "MANUAL";
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

// ---------------------------------------------------------------------------
// Sourcing (Company Finance)
// ---------------------------------------------------------------------------
export type SourcingOrigin = "OVERSEAS" | "LOCAL";
export type SourcingStatus = "ENQUIRY" | "ORDERED" | "IN_PRODUCTION" | "SHIPPED" | "DELIVERED" | "CANCELLED";
export type SourcingPaymentType = "DEPOSIT" | "PROGRESS" | "BALANCE" | "FULL" | "OTHER";
export type SourcingPaymentMethod = "BANK_TRANSFER" | "CREDIT_CARD" | "PAYPAL" | "CASH" | "OTHER";
export type SourcingInspectionResult = "PENDING" | "PASSED" | "FAILED" | "PASSED_WITH_NOTES";
export type SourcingShipmentMethod = "SEA" | "AIR" | "COURIER" | "ROAD" | "OTHER";

/** Landed cost → cost price per unit → recommended selling price at the target GROSS margin. Cents are in the order's currency; per-unit values are unrounded (fractions of a cent). */
export interface SourcingPricing {
  targetMarginPercent: number;
  landed: { manufacturingCents: number; inspectionCents: number; freightCents: number; otherCents: number; totalCents: number };
  unit:
    | {
        ok: true;
        costPerUnitCents: number;
        sellingPricePerUnitCents: number;
        grossProfitPerUnitCents: number;
        costPerUnitAudEstCents: number | null;
        sellingPricePerUnitAudEstCents: number | null;
      }
    | { ok: false; reason: "MISSING_QUANTITY" | "INVALID_QUANTITY" | "INVALID_COST" | "NO_COST" | "INVALID_MARGIN"; message: string };
}

/** The parent product/SKU, as shown beside one of its sourcing orders. */
export interface SourcingProductRef {
  id: string;
  name: string;
  sku: string | null;
  hasImage: boolean;
  /** Changes whenever the picture is replaced — added to the image URL so a new picture isn't served from cache. */
  imageVersion: number;
}

/** One row in the Sourcing list. Money is whole cents in `currency` (…AudEstCents are estimates in AUD). */
export interface SourcingSummary {
  id: string;
  productId: string | null;
  product: SourcingProductRef | null;
  origin: SourcingOrigin;
  status: SourcingStatus;
  reference: string | null;
  itemDescription: string;
  quantity: number;
  unitCostCents: number;
  currency: string;
  exchangeRateToAud: number | null;
  targetMarginPercent: number;
  orderDate: string | null;
  expectedDate: string | null;
  deliveredDate: string | null;
  supplierId: string | null;
  supplier: ContactRef | null;
  supplierName: string;
  supplierCountry: string | null;
  goodsCostCents: number;
  shippingCostCents: number;
  inspectionCostCents: number;
  transactionFeeCents: number;
  totalCostCents: number;
  paidCents: number;
  balanceCents: number;
  totalCostAudEstCents: number;
  balanceAudEstCents: number;
  pricing: SourcingPricing;
  paymentCount: number;
  inspectionCount: number;
  shipmentCount: number;
  documentCount: number;
}

export interface SourcingPayment {
  id: string;
  date: string;
  amountCents: number;
  /** Transaction fee on top of the payment — an extra cost, not part of amountCents. */
  feeCents: number;
  type: SourcingPaymentType;
  method: SourcingPaymentMethod | null;
  bankAccount: { id: string; code: string; name: string } | null;
  reference: string | null;
  notes: string | null;
  /** Who was paid, when it isn't simply the order's supplier. */
  contactId: string | null;
  contact: ContactRef | null;
  /** Supplier invoices/receipts attached to this payment (optional). */
  documents: SourcingDocument[];
}

export interface SourcingInspection {
  id: string;
  date: string;
  inspector: string | null;
  inspectorId: string | null;
  inspectorContact: ContactRef | null;
  result: SourcingInspectionResult;
  costCents: number;
  notes: string | null;
}

export interface SourcingShipment {
  id: string;
  method: SourcingShipmentMethod | null;
  carrier: string | null;
  forwarderId: string | null;
  forwarder: ContactRef | null;
  customsAgentId: string | null;
  customsAgent: ContactRef | null;
  logisticsId: string | null;
  logistics: ContactRef | null;
  warehouseId: string | null;
  warehouse: ContactRef | null;
  trackingNumber: string | null;
  shippedDate: string | null;
  eta: string | null;
  arrivedDate: string | null;
  freightCostCents: number;
  customsDutyCents: number;
  insuranceCostCents: number;
  otherCostCents: number;
  notes: string | null;
  /** Shipping paperwork (e.g. freight invoice, customs docs) attached to this shipment (optional). */
  documents: SourcingDocument[];
}

export interface SourcingDocument {
  id: string;
  fileName: string;
  fileType: string;
  createdAt: string;
}

export interface SourcingDetail extends SourcingSummary {
  supplierContactName: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  supplierWebsite: string | null;
  supplierAddress: string | null;
  notes: string | null;
  payments: SourcingPayment[];
  inspections: SourcingInspection[];
  shipments: SourcingShipment[];
  documents: SourcingDocument[];
}

export interface SourcingTotals {
  openCount: number;
  totalCostAudEstCents: number;
  paidAudEstCents: number;
  balanceAudEstCents: number;
}

// ---------------------------------------------------------------------------
// Products/SKU (Company Finance): the parent of its sourcing orders
// ---------------------------------------------------------------------------

/** One row in the Products/SKU list. Money is whole cents in `currency` (per-unit values are unrounded fractions of a cent). */
export interface ProductSummary extends SourcingProductRef {
  description: string | null;
  imageFileName: string | null;
  createdAt: string;
  updatedAt: string;
  orderCount: number;
  openOrderCount: number;
  /** The latest order that isn't cancelled — where the product's current cost and selling price come from. */
  latest: {
    orderId: string;
    status: SourcingStatus;
    supplierName: string;
    quantity: number;
    currency: string;
    orderDate: string | null;
    totalCostCents: number;
    costPerUnitCents: number | null;
    sellingPricePerUnitCents: number | null;
    targetMarginPercent: number;
  } | null;
}

export interface ProductDetail extends ProductSummary {
  orders: SourcingSummary[];
}

export interface ProductTotals {
  productCount: number;
  openCount: number;
  totalCostAudEstCents: number;
  paidAudEstCents: number;
  balanceAudEstCents: number;
}

export interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
}


// --------------------------------------------------------------------------- Contacts
export type ContactType = "SUPPLIER_MANUFACTURER" | "FREIGHT_FORWARDER" | "INSPECTION" | "CUSTOMS_AGENT" | "LOGISTICS" | "WAREHOUSE_3PL" | "CUSTOMER" | "OTHER";

/** Just enough of a contact to show its name beside an order, payment, shipment or sale/expense. */
export interface ContactRef {
  id: string;
  name: string;
  types: ContactType[];
  country: string | null;
  isArchived: boolean;
}

/** The details of a contact's business (everything the form edits). */
export interface ContactFields {
  name: string;
  types: ContactType[];
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  wechat: string | null;
  otherContact: string | null;
  abn: string | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  paymentTerms: string | null;
  currency: string | null;
  notes: string | null;
}

export interface ContactPerson {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  wechat: string | null;
  notes: string | null;
  isPrimary: boolean;
}

export interface Contact extends ContactFields {
  id: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContactSummary extends Contact {
  personCount: number;
  primaryPerson: { name: string; role: string | null } | null;
  /** How many orders, payments, shipments, inspections and sales/expenses use this contact. */
  linkCount: number;
}

export interface ContactActivity {
  orders: Array<{ id: string; reference: string | null; itemDescription: string; status: SourcingStatus; orderDate: string | null; quantity: number; unitCostCents: number; currency: string; product: { id: string; name: string; sku: string | null } | null }>;
  payments: Array<{ id: string; date: string; amountCents: number; feeCents: number; type: SourcingPaymentType; currency: string; order: { id: string; reference: string | null; itemDescription: string } }>;
  shipments: Array<{ id: string; method: SourcingShipmentMethod | null; carrier: string | null; trackingNumber: string | null; shippedDate: string | null; eta: string | null; arrivedDate: string | null; roles: Array<"SUPPLIER" | "FORWARDER" | "CUSTOMS_AGENT" | "LOGISTICS" | "WAREHOUSE">; order: { id: string; reference: string | null; itemDescription: string } }>;
  inspections: Array<{ id: string; date: string; result: SourcingInspectionResult; costCents: number; currency: string; order: { id: string; reference: string | null; itemDescription: string } }>;
  entries: Array<{ id: string; kind: "INCOME" | "EXPENSE"; date: string; description: string; totalCents: number; status: "PAID" | "UNPAID" }>;
}

export interface ContactDetail extends Contact {
  people: ContactPerson[];
  activity: ContactActivity;
}

/** One entry in a "pick a contact" box. */
export interface ContactOption {
  id: string;
  name: string;
  types: ContactType[];
  country: string | null;
  email: string | null;
  phone: string | null;
  isArchived: boolean;
  personName: string | null;
}

export interface DuplicateMatch {
  id: string;
  name: string;
  match: "same" | "similar";
  isArchived: boolean;
}

export interface ContactImportResult {
  committed: boolean;
  summary: { create: number; update: number; skip: number; error: number };
  rows: Array<{ name: string; action: "create" | "update" | "skip" | "error"; rows: number[]; types: string[]; people: string[]; messages: string[] }>;
  ignoredColumns: string[];
}
