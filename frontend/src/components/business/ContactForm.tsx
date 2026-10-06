import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { Contact, ContactPerson, ContactType, DuplicateMatch } from "../../api/businessTypes";
import { Button, Field, inputClass } from "../ui";
import { CONTACT_TYPE_LABELS, CONTACT_TYPE_ORDER } from "../../lib/contacts";

const BASE = "/business/contacts";
export type SavedContact = Contact & { people: ContactPerson[] };

const blank = (v: string) => (v.trim() === "" ? null : v.trim());

/**
 * Add or edit a contact (a business). When adding, the main person can be named right here; more people are added
 * on the contact's page. If the business looks like one that already exists, the person is shown it and chooses —
 * a duplicate is never created silently.
 */
export function ContactForm({ initial, defaultTypes, defaultName, onSaved, onCancel, onUseExisting }: {
  initial?: Contact;
  defaultTypes?: ContactType[];
  defaultName?: string;
  onSaved: (c: SavedContact) => void;
  onCancel: () => void;
  /** Called when the person chooses an existing contact from a duplicate warning. */
  onUseExisting?: (id: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? defaultName ?? "");
  const [types, setTypes] = useState<ContactType[]>(initial?.types ?? defaultTypes ?? []);
  const [personName, setPersonName] = useState("");
  const [personRole, setPersonRole] = useState("");
  const [f, setF] = useState({
    email: initial?.email ?? "", phone: initial?.phone ?? "", mobile: initial?.mobile ?? "", whatsapp: initial?.whatsapp ?? "", wechat: initial?.wechat ?? "", otherContact: initial?.otherContact ?? "",
    country: initial?.country ?? "", state: initial?.state ?? "", city: initial?.city ?? "", address: initial?.address ?? "", website: initial?.website ?? "",
    abn: initial?.abn ?? "", registrationNumber: initial?.registrationNumber ?? "", taxNumber: initial?.taxNumber ?? "", paymentTerms: initial?.paymentTerms ?? "", currency: initial?.currency ?? "", notes: initial?.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);

  const toggle = (t: ContactType) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  async function submit(allowDuplicate = false) {
    if (!name.trim()) return setError("Please enter the business name.");
    if (types.length === 0) return setError("Please choose at least one contact type.");
    setSaving(true);
    setError(null);
    setDuplicates([]);
    try {
      const body = {
        name: name.trim(), types,
        country: blank(f.country), state: blank(f.state), city: blank(f.city), address: blank(f.address), website: blank(f.website),
        email: blank(f.email), phone: blank(f.phone), mobile: blank(f.mobile), whatsapp: blank(f.whatsapp), wechat: blank(f.wechat), otherContact: blank(f.otherContact),
        abn: blank(f.abn), registrationNumber: blank(f.registrationNumber), taxNumber: blank(f.taxNumber), paymentTerms: blank(f.paymentTerms), currency: blank(f.currency), notes: blank(f.notes),
        ...(initial ? {} : { person: personName.trim() ? { name: personName.trim(), role: blank(personRole) } : null }),
        allowDuplicate,
      };
      onSaved(initial ? await api.put<SavedContact>(`${BASE}/${initial.id}`, body) : await api.post<SavedContact>(BASE, body));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.data.duplicates)) {
        setDuplicates(err.data.duplicates as DuplicateMatch[]);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "We couldn't save that. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(); }} className="space-y-4">
      <Field label="Business / company name" htmlFor="ct-name">
        <input id="ct-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={150} required autoFocus />
      </Field>

      <fieldset>
        <legend className="block text-sm font-medium text-[var(--color-ink)] mb-1">Type <span className="font-normal text-[var(--color-ink-soft)]">— choose every one that applies</span></legend>
        <div className="flex flex-wrap gap-2">
          {CONTACT_TYPE_ORDER.map((t) => (
            <label key={t} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm select-none ${types.includes(t) ? "border-[var(--color-eucalyptus)] bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)] font-medium" : "border-[var(--color-line)] text-[var(--color-ink-soft)]"}`}>
              <input type="checkbox" className="sr-only" checked={types.includes(t)} onChange={() => toggle(t)} />
              {CONTACT_TYPE_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>

      {!initial && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person (optional)" htmlFor="ct-person"><input id="ct-person" className={inputClass} value={personName} onChange={(e) => setPersonName(e.target.value)} maxLength={120} /></Field>
          <Field label="Position / role" htmlFor="ct-role"><input id="ct-role" className={inputClass} value={personRole} onChange={(e) => setPersonRole(e.target.value)} maxLength={120} placeholder="e.g. Sales" /></Field>
        </div>
      )}

      <p className="text-sm font-semibold text-[var(--color-ink)] pt-1">How to reach them</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Email" htmlFor="ct-email"><input id="ct-email" type="email" className={inputClass} value={f.email} onChange={set("email")} maxLength={200} /></Field>
        <Field label="Phone" htmlFor="ct-phone"><input id="ct-phone" type="tel" className={inputClass} value={f.phone} onChange={set("phone")} maxLength={40} placeholder="+86 …" /></Field>
        <Field label="Mobile" htmlFor="ct-mobile"><input id="ct-mobile" type="tel" className={inputClass} value={f.mobile} onChange={set("mobile")} maxLength={40} /></Field>
        <Field label="WhatsApp" htmlFor="ct-wa"><input id="ct-wa" className={inputClass} value={f.whatsapp} onChange={set("whatsapp")} maxLength={60} placeholder="Number with country code" /></Field>
        <Field label="WeChat" htmlFor="ct-wechat"><input id="ct-wechat" className={inputClass} value={f.wechat} onChange={set("wechat")} maxLength={60} /></Field>
        <Field label="Other (Skype, Line…)" htmlFor="ct-other"><input id="ct-other" className={inputClass} value={f.otherContact} onChange={set("otherContact")} maxLength={200} /></Field>
      </div>

      <p className="text-sm font-semibold text-[var(--color-ink)] pt-1">Where they are</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Country" htmlFor="ct-country"><input id="ct-country" className={inputClass} value={f.country} onChange={set("country")} maxLength={80} /></Field>
        <Field label="State / province" htmlFor="ct-state"><input id="ct-state" className={inputClass} value={f.state} onChange={set("state")} maxLength={80} /></Field>
        <Field label="City" htmlFor="ct-city"><input id="ct-city" className={inputClass} value={f.city} onChange={set("city")} maxLength={80} /></Field>
        <Field label="Website" htmlFor="ct-web"><input id="ct-web" className={inputClass} value={f.website} onChange={set("website")} maxLength={200} placeholder="www.example.com" /></Field>
      </div>
      <Field label="Address" htmlFor="ct-address"><input id="ct-address" className={inputClass} value={f.address} onChange={set("address")} maxLength={300} /></Field>

      <details className="rounded-xl border border-[var(--color-line)] px-4 py-3" open={!!(initial && (initial.abn || initial.registrationNumber || initial.taxNumber || initial.paymentTerms || initial.currency))}>
        <summary className="cursor-pointer text-sm font-semibold text-[var(--color-ink)]">Business details (optional)</summary>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Field label="ABN" htmlFor="ct-abn"><input id="ct-abn" inputMode="numeric" className={inputClass} value={f.abn} onChange={set("abn")} maxLength={20} /></Field>
          <Field label="Business registration number" htmlFor="ct-reg"><input id="ct-reg" className={inputClass} value={f.registrationNumber} onChange={set("registrationNumber")} maxLength={60} /></Field>
          <Field label="Tax / VAT / GST number" htmlFor="ct-tax"><input id="ct-tax" className={inputClass} value={f.taxNumber} onChange={set("taxNumber")} maxLength={60} /></Field>
          <Field label="Usual currency" htmlFor="ct-cur"><input id="ct-cur" className={inputClass} value={f.currency} onChange={set("currency")} maxLength={3} placeholder="e.g. USD" /></Field>
        </div>
        <div className="mt-3"><Field label="Payment terms" htmlFor="ct-terms"><input id="ct-terms" className={inputClass} value={f.paymentTerms} onChange={set("paymentTerms")} maxLength={120} placeholder="e.g. 30% deposit, 70% before shipping" /></Field></div>
      </details>

      <Field label="Notes (optional)" htmlFor="ct-notes"><textarea id="ct-notes" className={inputClass} rows={3} value={f.notes} onChange={set("notes")} maxLength={2000} /></Field>

      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}
      {duplicates.length > 0 && (
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper-dim)] p-3 space-y-2">
          {duplicates.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{d.name}{d.isArchived ? " (archived)" : ""} <span className="text-[var(--color-ink-soft)]">· {d.match === "same" ? "same name" : "similar name"}</span></span>
              {onUseExisting && <Button size="sm" variant="secondary" onClick={() => onUseExisting(d.id)}>Use this one</Button>}
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => void submit(true)}>No, save as a separate contact</Button>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : initial ? "Save changes" : "Add contact"}</Button>
      </div>
    </form>
  );
}
