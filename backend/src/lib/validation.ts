import { z } from "zod";
import { isValidAbn, normaliseAbn } from "./abn";
import { normaliseWebsite } from "./website";
import { GST_MODES } from "../services/business/gst";
import { ACCOUNT_GROUPS, ACCOUNT_TYPES_LEDGER, GROUPS_BY_TYPE } from "../services/business/chart";
import {
  BILL_FREQUENCIES, INVESTMENT_TYPES, INVESTMENT_TRANSACTION_TYPES, TRANSACTION_DIRECTIONS, DIVIDEND_STATUSES, RENT_FREQUENCIES, PROPERTY_TYPES, PORTFOLIO_TYPES,
  SOURCING_ORIGINS, SOURCING_STATUSES, SOURCING_PAYMENT_TYPES, SOURCING_PAYMENT_METHODS, SOURCING_INSPECTION_RESULTS, SOURCING_SHIPMENT_METHODS,
  HOLIDAY_STATUSES, HOLIDAY_EXPENSE_CATEGORIES, HOLIDAY_MILESTONE_TYPES, CONTACT_TYPES,
} from "./constants";

export const registerSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().min(1, "Please enter your name."),
  householdName: z.string().min(1).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters."),
});

export const transactionSchema = z.object({
  date: z.coerce.date(),
  description: z.string().min(1, "Please add a short description."),
  amount: z.coerce.number().positive("Amount must be greater than zero."),
  direction: z.enum(TRANSACTION_DIRECTIONS),
  categoryId: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
  propertyId: z.string().optional().nullable(),
  investmentId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isRecurring: z.boolean().optional(),
  recurrenceFrequency: z.enum(BILL_FREQUENCIES).optional().nullable(),
  potentialTaxCategory: z.string().optional().nullable(),
});

