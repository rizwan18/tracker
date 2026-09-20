import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Property } from "../api/types";
import { Button, Card, Field, SectionHeading, inputClass } from "./ui";
import { formatAbn } from "../lib/format";
import { propertyTypeOf } from "../lib/propertyType";

type ManagerFields = Pick<Property, "managerName" | "managerCompany" | "managerEmail" | "managerPhone" | "managerMobile" | "managerWebsite" | "managerAbn" | "managerAddress" | "managerNotes">;

const MANAGER_KEYS: Array<keyof ManagerFields> = ["managerName", "managerCompany", "managerEmail", "managerPhone", "managerMobile", "managerWebsite", "managerAbn", "managerAddress", "managerNotes"];
// Only the manager fields count — not the property's own name, address and so on.
const hasManager = (p: ManagerFields) => MANAGER_KEYS.some((k) => typeof p[k] === "string" && (p[k] as string).trim() !== "");
const summaryOf = (p: ManagerFields) => [p.managerName, p.managerCompany].filter(Boolean).join(" · ");

/**
 * Who manages the property: name, agency, contact numbers, website, ABN and office address.
 * The same manager often looks after several properties, so details can be copied in from
 * another property, or copied out to others when saving — each property keeps its own copy.
 */
export function PropertyManagerTab({ property, onSaved }: { property: Property; onSaved: () => void }) {
  // Properties set up before this tab existed may already name a "rental agent" — start from that.
  const [name, setName] = useState(property.managerName ?? property.rentalAgent ?? "");
  const [company, setCompany] = useState(property.managerCompany ?? "");
  const [email, setEmail] = useState(property.managerEmail ?? "");
  const [phone, setPhone] = useState(property.managerPhone ?? "");
  const [mobile, setMobile] = useState(property.managerMobile ?? "");
  const [website, setWebsite] = useState(property.managerWebsite ?? "");
  const [abn, setAbn] = useState(formatAbn(property.managerAbn));
  const [address, setAddress] = useState(property.managerAddress ?? "");
  const [notes, setNotes] = useState(property.managerNotes ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Other investment properties (your own home has no manager).
  const [others, setOthers] = useState<Property[]>([]);
  const [applyTo, setApplyTo] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .get<Property[]>("/properties")
      .then((list) => !cancelled && setOthers(list.filter((p) => p.id !== property.id && propertyTypeOf(p) === "INVESTMENT")))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [property.id]);
  const copySources = useMemo(() => others.filter(hasManager), [others]);

  function copyFrom(id: string) {
    const source = others.find((p) => p.id === id);
    if (!source) return;
    setName(source.managerName ?? "");
    setCompany(source.managerCompany ?? "");
    setEmail(source.managerEmail ?? "");
    setPhone(source.managerPhone ?? "");
    setMobile(source.managerMobile ?? "");
    setWebsite(source.managerWebsite ?? "");
    setAbn(formatAbn(source.managerAbn));
    setAddress(source.managerAddress ?? "");
    setNotes(source.managerNotes ?? "");
    setMessage({ ok: true, text: `Copied the manager details from ${source.name}. Check them, then save.` });
  }

  const toggle = (id: string) => setApplyTo((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const res = await api.put<{ appliedTo?: Array<{ id: string; name: string }> }>(`/properties/${property.id}/manager`, {
        managerName: name,
        managerCompany: company,
        managerEmail: email,
        managerPhone: phone,
        managerMobile: mobile,
        managerWebsite: website,
        managerAbn: abn,
        managerAddress: address,
        managerNotes: notes,
        ...(applyTo.length > 0 ? { applyToPropertyIds: applyTo } : {}),
      });
      const names = (res.appliedTo ?? []).map((p) => p.name);
      setMessage({ ok: true, text: names.length > 0 ? `Saved, and copied to ${names.join(", ")}.` : "Property manager details saved." });
      if (names.length > 0) {
        setApplyTo([]);
        // Refresh so the copy-from list shows the newly updated properties.
        api.get<Property[]>("/properties").then((list) => setOthers(list.filter((p) => p.id !== property.id && propertyTypeOf(p) === "INVESTMENT"))).catch(() => undefined);
      }
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "We couldn't save these details. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  const websiteUrl = website.trim() ? (/^[a-z][a-z0-9+.-]*:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`) : null;
  const mapsUrl = address.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}` : null;
  const digits = (v: string) => v.replace(/[^\d+]/g, "");
  const links = [
    email.trim() && { label: "Email", href: `mailto:${email.trim()}`, icon: "✉️" },
    phone.trim() && { label: "Call office", href: `tel:${digits(phone)}`, icon: "📞" },
    mobile.trim() && { label: "Call mobile", href: `tel:${digits(mobile)}`, icon: "📱" },
    websiteUrl && { label: "Website", href: websiteUrl, icon: "🌐", external: true },
    mapsUrl && { label: "Office on map", href: mapsUrl, icon: "📍", external: true },
  ].filter(Boolean) as Array<{ label: string; href: string; icon: string; external?: boolean }>;

  return (
    <section>
      <SectionHeading title="Property manager" subtitle="The agent or agency who manages this property for you." />
      <Card>
        <form onSubmit={submit} className="space-y-4 max-w-2xl">
          {copySources.length > 0 && (
            <Field label="Copy details from another property" htmlFor="pm-copy" hint="Same manager on more than one property? Pick one to fill in this form, then save.">
              <select
                id="pm-copy"
                className={inputClass}
                value=""
                onChange={(e) => {
                  copyFrom(e.target.value);
                  e.target.value = "";
                }}
              >
                <option value="">Choose a property…</option>
                {copySources.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {summaryOf(p) || "manager details"}
                  </option>
                ))}
              </select>
            </Field>
          )}

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
            <Field label="Office website" htmlFor="pm-website">
              <input id="pm-website" inputMode="url" className={inputClass} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="www.youragency.com.au" autoComplete="off" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Office phone" htmlFor="pm-phone">
              <input id="pm-phone" type="tel" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Mobile number" htmlFor="pm-mobile">
              <input id="pm-mobile" type="tel" className={inputClass} value={mobile} onChange={(e) => setMobile(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field label="ABN" htmlFor="pm-abn" hint="The agency's 11-digit Australian Business Number. Optional.">
            <input id="pm-abn" inputMode="numeric" className={inputClass} value={abn} onChange={(e) => setAbn(e.target.value)} placeholder="12 345 678 901" autoComplete="off" />
          </Field>
          <Field label="Office address" htmlFor="pm-address">
            <textarea id="pm-address" rows={2} className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, suburb, state, postcode" />
          </Field>
          <Field label="Notes" htmlFor="pm-notes" hint="Optional — for example office hours, fees, or who to ask for.">
            <textarea id="pm-notes" rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {others.length > 0 && (
            <details className="rounded-xl border border-[var(--color-line)]">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
                Also use these details for other properties{applyTo.length > 0 ? ` (${applyTo.length} selected)` : ""}
              </summary>
              <div className="px-4 pb-4 space-y-2">
                <p className="text-xs text-[var(--color-ink-soft)]">Tick the properties this manager also looks after. When you save, they each get a copy of these details.</p>
                <div className="flex gap-3 text-xs">
                  <button type="button" onClick={() => setApplyTo(others.map((p) => p.id))} className="text-[var(--color-sky)] hover:underline">
                    Select all
                  </button>
                  <button type="button" onClick={() => setApplyTo([])} className="text-[var(--color-sky)] hover:underline">
                    Clear
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {others.map((p) => (
                    <li key={p.id}>
                      <label className="flex items-start gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={applyTo.includes(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4 mt-0.5 accent-[var(--color-eucalyptus)]" />
                        <span>
                          {p.name}
                          {hasManager(p) && <span className="block text-xs text-[var(--color-ochre)]">Already has manager details — they'll be replaced</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}

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
              {saving ? "Saving…" : applyTo.length > 0 ? `Save and copy to ${applyTo.length} ${applyTo.length === 1 ? "property" : "properties"}` : "Save details"}
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
