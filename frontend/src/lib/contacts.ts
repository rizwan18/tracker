import type { ContactType } from "../api/businessTypes";

export const CONTACT_TYPE_ORDER: ContactType[] = [
  "SUPPLIER_MANUFACTURER", "FREIGHT_FORWARDER", "INSPECTION", "CUSTOMS_AGENT", "LOGISTICS", "WAREHOUSE_3PL", "CUSTOMER", "OTHER",
];

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  SUPPLIER_MANUFACTURER: "Supplier / Manufacturer",
  FREIGHT_FORWARDER: "Freight Forwarder",
  INSPECTION: "Inspection Company",
  CUSTOMS_AGENT: "Customs / Import Agent",
  LOGISTICS: "Shipping / Logistics",
  WAREHOUSE_3PL: "Warehouse / 3PL",
  CUSTOMER: "Customer",
  OTHER: "Other",
};

/** Short names for the filter and small badges. */
export const CONTACT_TYPE_SHORT: Record<ContactType, string> = {
  SUPPLIER_MANUFACTURER: "Supplier",
  FREIGHT_FORWARDER: "Freight",
  INSPECTION: "Inspection",
  CUSTOMS_AGENT: "Customs",
  LOGISTICS: "Logistics",
  WAREHOUSE_3PL: "Warehouse",
  CUSTOMER: "Customer",
  OTHER: "Other",
};

export const SHIPMENT_ROLE_LABELS: Record<string, string> = {
  SUPPLIER: "Supplier", FORWARDER: "Freight forwarder", CUSTOMS_AGENT: "Customs agent", LOGISTICS: "Logistics", WAREHOUSE: "Warehouse",
};

const digits = (v: string) => v.replace(/[^\d+]/g, "");

/** Links for the quick actions. Only ever mailto:, tel: or https://wa.me — never anything a contact's text could turn into a script. */
export const mailtoHref = (email: string) => `mailto:${email.trim()}`;
export const telHref = (phone: string) => `tel:${digits(phone)}`;
/** wa.me wants the number with country code and no "+", spaces or dashes. */
export function whatsappHref(number: string): string | null {
  const d = number.replace(/\D/g, "");
  return d.length >= 7 && d.length <= 15 ? `https://wa.me/${d}` : null;
}

/** The first way to reach a contact, for a one-line summary. */
export const bestChannel = (c: { email?: string | null; phone?: string | null; mobile?: string | null; whatsapp?: string | null; wechat?: string | null }) =>
  c.email || c.mobile || c.phone || c.whatsapp || (c.wechat ? `WeChat: ${c.wechat}` : null);

export const locationOf = (c: { city?: string | null; state?: string | null; country?: string | null }) => [c.city, c.state, c.country].filter(Boolean).join(", ");

/** Types of contact that make sense to offer for each job, most relevant first. */
export const PICK_FOR = {
  supplier: ["SUPPLIER_MANUFACTURER"] as ContactType[],
  forwarder: ["FREIGHT_FORWARDER", "LOGISTICS"] as ContactType[],
  customs: ["CUSTOMS_AGENT"] as ContactType[],
  logistics: ["LOGISTICS", "FREIGHT_FORWARDER"] as ContactType[],
  warehouse: ["WAREHOUSE_3PL"] as ContactType[],
  inspection: ["INSPECTION"] as ContactType[],
  customer: ["CUSTOMER"] as ContactType[],
};

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