export const propertySchema = z.object({
  name: z.string().min(1, "Please give this property a name."),
  address: z.string().optional().nullable(),
  /** Investment property or principal place of residence. Defaults to investment when omitted. */
  propertyType: z.enum(PROPERTY_TYPES).default("INVESTMENT"),
  purchaseDate: z.coerce.date().optional().nullable(),
  purchasePrice: z.coerce.number().optional().nullable(),
  currentEstimatedValue: z.coerce.number().optional().nullable(),
  loanBalance: z.coerce.number().optional().nullable(),
  loanInterestRate: z.coerce.number().optional().nullable(),
  rentalAgent: z.string().optional().nullable(),
  tenantName: z.string().optional().nullable(),
  rentAmount: z.coerce.number().optional().nullable(),
  rentFrequency: z.enum(RENT_FREQUENCIES).optional().nullable(),
  rentalStartDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const investmentSchema = z.object({
  name: z.string().min(1, "Please name this investment."),
  ticker: z.string().optional().nullable(),
  type: z.enum(INVESTMENT_TYPES),
  notes: z.string().optional().nullable(),
  currentValueOverride: z.coerce.number().optional().nullable(),
  /** Where a share or ETF is traded. Older records leave this empty and count as ASX. */
  market: z.enum(["ASX", "WALL_ST"]).optional().nullable(),
  currency: z.enum(["AUD", "USD"]).default("AUD"),
});

/** A dated snapshot of a holding (units × price, in the investment's currency). */
export const investmentValuationSchema = z.object({
  asAt: z.coerce.date(),
  units: z.coerce.number().min(0, "Units can't be negative.").max(1e12),
  marketPrice: z.coerce.number().min(0, "The price can't be negative.").max(1e9),
  /** Optional and no longer collected by the app (US holdings are shown in US$ only); still accepted from older clients. */
  fxRate: z.coerce.number().positive("The exchange rate must be more than zero.").max(100).optional().nullable(),
  /** From the "Update holding" form. When present, kept in sync with this holding's opening BUY
   * transaction (see the /valuation route) so brokerage is reflected in cost base and unrealised
   * gain/loss, not just the units/price shown here. */
  brokerage: z.coerce.number().min(0, "Brokerage fees can't be negative.").optional(),
});

export const investmentTransactionSchema = z.object({
  type: z.enum(INVESTMENT_TRANSACTION_TYPES),
  date: z.coerce.date(),
  quantity: z.coerce.number().positive("Quantity must be greater than zero."),
  pricePerUnit: z.coerce.number().positive("Price must be greater than zero."),
  brokerage: z.coerce.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

/**
 * The initial buy recorded from the "Add an investment" form (Units + Purchase Price + Purchase
 * Date + Brokerage fees). Reuses investmentTransactionSchema's own field rules so this initial buy
 * is validated exactly like any other buy/sell transaction — it's always a BUY, so `type`/`notes`
 * aren't collected here.
 */
export const investmentInitialTransactionSchema = investmentTransactionSchema.omit({ type: true, notes: true });

export const dividendSchema = z.object({
  investmentId: z.string().min(1),
  exDividendDate: z.coerce.date().optional().nullable(),
  paymentDate: z.coerce.date().optional().nullable(),
  grossAmount: z.coerce.number().min(0),
  frankingCredit: z.coerce.number().min(0).optional(),
  frankedAmount: z.coerce.number().min(0).optional(),
  unfrankedAmount: z.coerce.number().min(0).optional(),
  taxWithheld: z.coerce.number().min(0).optional(),
  netAmount: z.coerce.number().min(0),
  status: z.enum(DIVIDEND_STATUSES).optional(),
  notes: z.string().optional().nullable(),
});

export const billSchema = z.object({
  name: z.string().min(1, "Please name this bill."),
  provider: z.string().optional().nullable(),
  amount: z.coerce.number().positive("Amount must be greater than zero."),
  frequency: z.enum(BILL_FREQUENCIES),
  nextDueDate: z.coerce.date(),
  accountId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  propertyId: z.string().optional().nullable(),
  autoRenew: z.boolean().optional(),
  reminderDaysBefore: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional().nullable(),
});

export const reminderUpdateSchema = z.object({
  status: z.enum(["PENDING", "SNOOZED", "COMPLETE", "DISABLED"]).optional(),
  dueDate: z.coerce.date().optional(),
});

export const capitalGainSchema = z.object({
  investmentId: z.string().min(1),
  purchaseDate: z.coerce.date(),
  purchasePrice: z.coerce.number().min(0),
  purchaseCosts: z.coerce.number().min(0).optional(),
  saleDate: z.coerce.date(),
  salePrice: z.coerce.number().min(0),
  saleCosts: z.coerce.number().min(0).optional(),
  quantity: z.coerce.number().positive(),
  ownershipPercentage: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional().nullable(),
});

export const financialYearIdSchema = z.string().regex(/^\d{4}-\d{2}$/, "Use a financial year like 2026-27.");

export const scheduleLineSchema = z
  .object({
    /** Use an existing category… */
    categoryId: z.string().min(1).optional(),
    /** …or create a new one by name (direction required). */
    name: z.string().trim().min(1, "Please give this line a name.").max(80).optional(),
    direction: z.enum(TRANSACTION_DIRECTIONS).optional(),
    label: z.string().trim().max(80).optional().nullable(),
    isManual: z.boolean().optional(),
  })
  .refine((v) => !!v.categoryId || (!!v.name && !!v.direction), {
    message: "Choose an existing category, or give the new line a name and type.",
  });

export const scheduleDetailsSchema = z.object({
  financialYear: financialYearIdSchema,
  weeksRented: z.coerce.number().int().min(0).max(52).nullable().optional(),
  ownershipPercentage: z.coerce.number().min(0).max(100).optional(),
  availableForRentDate: z.coerce.date().nullable().optional(),
});

export const portfolioSchema = z.object({
  type: z.enum(PORTFOLIO_TYPES),
  name: z.string().trim().min(1, "Please give this portfolio a name.").max(100),
});

/** The setup page: one or more portfolios, at most one of each type. */
export const portfolioSetupSchema = z
  .object({ portfolios: z.array(portfolioSchema).min(1, "Please choose at least one portfolio type.").max(PORTFOLIO_TYPES.length) })
  .refine((v) => new Set(v.portfolios.map((p) => p.type)).size === v.portfolios.length, { message: "Choose each type only once during setup." });

export const portfolioRenameSchema = z.object({ name: z.string().trim().min(1, "Please give this portfolio a name.").max(100) });

// ---------------------------------------------------------------------------
// Small-business accounting
// ---------------------------------------------------------------------------
/** Largest amount accepted in one entry: $19,000,000 (money is stored as whole cents in a 32-bit column). */
export const MAX_ENTRY_CENTS = 1_900_000_000;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-19.");
export const isoDaySchema = isoDay;

export const businessProfileSchema = z.object({
  businessName: z.string().trim().min(1, "Please enter the business name.").max(120),
  abn: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .refine((v) => !v || isValidAbn(v), { message: "That ABN doesn't look right — an ABN has 11 digits." })
    .transform((v) => (v ? normaliseAbn(v) : null)),
  entityType: z.enum(["COMPANY", "SOLE_TRADER", "PARTNERSHIP", "TRUST"]).default("COMPANY"),
  gstRegistered: z.boolean().default(false),
  gstBasis: z.enum(["ACCRUAL", "CASH"]).default("ACCRUAL"),
});

export const businessEntrySchema = z
  .object({
    kind: z.enum(["INCOME", "EXPENSE"]),
    date: z.coerce.date(),
    dueDate: z.coerce.date().nullable().optional(),
    description: z.string().trim().min(1, "Please describe it.").max(300),
    contactName: z.string().trim().max(150).nullable().optional(),
    /** The customer/supplier picked from Contacts. Left out = unchanged on edit; null = unlinked. */
    contactId: z.string().trim().min(1).max(60).nullable().optional(),
    reference: z.string().trim().max(60).nullable().optional(),
    accountId: z.string().min(1, "Please choose a category."),
    /** The amount as typed, in cents; GST is added or extracted according to gstMode. */
    amountCents: z.number().int("Amounts are in whole cents.").min(1, "The amount must be more than zero.").max(MAX_ENTRY_CENTS, "That amount is too large."),
    gstMode: z.enum(GST_MODES).default("INCLUSIVE"),
    /** Only used when gstMode is MANUAL: the GST part of the amount, in cents. Blank/omitted = $0. */
    gstCents: z.number({ invalid_type_error: "Please enter the GST as an amount." }).int("GST is in whole cents.").min(0, "GST can't be negative.").max(MAX_ENTRY_CENTS, "That GST amount is too large.").nullable().optional(),
    status: z.enum(["PAID", "UNPAID"]).default("PAID"),
    paidDate: z.coerce.date().nullable().optional(),
    bankAccountId: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.status !== "PAID" || (!!v.bankAccountId && !!v.paidDate), { message: "Choose the bank account and the date it was paid." })
  .refine((v) => v.gstMode !== "MANUAL" || (v.gstCents ?? 0) <= v.amountCents, { message: "The GST can't be more than the amount.", path: ["gstCents"] });

export const businessPaySchema = z.object({ paidDate: z.coerce.date(), bankAccountId: z.string().min(1, "Choose the bank account.") });

export const ledgerAccountSchema = z
  .object({
    code: z.string().trim().regex(/^[0-9A-Za-z.\-]{1,10}$/, "Use up to 10 letters or numbers for the code."),
    name: z.string().trim().min(1, "Please name the account.").max(80),
    type: z.enum(ACCOUNT_TYPES_LEDGER),
    group: z.enum(ACCOUNT_GROUPS),
    isBank: z.boolean().default(false),
  })
  .refine((v) => (GROUPS_BY_TYPE[v.type] as readonly string[]).includes(v.group), { message: "That group doesn't fit the account type." });

export const ledgerAccountUpdateSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Za-z.\-]{1,10}$/, "Use up to 10 letters or numbers for the code.").optional(),
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
});

export const manualJournalSchema = z.object({
  date: z.coerce.date(),
  description: z.string().trim().min(1, "Please describe the entry.").max(300),
  reference: z.string().trim().max(60).nullable().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        debitCents: z.number().int().min(0).max(MAX_ENTRY_CENTS),
        creditCents: z.number().int().min(0).max(MAX_ENTRY_CENTS),
        memo: z.string().trim().max(200).nullable().optional(),
      })
    )
    .min(2, "An entry needs at least two lines."),
});

