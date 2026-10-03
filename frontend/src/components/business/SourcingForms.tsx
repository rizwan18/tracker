import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../../api/client";
import type {
  LedgerAccount, SourcingDetail, SourcingInspection, SourcingInspectionResult, SourcingOrigin, SourcingPayment, SourcingPaymentMethod, SourcingPaymentType,
  SourcingShipment, SourcingShipmentMethod, SourcingStatus,
} from "../../api/businessTypes";
import { Button, Field, inputClass } from "../ui";
import { centsToInput, toCents } from "../../lib/money";
import { toInputDate } from "../../lib/format";
import {
  COMMON_CURRENCIES, INSPECTION_RESULT_LABELS, ORIGIN_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, SHIPMENT_METHOD_LABELS, STATUS_LABELS,
} from "../../lib/sourcing";

const BASE = "/business/sourcing";

/** Shared submit plumbing: friendly errors, a saving flag, and consistent buttons. */
function FormShell({ onSubmit, onCancel, saving, error, submitLabel, children }: {
  onSubmit: () => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onSubmit();
      }}
      className="space-y-4"
    >
      {children}
      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}

function useSubmit() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save that. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, setError, run };
}

/** A cost back into an input box: blank when zero, so an empty cost field stays empty. */
const costInput = (cents: number) => (cents ? centsToInput(cents) : "");
const blankToNull = (v: string) => (v.trim() === "" ? null : v.trim());
const select = (id: string, value: string, onChange: (v: string) => void, options: Array<[string, string]>) => (
  <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
    {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
  </select>
);

// --------------------------------------------------------------------------- order
export function SourcingRecordForm({ initial, onSaved, onCancel }: { initial?: SourcingDetail; onSaved: (record: SourcingDetail) => void; onCancel: () => void }) {
  const [origin, setOrigin] = useState<SourcingOrigin>(initial?.origin ?? "OVERSEAS");
  const [status, setStatus] = useState<SourcingStatus>(initial?.status ?? "ENQUIRY");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [itemDescription, setItemDescription] = useState(initial?.itemDescription ?? "");
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : "1");
  const [unitCost, setUnitCost] = useState(initial ? centsToInput(initial.unitCostCents) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? "AUD");
  const [rate, setRate] = useState(initial?.exchangeRateToAud ? String(initial.exchangeRateToAud) : "");
  const [margin, setMargin] = useState(String(initial?.targetMarginPercent ?? 40));
  const [orderDate, setOrderDate] = useState(toInputDate(initial?.orderDate));
  const [expectedDate, setExpectedDate] = useState(toInputDate(initial?.expectedDate));
  const [deliveredDate, setDeliveredDate] = useState(toInputDate(initial?.deliveredDate));
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? "");
  const [supplierCountry, setSupplierCountry] = useState(initial?.supplierCountry ?? "");
  const [supplierContactName, setSupplierContactName] = useState(initial?.supplierContactName ?? "");
  const [supplierEmail, setSupplierEmail] = useState(initial?.supplierEmail ?? "");
  const [supplierPhone, setSupplierPhone] = useState(initial?.supplierPhone ?? "");
  const [supplierWebsite, setSupplierWebsite] = useState(initial?.supplierWebsite ?? "");
  const [supplierAddress, setSupplierAddress] = useState(initial?.supplierAddress ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const { saving, error, setError, run } = useSubmit();

  const code = currency.trim().toUpperCase();
  const foreign = code !== "AUD";

  async function submit() {
    const unitCostCents = unitCost.trim() === "" ? 0 : toCents(unitCost);
    if (unitCostCents === null) return setError("Please enter the unit cost as an amount, like 12.50.");
    const qty = parseFloat(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return setError("Please enter a quantity above zero.");
    const fx = foreign && rate.trim() !== "" ? parseFloat(rate) : null;
    if (foreign && rate.trim() !== "" && (!Number.isFinite(fx) || (fx as number) <= 0)) return setError("Please enter the exchange rate as a number, like 1.52.");

    const marginPercent = margin.trim() === "" ? 40 : Number(margin);
    if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent >= 100) return setError("Please enter the target gross margin as a percentage from 0 to under 100, like 40.");

    await run(async () => {
      const body = {
        targetMarginPercent: marginPercent,
        origin, status, reference: blankToNull(reference), itemDescription: itemDescription.trim(), quantity: qty, unitCostCents, currency: code, exchangeRateToAud: fx,
        orderDate: blankToNull(orderDate), expectedDate: blankToNull(expectedDate), deliveredDate: blankToNull(deliveredDate),
        supplierName: supplierName.trim(), supplierCountry: blankToNull(supplierCountry), supplierContactName: blankToNull(supplierContactName),
        supplierEmail: blankToNull(supplierEmail), supplierPhone: blankToNull(supplierPhone), supplierWebsite: blankToNull(supplierWebsite),
        supplierAddress: blankToNull(supplierAddress), notes: blankToNull(notes),
      };
      const saved = initial ? await api.put<SourcingDetail>(`${BASE}/${initial.id}`, body) : await api.post<SourcingDetail>(BASE, body);
      onSaved(saved);
    });
  }

  return (
    <FormShell onSubmit={submit} onCancel={onCancel} saving={saving} error={error} submitLabel={initial ? "Save changes" : "Add sourcing record"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier is" htmlFor="so-origin">{select("so-origin", origin, (v) => setOrigin(v as SourcingOrigin), Object.entries(ORIGIN_LABELS))}</Field>
        <Field label="Status" htmlFor="so-status">{select("so-status", status, (v) => setStatus(v as SourcingStatus), Object.entries(STATUS_LABELS))}</Field>
      </div>

      <p className="text-sm font-semibold text-[var(--color-ink)] pt-2">Supplier / manufacturer</p>
      <Field label="Name" htmlFor="so-supplier"><input id="so-supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={inputClass} required maxLength={150} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={origin === "OVERSEAS" ? "Country" : "State / country (optional)"} htmlFor="so-country">
          <input id="so-country" value={supplierCountry} onChange={(e) => setSupplierCountry(e.target.value)} className={inputClass} required={origin === "OVERSEAS"} maxLength={80} />
        </Field>
        <Field label="Contact person (optional)" htmlFor="so-contact"><input id="so-contact" value={supplierContactName} onChange={(e) => setSupplierContactName(e.target.value)} className={inputClass} maxLength={120} /></Field>
        <Field label="Email (optional)" htmlFor="so-email"><input id="so-email" type="email" value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} className={inputClass} /></Field>
        <Field label="Phone (optional)" htmlFor="so-phone"><input id="so-phone" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} className={inputClass} maxLength={40} /></Field>
      </div>
      <Field label="Website (optional)" htmlFor="so-web"><input id="so-web" value={supplierWebsite} onChange={(e) => setSupplierWebsite(e.target.value)} className={inputClass} placeholder="www.supplier.com" /></Field>
      <Field label="Address (optional)" htmlFor="so-address"><input id="so-address" value={supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} className={inputClass} maxLength={300} /></Field>

      <p className="text-sm font-semibold text-[var(--color-ink)] pt-2">What you're buying</p>
      <Field label="Item / product" htmlFor="so-item"><input id="so-item" value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} className={inputClass} required maxLength={300} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order / PO number (optional)" htmlFor="so-ref"><input id="so-ref" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} maxLength={60} /></Field>
        <Field label="Quantity" htmlFor="so-qty"><input id="so-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} required /></Field>
        <Field label="Currency" htmlFor="so-currency">
          <input id="so-currency" list="so-currencies" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} maxLength={3} required />
          <datalist id="so-currencies">{COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label={`Supplier price per unit (${code || "…"})`} htmlFor="so-unit"><input id="so-unit" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className={inputClass} placeholder="0.00" /></Field>
      </div>
      <Field label="Target gross margin (%)" htmlFor="so-margin" hint="Used to recommend a selling price: cost per unit ÷ (1 − margin). 40% margin means $6.00 cost → $10.00 price (not a 40% markup).">
        <input id="so-margin" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} className={inputClass} placeholder="40" />
      </Field>
      {foreign && (
        <Field label={`Exchange rate (1 ${code || "unit"} = ? AUD)`} htmlFor="so-rate" hint="Optional. Only used to show an estimate in Australian dollars — your figures stay in the supplier's currency.">
          <input id="so-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} placeholder="e.g. 1.52" />
        </Field>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="Ordered" htmlFor="so-od"><input id="so-od" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={inputClass} /></Field>
        <Field label="Expected" htmlFor="so-ed"><input id="so-ed" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={inputClass} /></Field>
        <Field label="Delivered" htmlFor="so-dd"><input id="so-dd" type="date" value={deliveredDate} onChange={(e) => setDeliveredDate(e.target.value)} className={inputClass} /></Field>
      </div>
      <Field label="Notes (optional)" htmlFor="so-notes"><textarea id="so-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} rows={3} maxLength={2000} /></Field>
    </FormShell>
  );
}

