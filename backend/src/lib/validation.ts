import { z } from "zod";
import { isValidAbn, normaliseAbn } from "./abn";
import { GST_MODES } from "../services/business/gst";
import { ACCOUNT_GROUPS, ACCOUNT_TYPES_LEDGER, GROUPS_BY_TYPE } from "../services/business/chart";
import { BILL_FREQUENCIES, INVESTMENT_TYPES, INVESTMENT_TRANSACTION_TYPES, TRANSACTION_DIRECTIONS, DIVIDEND_STATUSES, RENT_FREQUENCIES, PROPERTY_TYPES, PORTFOLIO_TYPES } from "./constants";

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
});

export const investmentTransactionSchema = z.object({
  type: z.enum(INVESTMENT_TRANSACTION_TYPES),
  date: z.coerce.date(),
  quantity: z.coerce.number().positive("Quantity must be greater than zero."),
  pricePerUnit: z.coerce.number().positive("Price must be greater than zero."),
  brokerage: z.coerce.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

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
    reference: z.string().trim().max(60).nullable().optional(),
    accountId: z.string().min(1, "Please choose a category."),
    /** The amount as typed, in cents; GST is added or extracted according to gstMode. */
    amountCents: z.number().int("Amounts are in whole cents.").min(1, "The amount must be more than zero.").max(MAX_ENTRY_CENTS, "That amount is too large."),
    gstMode: z.enum(GST_MODES).default("INCLUSIVE"),
    status: z.enum(["PAID", "UNPAID"]).default("PAID"),
    paidDate: z.coerce.date().nullable().optional(),
    bankAccountId: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.status !== "PAID" || (!!v.bankAccountId && !!v.paidDate), { message: "Choose the bank account and the date it was paid." });

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
  managerAddress: optionalText(300),
  managerNotes: optionalText(2000),
});