// ---------------------------------------------------------------------------
// Sourcing (Company Finance)
// ---------------------------------------------------------------------------
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. AUD, USD, CNY.")
  .default("AUD");

const optionalSourcingText = (max: number) =>
  z.string().trim().max(max, `Please keep this under ${max} characters.`).optional().nullable().transform((v) => (v ? v : null));

/** A product / SKU — the parent of its sourcing orders. The picture is uploaded separately. */
export const sourcingProductSchema = z.object({
  name: z.string({ required_error: "Please enter the product name.", invalid_type_error: "Please enter the product name." }).trim().min(1, "Please enter the product name.").max(150, "Please keep the product name under 150 characters."),
  sku: optionalSourcingText(60),
  description: optionalSourcingText(2000),
});

export const sourcingRecordSchema = z
  .object({
    // Which product/SKU the order belongs to. Left out on create = matched/created from the item description.
    productId: z.string().trim().min(1).max(60).optional(),
    origin: z.enum(SOURCING_ORIGINS),
    status: z.enum(SOURCING_STATUSES).default("ENQUIRY"),
    reference: optionalSourcingText(60),
    itemDescription: z.string().trim().min(1, "Please describe what's being sourced.").max(300),
    quantity: z.coerce.number().positive("Quantity must be more than zero.").max(1_000_000),
    unitCostCents: z.number().int("Amounts are in whole cents.").min(0).max(MAX_ENTRY_CENTS),
    currency: currencyCode,
    exchangeRateToAud: z.coerce.number().positive("The exchange rate must be more than zero.").max(1000).optional().nullable(),
    // Gross margin target. Left out = unchanged on edit / 40% on create (the column default).
    targetMarginPercent: z.number({ invalid_type_error: "Please enter the target margin as a number, like 40." }).min(0, "The target margin can't be negative.").lt(100, "The target margin must be below 100%.").optional(),
    orderDate: z.coerce.date().optional().nullable(),
    expectedDate: z.coerce.date().optional().nullable(),
    deliveredDate: z.coerce.date().optional().nullable(),
    // The supplier picked from Contacts. When given, the server fills the supplier details below from that contact.
    supplierId: z.string().trim().min(1).max(60).optional().nullable(),
    supplierName: z.string().trim().max(150).optional().default(""),
    supplierCountry: optionalSourcingText(80),
    supplierContactName: optionalSourcingText(120),
    supplierEmail: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "That email address doesn't look right." })
      .transform((v) => (v ? v : null)),
    supplierPhone: optionalSourcingText(40),
    supplierWebsite: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .refine((v) => !v || normaliseWebsite(v) !== null, { message: "That doesn't look like a website address, e.g. www.supplier.com." })
      .transform((v) => (v ? normaliseWebsite(v) : null)),
    supplierAddress: optionalSourcingText(300),
    notes: optionalSourcingText(2000),
  })
  .refine((v) => !!v.supplierId || v.supplierName.length > 0, { message: "Please choose or name the supplier or manufacturer.", path: ["supplierName"] })
  // With a Contact picked the country comes from the contact (checked when the order is saved).
  .refine((v) => !!v.supplierId || v.origin === "LOCAL" || !!v.supplierCountry, { message: "Please enter the supplier's country for an overseas order.", path: ["supplierCountry"] });