// --------------------------------------------------------------------------- payment
export function SourcingPaymentForm({ recordId, currency, banks, defaultDate, initial, onSaved, onCancel }: {
  recordId: string; currency: string; banks: LedgerAccount[]; defaultDate: string; initial?: SourcingPayment; onSaved: (r: SourcingDetail) => void; onCancel: () => void;
}) {
  const [date, setDate] = useState(initial ? toInputDate(initial.date) : defaultDate);
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : "");
  const [fee, setFee] = useState(initial ? costInput(initial.feeCents) : "");
  const [type, setType] = useState<SourcingPaymentType>(initial?.type ?? "DEPOSIT");
  const [method, setMethod] = useState<SourcingPaymentMethod | "">(initial ? initial.method ?? "" : "BANK_TRANSFER");
  const [bankAccountId, setBankAccountId] = useState(initial?.bankAccount?.id ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const { saving, error, setError, run } = useSubmit();
  // Keep the saved account selectable even if it has since been deactivated.
  const paidFromOptions = banks.map((b): [string, string] => [b.id, `${b.code} · ${b.name}`]);
  if (initial?.bankAccount && !banks.some((b) => b.id === initial.bankAccount!.id)) {
    paidFromOptions.push([initial.bankAccount.id, `${initial.bankAccount.code} · ${initial.bankAccount.name} (inactive)`]);
  }

  async function submit() {
    const amountCents = toCents(amount);
    if (!amountCents) return setError("Please enter the amount paid, like 1500.00.");
    const feeCents = fee.trim() === "" ? 0 : toCents(fee);
    if (feeCents === null) return setError("Please enter the transaction fee as an amount, like 25.00.");
    await run(async () => {
      const body = { date, amountCents, feeCents, type, method: method || null, bankAccountId: bankAccountId || null, reference: blankToNull(reference), notes: blankToNull(notes) };
      onSaved(initial ? await api.put<SourcingDetail>(`${BASE}/${recordId}/payments/${initial.id}`, body) : await api.post<SourcingDetail>(`${BASE}/${recordId}/payments`, body));
    });
  }

  return (
    <FormShell onSubmit={submit} onCancel={onCancel} saving={saving} error={error} submitLabel={initial ? "Save changes" : "Record payment"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date paid" htmlFor="sp-date"><input id="sp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required /></Field>
        <Field label={`Amount (${currency})`} htmlFor="sp-amount"><input id="sp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} placeholder="0.00" required /></Field>
        <Field label="Payment for" htmlFor="sp-type">{select("sp-type", type, (v) => setType(v as SourcingPaymentType), Object.entries(PAYMENT_TYPE_LABELS))}</Field>
        <Field label="Method" htmlFor="sp-method">{select("sp-method", method, (v) => setMethod(v as SourcingPaymentMethod | ""), [["", "Not specified"], ...Object.entries(PAYMENT_METHOD_LABELS)])}</Field>
      </div>
      <Field
        label={`Transaction fee (${currency}, optional)`}
        htmlFor="sp-fee"
        hint="Any bank, card or transfer fee charged on top of this payment. It isn't part of the payment to the supplier — it's added to the total cost of this order."
      >
        <input id="sp-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={inputClass} placeholder="0.00" />
      </Field>
      <Field label="Paid from (optional)" htmlFor="sp-bank">{select("sp-bank", bankAccountId, setBankAccountId, [["", "Not specified"], ...paidFromOptions])}</Field>
      <Field label="Bank reference (optional)" htmlFor="sp-ref"><input id="sp-ref" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} maxLength={80} /></Field>
      <Field label="Notes (optional)" htmlFor="sp-notes"><input id="sp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} maxLength={1000} /></Field>
    </FormShell>
  );
}

