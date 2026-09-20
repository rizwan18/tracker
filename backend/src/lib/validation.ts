import { z } from "zod";
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