export const sourcingPaymentSchema = z.object({
  date: z.coerce.date(),
  amountCents: z.number().int("Amounts are in whole cents.").min(1, "The amount must be more than zero.").max(MAX_ENTRY_CENTS),
  feeCents: z.number().int("Amounts are in whole cents.").min(0, "The fee can't be negative.").max(MAX_ENTRY_CENTS).default(0),
  type: z.enum(SOURCING_PAYMENT_TYPES).default("DEPOSIT"),
  method: z.enum(SOURCING_PAYMENT_METHODS).optional().nullable(),
  bankAccountId: z.string().optional().nullable(),
  reference: optionalSourcingText(80),
  notes: optionalSourcingText(1000),
  /** Who was paid, when it isn't the order's own supplier. Left out = unchanged on edit; null = cleared. */
  contactId: z.string().trim().min(1).max(60).optional().nullable(),
});

export const sourcingInspectionSchema = z.object({
  date: z.coerce.date(),
  inspector: optionalSourcingText(150),
  /** The inspection company picked from Contacts (fills `inspector` with its name). */
  inspectorId: z.string().trim().min(1).max(60).optional().nullable(),
  result: z.enum(SOURCING_INSPECTION_RESULTS).default("PENDING"),
  costCents: z.number().int("Amounts are in whole cents.").min(0).max(MAX_ENTRY_CENTS).default(0),
  notes: optionalSourcingText(2000),
});

