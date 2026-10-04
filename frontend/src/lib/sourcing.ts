import type {
  SourcingInspectionResult, SourcingOrigin, SourcingPaymentMethod, SourcingPaymentType, SourcingShipmentMethod, SourcingStatus,
} from "../api/businessTypes";
import { formatCurrencyIn } from "./format";

export const ORIGIN_LABELS: Record<SourcingOrigin, string> = { OVERSEAS: "Overseas", LOCAL: "Local" };

export const STATUS_LABELS: Record<SourcingStatus, string> = {
  ENQUIRY: "Enquiry", ORDERED: "Ordered", IN_PRODUCTION: "In production", SHIPPED: "Shipped", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};
export const STATUS_ORDER = Object.keys(STATUS_LABELS) as SourcingStatus[];

export const PAYMENT_TYPE_LABELS: Record<SourcingPaymentType, string> = { DEPOSIT: "Deposit", PROGRESS: "Progress payment", BALANCE: "Balance", FULL: "Paid in full", OTHER: "Other" };
export const PAYMENT_METHOD_LABELS: Record<SourcingPaymentMethod, string> = { BANK_TRANSFER: "Bank transfer", CREDIT_CARD: "Credit card", PAYPAL: "PayPal", CASH: "Cash", OTHER: "Other" };
export const INSPECTION_RESULT_LABELS: Record<SourcingInspectionResult, string> = { PENDING: "Pending", PASSED: "Passed", FAILED: "Failed", PASSED_WITH_NOTES: "Passed with notes" };
export const SHIPMENT_METHOD_LABELS: Record<SourcingShipmentMethod, string> = { SEA: "Sea freight", AIR: "Air freight", COURIER: "Courier", ROAD: "Road", OTHER: "Other" };

export const STATUS_BADGE: Record<SourcingStatus, string> = {
  ENQUIRY: "bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]",
  ORDERED: "bg-[var(--color-ochre-tint)] text-[#7a4d1a]",
  IN_PRODUCTION: "bg-[var(--color-ochre-tint)] text-[#7a4d1a]",
  SHIPPED: "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]",
  DELIVERED: "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]",
  CANCELLED: "bg-[var(--color-brick-tint)] text-[var(--color-brick)]",
};

/** Common currencies offered in a dropdown; any other 3-letter code can still be typed. */
export const COMMON_CURRENCIES = ["AUD", "USD", "CNY", "EUR", "GBP", "NZD", "JPY", "INR", "VND", "THB", "IDR"];

/** Whole cents in the order's own currency, e.g. "US$1,234.50". */
export function formatOrderMoney(cents: number, currency: string): string {
  return formatCurrencyIn(cents / 100, currency);
}

/** 40 → "40%", 37.5 → "37.5%" (no trailing zeros). */
export function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

/** Where a sourcing order lives (it sits under its product/SKU). The older /business/sourcing/:id address still works too. */
export const orderPath = (id: string) => `/business/products/orders/${id}`;
export const productPath = (id: string) => `/business/products/${id}`;

/** The signed-in API address of a product's picture. `v` changes when the picture is replaced, so it's never served stale from cache. */
export const productImagePath = (p: { id: string; imageVersion: number }, size: "thumb" | "full") => `/business/products/${p.id}/image?size=${size}&v=${p.imageVersion}`;
