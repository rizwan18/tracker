import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import type { Property } from "../api/types";
import { Button, Field, inputClass } from "./ui";
import { toInputDate } from "../lib/format";
import { PROPERTY_TYPE_INFO, type PropertyType } from "../lib/propertyType";

export function PropertyForm({ initial, onSaved, onCancel }: { initial?: Property; onSaved: () => void; onCancel: () => void }) {
  // A principal place of residence only exists in a Personal Finance portfolio; companies,
  // trusts and other portfolios just hold investment properties, so the question isn't asked there.
  const { active } = usePortfolio();
  const allowPpr = !active || active.type === "PERSONAL";
  // New properties start with nothing selected so the question is always answered on purpose.
  const [propertyType, setPropertyType] = useState<PropertyType | "">(initial ? (initial.propertyType === "PPR" ? "PPR" : "INVESTMENT") : allowPpr ? "" : "INVESTMENT");
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [purchaseDate, setPurchaseDate] = useState(toInputDate(initial?.purchaseDate));
  const [purchasePrice, setPurchasePrice] = useState(initial?.purchasePrice != null ? String(initial.purchasePrice) : "");
  const [currentEstimatedValue, setCurrentEstimatedValue] = useState(initial?.currentEstimatedValue != null ? String(initial.currentEstimatedValue) : "");
  const [loanBalance, setLoanBalance] = useState(initial?.loanBalance != null ? String(initial.loanBalance) : "");
  const [rentAmount, setRentAmount] = useState(initial?.rentAmount != null ? String(initial.rentAmount) : "");
  const [rentFrequency, setRentFrequency] = useState(initial?.rentFrequency ?? "WEEKLY");
  const [rentalAgent, setRentalAgent] = useState(initial?.rentalAgent ?? "");
  const [tenantName, setTenantName] = useState(initial?.tenantName ?? "");
  const { user } = useAuth();
  // Business rule: a person can only have one principal place of residence.
  const [existingPpr, setExistingPpr] = useState<Property | null>(null);
  const [showMore, setShowMore] = useState(!!initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isPpr = propertyType === "PPR";

  useEffect(() => {
    let cancelled = false;
    api
      .get<Property[]>("/properties")
      .then((list) => {
        if (cancelled) return;
        const other = list.find((p) => p.propertyType === "PPR" && p.id !== initial?.id && p.owners?.some((o) => o.userId === user?.id)) ?? null;
        setExistingPpr(other);
        // If PPR was picked before this loaded, undo it — the server would refuse it anyway.
        if (other) setPropertyType((current) => (current === "PPR" && !initial ? "" : current));
      })
      .catch(() => {
        /* the server enforces the rule regardless */
      });
    return () => {
      cancelled = true;
    };
  }, [initial, user?.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!propertyType) return setError("Please choose whether this is an investment property or your principal place of residence (PPR).");
    if (!name.trim()) return setError("Please give this property a name.");

    setSaving(true);
    try {
      const payload = {
        name,
        propertyType,
        address: address || null,
        purchaseDate: purchaseDate || null,
        purchasePrice: purchasePrice ? Number(purchasePrice) : null,
        currentEstimatedValue: currentEstimatedValue ? Number(currentEstimatedValue) : null,
        loanBalance: loanBalance ? Number(loanBalance) : null,
        // A principal place of residence isn't rented out.
        rentAmount: isPpr ? null : rentAmount ? Number(rentAmount) : null,
        rentFrequency: isPpr ? null : rentAmount ? rentFrequency : null,
        rentalAgent: isPpr ? null : rentalAgent || null,
        tenantName: isPpr ? null : tenantName || null,
      };
      if (initial) {
        await api.put(`/properties/${initial.id}`, payload);
      } else {
        await api.post("/properties", payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? err.message : "We couldn't save this property. Please check the details and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{error}</p>}

      {allowPpr && (
      <fieldset>
        <legend className="block text-sm font-medium text-[var(--color-ink)] mb-1">What kind of property is this?</legend>
        <div className="grid sm:grid-cols-2 gap-3">
          {(["INVESTMENT", "PPR"] as const).map((t) => {
            const info = PROPERTY_TYPE_INFO[t];
            const selected = propertyType === t;
            const blocked = t === "PPR" && !!existingPpr;
            return (
              <label
                key={t}
                className={`rounded-xl border-2 p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-sky)] ${
                  blocked ? "cursor-not-allowed opacity-60 border-[var(--color-line)]" : selected ? `cursor-pointer ${info.selected}` : "cursor-pointer border-[var(--color-line)] hover:border-[var(--color-ink-soft)]"
                }`}
              >
                <input type="radio" name="property-type" value={t} checked={selected} disabled={blocked} onChange={() => setPropertyType(t)} className="sr-only" />
                <span className="flex items-center gap-2 font-medium text-[var(--color-ink)]">
                  <span aria-hidden className={`w-2.5 h-2.5 rounded-full ${info.dot}`} />
                  {info.label}
                </span>
                <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                  {blocked ? `You already have a PPR (“${existingPpr!.name}”). A person can only have one.` : info.description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      )}

      <Field label="Property name" htmlFor="p-name" hint={isPpr ? "e.g. “Family home” — just for your own reference." : "e.g. “Smith Street rental” — just for your own reference."}>
        <input id="p-name" required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Address (optional)" htmlFor="p-address">
        <input id="p-address" className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>

      {!showMore && (
        <button type="button" onClick={() => setShowMore(true)} className="text-sm text-[var(--color-eucalyptus)] font-medium">
          {isPpr ? "+ Add value and loan details (optional)" : "+ Add rent, value and loan details (optional)"}
        </button>
      )}

      {showMore && (
        <div className="space-y-4 border-t border-[var(--color-line)] pt-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase date" htmlFor="p-purchase-date">
              <input id="p-purchase-date" type="date" className={inputClass} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </Field>
            <Field label="Purchase price" htmlFor="p-purchase-price">
              <input id="p-purchase-price" type="number" min="0" className={inputClass} value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
            </Field>
            <Field label="Current estimated value" htmlFor="p-value">
              <input id="p-value" type="number" min="0" className={inputClass} value={currentEstimatedValue} onChange={(e) => setCurrentEstimatedValue(e.target.value)} />
            </Field>
            <Field label="Loan balance" htmlFor="p-loan">
              <input id="p-loan" type="number" min="0" className={inputClass} value={loanBalance} onChange={(e) => setLoanBalance(e.target.value)} />
            </Field>
          </div>

          {!isPpr && (
            <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rent amount" htmlFor="p-rent">
              <input id="p-rent" type="number" min="0" className={inputClass} value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} />
            </Field>
            <Field label="Rent frequency" htmlFor="p-rent-freq">
              <select id="p-rent-freq" className={inputClass} value={rentFrequency} onChange={(e) => setRentFrequency(e.target.value)}>
                <option value="WEEKLY">Weekly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rental agent (optional)" htmlFor="p-agent">
              <input id="p-agent" className={inputClass} value={rentalAgent} onChange={(e) => setRentalAgent(e.target.value)} />
            </Field>
            <Field label="Tenant name (optional)" htmlFor="p-tenant">
              <input id="p-tenant" className={inputClass} value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
            </Field>
          </div>
            </>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add property"}
        </Button>
      </div>
    </form>
  );
}