export const sourcingShipmentSchema = z.object({
  method: z.enum(SOURCING_SHIPMENT_METHODS).optional().nullable(),
  carrier: optionalSourcingText(120),
  /** Contacts picked for this shipment. Left out = unchanged on edit; null = cleared. */
  forwarderId: z.string().trim().min(1).max(60).optional().nullable(),
  customsAgentId: z.string().trim().min(1).max(60).optional().nullable(),
  logisticsId: z.string().trim().min(1).max(60).optional().nullable(),
  warehouseId: z.string().trim().min(1).max(60).optional().nullable(),
  trackingNumber: optionalSourcingText(80),
  shippedDate: z.coerce.date().optional().nullable(),
  eta: z.coerce.date().optional().nullable(),
  arrivedDate: z.coerce.date().optional().nullable(),
  freightCostCents: z.number().int("Amounts are in whole cents.").min(0).max(MAX_ENTRY_CENTS).default(0),
  customsDutyCents: z.number().int("Amounts are in whole cents.").min(0).max(MAX_ENTRY_CENTS).default(0),
  insuranceCostCents: z.number().int("Amounts are in whole cents.").min(0).max(MAX_ENTRY_CENTS).default(0),
  otherCostCents: z.number().int("Amounts are in whole cents.").min(0).max(MAX_ENTRY_CENTS).default(0),
  notes: optionalSourcingText(2000),
});

// ---------------------------------------------------------------------------
// Contacts (Company Finance)
// ---------------------------------------------------------------------------
const contactEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "That email address doesn't look right." })
  .transform((v) => (v ? v : null));

const contactWebsite = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .refine((v) => !v || normaliseWebsite(v) !== null, { message: "That doesn't look like a website address, e.g. www.supplier.com." })
  .transform((v) => (v ? normaliseWebsite(v) : null));

/** A phone / WhatsApp / WeChat style value: free text, but only characters that make sense in one. */
const contactHandle = (max: number) => optionalSourcingText(max);

export const contactTypesSchema = z
  .array(z.enum(CONTACT_TYPES), { required_error: "Please choose at least one contact type.", invalid_type_error: "Please choose at least one contact type." })
  .min(1, "Please choose at least one contact type.")
  .transform((t) => CONTACT_TYPES.filter((x) => t.includes(x))); // de-duplicated, in a fixed order

/** One person at a contact's business. */
export const contactPersonSchema = z.object({
  name: z.string({ required_error: "Please enter the person's name." }).trim().min(1, "Please enter the person's name.").max(120),
  role: optionalSourcingText(120),
  email: contactEmail,
  phone: contactHandle(40),
  mobile: contactHandle(40),
  whatsapp: contactHandle(60),
  wechat: contactHandle(60),
  notes: optionalSourcingText(1000),
  isPrimary: z.boolean().optional(),
});

