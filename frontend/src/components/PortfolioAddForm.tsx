import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import type { PortfolioType } from "../api/types";
import { usePortfolio } from "../context/PortfolioContext";
import { PORTFOLIO_TYPES, PORTFOLIO_TYPE_INFO, defaultPortfolioName } from "../lib/portfolioType";
import { Button, Field, inputClass } from "./ui";

/** Adds another portfolio (e.g. a company or trust alongside personal finances). */
export function PortfolioAddForm({ onAdded, onCancel }: { onAdded: (id: string) => void; onCancel: () => void }) {
  const { add } = usePortfolio();
  const [type, setType] = useState<PortfolioType | "">("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function chooseType(t: PortfolioType) {
    setType(t);
    if (!nameEdited) setName(t === "OTHER" ? "" : defaultPortfolioName(t));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!type) return setError("Please choose what kind of portfolio this is.");
    if (!name.trim()) return setError("Please give this portfolio a name.");
    setSaving(true);
    try {
      const created = await add(type, name.trim());
      onAdded(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't add this portfolio. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <fieldset>
        <legend className="block text-sm font-medium mb-1">What kind of portfolio is it?</legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {PORTFOLIO_TYPES.map((t) => {
            const info = PORTFOLIO_TYPE_INFO[t];
            const selected = type === t;
            return (
              <label
                key={t}
                className={`cursor-pointer rounded-xl border-2 p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-sky)] ${
                  selected ? "border-[var(--color-eucalyptus)] bg-[var(--color-eucalyptus-tint)]" : "border-[var(--color-line)] hover:border-[var(--color-ink-soft)]"
                }`}
              >
                <input type="radio" name="portfolio-type" value={t} checked={selected} onChange={() => chooseType(t)} className="sr-only" />
                <span className="flex items-center gap-2 font-medium">
                  <span aria-hidden>{info.icon}</span>
                  {info.label}
                </span>
                <span className="block text-xs text-[var(--color-ink-soft)] mt-1">{info.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <Field label="Portfolio name" htmlFor="portfolio-name" hint={type === "OTHER" ? "e.g. “Sunday Cricket Club”" : "You can rename it later."}>
        <input
          id="portfolio-name"
          className={inputClass}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameEdited(true);
          }}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add portfolio"}
        </Button>
      </div>
    </form>
  );
}