// --------------------------------------------------------------------------- inspection
export function SourcingInspectionForm({ recordId, currency, defaultDate, initial, onSaved, onCancel }: {
  recordId: string; currency: string; defaultDate: string; initial?: SourcingInspection; onSaved: (r: SourcingDetail) => void; onCancel: () => void;
}) {
  const [date, setDate] = useState(initial ? toInputDate(initial.date) : defaultDate);
  const [inspector, setInspector] = useState(initial?.inspector ?? "");
  const [result, setResult] = useState<SourcingInspectionResult>(initial?.result ?? "PENDING");
  const [cost, setCost] = useState(initial ? costInput(initial.costCents) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const { saving, error, setError, run } = useSubmit();

  async function submit() {
    const costCents = cost.trim() === "" ? 0 : toCents(cost);
    if (costCents === null) return setError("Please enter the inspection cost as an amount, like 250.00.");
    await run(async () => {
      const body = { date, inspector: blankToNull(inspector), result, costCents, notes: blankToNull(notes) };
      onSaved(initial ? await api.put<SourcingDetail>(`${BASE}/${recordId}/inspections/${initial.id}`, body) : await api.post<SourcingDetail>(`${BASE}/${recordId}/inspections`, body));
    });
  }

  return (
    <FormShell onSubmit={submit} onCancel={onCancel} saving={saving} error={error} submitLabel={initial ? "Save changes" : "Add inspection"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Inspection date" htmlFor="si-date"><input id="si-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required /></Field>
        <Field label={`Inspection cost (${currency})`} htmlFor="si-cost"><input id="si-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass} placeholder="0.00" /></Field>
        <Field label="Inspector / agency (optional)" htmlFor="si-inspector"><input id="si-inspector" value={inspector} onChange={(e) => setInspector(e.target.value)} className={inputClass} maxLength={150} /></Field>
        <Field label="Result" htmlFor="si-result">{select("si-result", result, (v) => setResult(v as SourcingInspectionResult), Object.entries(INSPECTION_RESULT_LABELS))}</Field>
      </div>
      <Field label="Notes (optional)" htmlFor="si-notes"><textarea id="si-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} rows={3} maxLength={2000} /></Field>
    </FormShell>
  );
}

// --------------------------------------------------------------------------- shipment
export function SourcingShipmentForm({ recordId, currency, initial, onSaved, onCancel }: {
  recordId: string; currency: string; initial?: SourcingShipment; onSaved: (r: SourcingDetail) => void; onCancel: () => void;
}) {
  const [method, setMethod] = useState<SourcingShipmentMethod | "">(initial ? initial.method ?? "" : "SEA");
  const [carrier, setCarrier] = useState(initial?.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(initial?.trackingNumber ?? "");
  const [shippedDate, setShippedDate] = useState(toInputDate(initial?.shippedDate));
  const [eta, setEta] = useState(toInputDate(initial?.eta));
  const [arrivedDate, setArrivedDate] = useState(toInputDate(initial?.arrivedDate));
  const [freight, setFreight] = useState(initial ? costInput(initial.freightCostCents) : "");
  const [customs, setCustoms] = useState(initial ? costInput(initial.customsDutyCents) : "");
  const [insurance, setInsurance] = useState(initial ? costInput(initial.insuranceCostCents) : "");
  const [other, setOther] = useState(initial ? costInput(initial.otherCostCents) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const { saving, error, setError, run } = useSubmit();

  async function submit() {
    const amounts = [freight, customs, insurance, other].map((v) => (v.trim() === "" ? 0 : toCents(v)));
    if (amounts.some((a) => a === null)) return setError("Please enter each cost as an amount, like 480.00.");
    const [freightCostCents, customsDutyCents, insuranceCostCents, otherCostCents] = amounts as number[];
    await run(async () => {
      const body = {
        method: method || null, carrier: blankToNull(carrier), trackingNumber: blankToNull(trackingNumber),
        shippedDate: blankToNull(shippedDate), eta: blankToNull(eta), arrivedDate: blankToNull(arrivedDate),
        freightCostCents, customsDutyCents, insuranceCostCents, otherCostCents, notes: blankToNull(notes),
      };
      onSaved(initial ? await api.put<SourcingDetail>(`${BASE}/${recordId}/shipments/${initial.id}`, body) : await api.post<SourcingDetail>(`${BASE}/${recordId}/shipments`, body));
    });
  }

  return (
    <FormShell onSubmit={submit} onCancel={onCancel} saving={saving} error={error} submitLabel={initial ? "Save changes" : "Add shipment"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shipping method" htmlFor="ss-method">{select("ss-method", method, (v) => setMethod(v as SourcingShipmentMethod | ""), [["", "Not specified"], ...Object.entries(SHIPMENT_METHOD_LABELS)])}</Field>
        <Field label="Carrier (optional)" htmlFor="ss-carrier"><input id="ss-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className={inputClass} maxLength={120} /></Field>
      </div>
      <Field label="Tracking number (optional)" htmlFor="ss-track"><input id="ss-track" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className={inputClass} maxLength={80} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Shipped" htmlFor="ss-sd"><input id="ss-sd" type="date" value={shippedDate} onChange={(e) => setShippedDate(e.target.value)} className={inputClass} /></Field>
        <Field label="ETA" htmlFor="ss-eta"><input id="ss-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} className={inputClass} /></Field>
        <Field label="Arrived" htmlFor="ss-ad"><input id="ss-ad" type="date" value={arrivedDate} onChange={(e) => setArrivedDate(e.target.value)} className={inputClass} /></Field>
      </div>
      <p className="text-sm font-semibold text-[var(--color-ink)] pt-2">Costs ({currency})</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Freight" htmlFor="ss-freight"><input id="ss-freight" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} className={inputClass} placeholder="0.00" /></Field>
        <Field label="Customs / duty" htmlFor="ss-customs"><input id="ss-customs" inputMode="decimal" value={customs} onChange={(e) => setCustoms(e.target.value)} className={inputClass} placeholder="0.00" /></Field>
        <Field label="Insurance" htmlFor="ss-ins"><input id="ss-ins" inputMode="decimal" value={insurance} onChange={(e) => setInsurance(e.target.value)} className={inputClass} placeholder="0.00" /></Field>
        <Field label="Other" htmlFor="ss-other"><input id="ss-other" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} className={inputClass} placeholder="0.00" /></Field>
      </div>
      <Field label="Notes (optional)" htmlFor="ss-notes"><textarea id="ss-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} rows={2} maxLength={2000} /></Field>
    </FormShell>
  );
}
