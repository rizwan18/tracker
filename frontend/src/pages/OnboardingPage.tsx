import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import type { PortfolioType } from "../api/types";
import { usePortfolio } from "../context/PortfolioContext";
import { Button, Field, inputClass } from "../components/ui";
import { PORTFOLIO_TYPES, PORTFOLIO_TYPE_INFO, defaultPortfolioName } from "../lib/portfolioType";

const TRACK_OPTIONS = [
  { id: "property", label: "Property" },
  { id: "shares", label: "Shares & ETFs" },
  { id: "other", label: "Other investments" },
  { id: "bills", label: "Household bills" },
  { id: "income", label: "Income & expenses" },
];

/** First-run setup: choose the type(s) of portfolio to start with, then what to track. */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const { setup } = usePortfolio();
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — portfolio types (one or more)
  const [chosen, setChosen] = useState<PortfolioType[]>(["PERSONAL"]);
  const [names, setNames] = useState<Partial<Record<PortfolioType, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Step 2 — what to track
  const [selected, setSelected] = useState<string[]>([]);

  function toggleType(t: PortfolioType) {
    setChosen((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : PORTFOLIO_TYPES.filter((x) => x === t || prev.includes(x))));
  }

  const nameFor = (t: PortfolioType) => names[t] ?? (t === "OTHER" ? "" : defaultPortfolioName(t));

  async function continueFromTypes() {
    setError(null);
    if (chosen.length === 0) return setError("Please choose at least one type of portfolio.");
    const blank = chosen.find((t) => !nameFor(t).trim());
    if (blank) return setError(`Please give your “${PORTFOLIO_TYPE_INFO[blank].label}” portfolio a name.`);
    setSaving(true);
    try {
      await setup(chosen.map((type) => ({ type, name: nameFor(type).trim() })));
      setStep(2);
    } catch (err) {
      // Already set up (e.g. this page was opened again) — nothing to change, carry on.
      if (err instanceof ApiError && err.status === 409) setStep(2);
      else setError(err instanceof ApiError ? err.message : "We couldn't set up your portfolios. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function finish() {
    // With more than one portfolio the selection page appears before the dashboard.
    navigate("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)] px-4 py-10">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-[var(--color-line)] p-8">
        {step === 1 ? (
          <>
            <h1 className="font-display text-2xl font-semibold text-[var(--color-ink)] mb-1">What would you like to set up?</h1>
            <p className="text-[var(--color-ink-soft)] mb-1">Choose the type of portfolio you want. You can pick more than one.</p>
            <p className="text-sm text-[var(--color-ink-soft)] mb-6">If you set up more than one, you'll choose which to open each time you sign in. Each keeps its own records.</p>

            {error && (
              <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2 mb-4">
                {error}
              </p>
            )}

            <div className="space-y-2 mb-6">
              {PORTFOLIO_TYPES.map((t, i) => {
                const info = PORTFOLIO_TYPE_INFO[t];
                const on = chosen.includes(t);
                return (
                  <div key={t} className={`rounded-xl border-2 px-4 py-3 transition-colors ${on ? "border-[var(--color-eucalyptus)] bg-[var(--color-eucalyptus-tint)]" : "border-[var(--color-line)]"}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={on} onChange={() => toggleType(t)} className="w-5 h-5 mt-0.5 accent-[var(--color-eucalyptus)]" />
                      <span>
                        <span className="font-medium">
                          {i + 1}. <span aria-hidden>{info.icon} </span>
                          {info.label}
                        </span>
                        <span className="block text-sm text-[var(--color-ink-soft)]">{info.description}</span>
                      </span>
                    </label>
                    {on && (
                      <div className="mt-3 pl-8">
                        <Field label="Name" htmlFor={`pname-${t}`} hint={t === "OTHER" ? "e.g. “Sunday Cricket Club”" : undefined}>
                          <input id={`pname-${t}`} className={inputClass} value={nameFor(t)} onChange={(e) => setNames((prev) => ({ ...prev, [t]: e.target.value }))} />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <button onClick={() => setStep(2)} className="text-sm text-[var(--color-ink-soft)] underline">
                Skip — use Personal Finance
              </button>
              <Button onClick={continueFromTypes} disabled={saving}>
                {saving ? "Setting up…" : "Continue"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-semibold text-[var(--color-ink)] mb-1">What would you like to track?</h1>
            <p className="text-[var(--color-ink-soft)] mb-6">Choose as many as you like — you can always add more later.</p>

            <div className="space-y-2 mb-8">
              {TRACK_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                    selected.includes(opt.id) ? "border-[var(--color-eucalyptus)] bg-[var(--color-eucalyptus-tint)]" : "border-[var(--color-line)]"
                  }`}
                >
                  <input type="checkbox" checked={selected.includes(opt.id)} onChange={() => toggle(opt.id)} className="w-5 h-5 accent-[var(--color-eucalyptus)]" />
                  <span className="font-medium">{opt.label}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button onClick={finish} className="text-sm text-[var(--color-ink-soft)] underline">
                Skip for now
              </button>
              <Button onClick={finish}>Continue</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
