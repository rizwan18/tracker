import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Property } from "../api/types";
import { Button, Card, Field, SectionHeading, inputClass } from "./ui";

/** Who manages the property: name, company, email, phone and office address, with one-tap contact links. */
export function PropertyManagerTab({ property, onSaved }: { property: Property; onSaved: () => void }) {
  // Properties set up before this tab existed may already name a "rental agent" — start from that.
  const [name, setName] = useState(property.managerName ?? property.rentalAgent ?? "");
  const [company, setCompany] = useState(property.managerCompany ?? "");
  const [email, setEmail] = useState(property.managerEmail ?? "");
  const [phone, setPhone] = useState(property.managerPhone ?? "");
  const [address, setAddress] = useState(property.managerAddress ?? "");
  const [notes, setNotes] = useState(property.managerNotes ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      await api.put(`/properties/${property.id}/manager`, {
        managerName: name,
        managerCompany: company,
        managerEmail: email,
        managerPhone: phone,
        managerAddress: address,
        managerNotes: notes,
      });
      setMessage({ ok: true, text: "Property manager details saved." });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "We couldn't save these details. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  const mapsUrl = address.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}` : null;
  const links = [
    email.trim() && { label: "Email", href: `mailto:${email.trim()}`, icon: "✉️" },
    phone.trim() && { label: "Call", href: `tel:${phone.replace(/[^\d+]/g, "")}`, icon: "📞" },
    mapsUrl && { label: "Office on map", href: mapsUrl, icon: "📍", external: true },
  ].filter(Boolean) as Array<{ label: string; href: string; icon: string; external?: boolean }>;

  return (
    <section>
      <SectionHeading title="Property manager" subtitle="The agent or agency who manages this property for you." />
      <Card>
        <form onSubmit={submit} className="space-y-4 max-w-2xl">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Manager's name" htmlFor="pm-name">
              <input id="pm-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Agency / company" htmlFor="pm-company">
              <input id="pm-company" className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Email" htmlFor="pm-email">
              <input id="pm-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Phone" htmlFor="pm-phone">
              <input id="pm-phone" type="tel" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field label="Office address" htmlFor="pm-address">
            <textarea id="pm-address" rows={2} className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, suburb, state, postcode" />
          </Field>
          <Field label="Notes" htmlFor="pm-notes" hint="Optional — for example office hours, fees, or who to ask for.">
            <textarea id="pm-notes" rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {links.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Contact shortcuts">
              {links.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-paper-dim)] px-3 py-1.5 text-sm font-medium hover:brightness-95"
                >
                  <span aria-hidden>{l.icon}</span>
                  {l.label}
                </a>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </Button>
            {message && (
              <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-[var(--color-eucalyptus-dark)]" : "text-[var(--color-brick)]"}`}>
                {message.text}
              </p>
            )}
          </div>
        </form>
      </Card>
    </section>
  );
}
