import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { BusinessProfile } from "../../api/businessTypes";
import { Button, Card, Field, inputClass } from "../ui";

const ENTITY_LABELS: Record<BusinessProfile["entityType"], string> = {
  COMPANY: "Company (Pty Ltd)",
  SOLE_TRADER: "Sole trader",
  PARTNERSHIP: "Partnership",
  TRUST: "Trust",
};

/** Business name, ABN and GST settings for a Company Finance portfolio. */
export function BusinessProfileCard() {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [abn, setAbn] = useState("");
  const [entityType, setEntityType] = useState<BusinessProfile["entityType"]>("COMPANY");
  const [gstRegistered, setGstRegistered] = useState(false);
  const [gstBasis, setGstBasis] = useState<BusinessProfile["gstBasis"]>("ACCRUAL");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function fill(p: BusinessProfile) {
    setProfile(p);
    setBusinessName(p.businessName);
    setAbn(p.abnFormatted ?? p.abn ?? "");
    setEntityType(p.entityType);
    setGstRegistered(p.gstRegistered);
    setGstBasis(p.gstBasis);
  }

  useEffect(() => {
    api.get<BusinessProfile>("/business/profile").then(fill).catch(() => setMessage({ ok: false, text: "We couldn't load your business details." }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      fill(await api.put<BusinessProfile>("/business/profile", { businessName, abn: abn.trim() || null, entityType, gstRegistered, gstBasis }));
      setMessage({ ok: true, text: "Business details saved." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "We couldn't save your business details." });
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <Card><p className="text-sm text-[var(--color-ink-soft)]">Loading business details…</p></Card>;

  return (
    <Card>
      <h3 className="font-display font-semibold">Business details</h3>
      <p className="text-sm text-[var(--color-ink-soft)] mt-1 mb-4">Used on your reports and to work out GST correctly.</p>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Business name" htmlFor="bp-name">
            <input id="bp-name" className={inputClass} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </Field>
          <Field label="ABN" htmlFor="bp-abn" hint="11 digits. Optional.">
            <input id="bp-abn" className={inputClass} value={abn} onChange={(e) => setAbn(e.target.value)} placeholder="12 345 678 901" />
          </Field>
        </div>
        <Field label="Business structure" htmlFor="bp-entity">
          <select id="bp-entity" className={inputClass} value={entityType} onChange={(e) => setEntityType(e.target.value as BusinessProfile["entityType"])}>
            {(Object.keys(ENTITY_LABELS) as Array<BusinessProfile["entityType"]>).map((k) => (
              <option key={k} value={k}>
                {ENTITY_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={gstRegistered} onChange={(e) => setGstRegistered(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[var(--color-eucalyptus)]" />
          <span>
            The business is registered for GST
            <span className="block text-xs text-[var(--color-ink-soft)]">Required once turnover reaches $75,000 a year. When ticked, GST is worked out on sales and purchases.</span>
          </span>
        </label>
        {gstRegistered && (
          <Field label="GST reporting basis" htmlFor="bp-basis" hint="Cash: GST is counted when money is received or paid. Accrual: when invoices and bills are dated.">
            <select id="bp-basis" className={inputClass} value={gstBasis} onChange={(e) => setGstBasis(e.target.value as BusinessProfile["gstBasis"])}>
              <option value="ACCRUAL">Accrual (invoice date)</option>
              <option value="CASH">Cash (payment date)</option>
            </select>
          </Field>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save business details"}
          </Button>
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-[var(--color-eucalyptus-dark)]" : "text-[var(--color-brick)]"}`}>
              {message.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