export const contactSchema = z.object({
  name: z.string({ required_error: "Please enter the business name." }).trim().min(1, "Please enter the business name.").max(150),
  types: contactTypesSchema,
  country: optionalSourcingText(80),
  state: optionalSourcingText(80),
  city: optionalSourcingText(80),
  address: optionalSourcingText(300),
  website: contactWebsite,
  email: contactEmail,
  phone: contactHandle(40),
  mobile: contactHandle(40),
  whatsapp: contactHandle(60),
  wechat: contactHandle(60),
  otherContact: optionalSourcingText(200),
  abn: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .refine((v) => !v || isValidAbn(v), { message: "That ABN doesn't look right — an ABN has 11 digits." })
    .transform((v) => (v ? normaliseAbn(v) : null)),
  registrationNumber: optionalSourcingText(60),
  taxNumber: optionalSourcingText(60),
  paymentTerms: optionalSourcingText(120),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .nullable()
    .refine((v) => !v || /^[A-Z]{3}$/.test(v), { message: "Use a 3-letter currency code, e.g. AUD, USD, CNY." })
    .transform((v) => (v ? v : null)),
  notes: optionalSourcingText(2000),
  /** Optional: the main person to start the contact with (create only; more people are added on the contact's page). */
  person: z.object({ name: z.string().trim().max(120), role: optionalSourcingText(120) }).optional().nullable(),
  /** Set to true after the person has seen the "this looks like a contact you already have" warning and wants a new one anyway. */
  allowDuplicate: z.boolean().optional(),
});

/** Property manager / managing agent details. Empty strings are treated as "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters.`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const propertyManagerSchema = z.object({
  managerName: optionalText(120),
  managerCompany: optionalText(120),
  managerEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "That email address doesn't look right." })
    .transform((v) => (v ? v : null)),
  managerPhone: optionalText(40),
  managerMobile: optionalText(40),
  managerWebsite: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .refine((v) => !v || normaliseWebsite(v) !== null, { message: "That doesn't look like a website address, e.g. www.youragency.com.au." })
    .transform((v) => (v ? normaliseWebsite(v) : null)),
  managerAbn: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .refine((v) => !v || isValidAbn(v), { message: "That ABN doesn't look right — an ABN has 11 digits." })
    .transform((v) => (v ? normaliseAbn(v) : null)),
  managerAddress: optionalText(300),
  managerNotes: optionalText(2000),
});

/** Saving manager details, optionally copying the same details onto other properties. */
export const propertyManagerSaveSchema = propertyManagerSchema.extend({
  applyToPropertyIds: z.array(z.string().min(1)).max(50).optional(),
});

// ---------------------------------------------------------------------------
// Holiday planner (Personal Finance)
// ---------------------------------------------------------------------------
const optionalHolidayText = (max: number) =>
  z.string().trim().max(max, `Please keep this under ${max} characters.`).optional().nullable().transform((v) => (v ? v : null));

const holidayAmount = z.coerce.number({ invalid_type_error: "Please enter an amount." }).min(0, "Amounts can't be negative.").max(10_000_000, "That amount looks too large.");

export const holidayPlanSchema = z
  .object({
    name: z.string().trim().min(1, "Please name this holiday.").max(120),
    destination: optionalHolidayText(150),
    status: z.enum(HOLIDAY_STATUSES).default("PLANNING"),
    startDate: z.coerce.date().optional().nullable(),
    endDate: z.coerce.date().optional().nullable(),
    travellers: z.coerce.number().int("Travellers must be a whole number.").min(1, "At least one traveller.").max(50).default(1),
    budget: holidayAmount.optional().nullable(),
    notes: optionalHolidayText(2000),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: "The return date can't be before the departure date.", path: ["endDate"] });

export const holidayExpenseSchema = z.object({
  category: z.enum(HOLIDAY_EXPENSE_CATEGORIES).default("OTHER"),
  description: z.string().trim().min(1, "Please describe this expense.").max(200),
  estimatedAmount: holidayAmount.default(0),
  actualAmount: holidayAmount.optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  paidDate: z.coerce.date().optional().nullable(),
  notes: optionalHolidayText(1000),
});

export const holidayMilestoneSchema = z.object({
  title: z.string().trim().min(1, "Please give this a title.").max(150),
  type: z.enum(HOLIDAY_MILESTONE_TYPES).default("OTHER"),
  date: z.coerce.date({ errorMap: () => ({ message: "Please choose a date." }) }),
  done: z.boolean().default(false),
  notes: optionalHolidayText(1000),
});
