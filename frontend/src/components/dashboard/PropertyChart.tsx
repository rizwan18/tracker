import { Link } from "react-router-dom";
import type { DashboardResponse } from "../../api/types";
import { formatCurrency } from "../../lib/format";
import { PROPERTY_TYPE_INFO, propertyTypeOf, type PropertyType } from "../../lib/propertyType";
import { PropertyTypeBadge, PropertyTypeLegend } from "../PropertyTypeBadge";

type PropertyRow = DashboardResponse["properties"][number];

// The bar colour matches the property's type (green = investment, blue = PPR).
const BAR: Record<PropertyType, string> = {
  INVESTMENT: "var(--color-eucalyptus)",
  PPR: "var(--color-sky)",
};

/** Hatching for the "owed" part of a bar, in the same colour as the property type. */
const hatched = (colour: string) => `repeating-linear-gradient(135deg, ${colour} 0 3px, transparent 3px 7px)`;

export function propertyChartRows(properties: PropertyRow[]) {
  return properties
    .map((p) => {
      const value = p.currentEstimatedValue ?? 0;
      const loan = Math.min(p.loanBalance ?? 0, value);
      return { ...p, type: propertyTypeOf(p), value, loan, equity: value - loan, owedShare: value > 0 ? Math.round((loan / value) * 100) : 0, loanExceedsValue: (p.loanBalance ?? 0) > value && value > 0 };
    })
    .sort((a, b) => b.value - a.value);
}

/**
 * Property snapshot as a graph: one bar per property, as long as the property is valuable.
 * The solid part is what you own (equity), the hatched part is what you owe (loan).
 */
export function PropertyChart({ properties }: { properties: PropertyRow[] }) {
  const rows = propertyChartRows(properties);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalLoan = rows.reduce((s, r) => s + r.loan, 0);
  const totalEquity = totalValue - totalLoan;
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div>
      <dl className="grid grid-cols-3 gap-3 mb-5">
        <div>
          <dt className="text-xs text-[var(--color-ink-soft)]">Total value</dt>
          <dd className="font-display text-xl font-semibold">{formatCurrency(totalValue)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-ink-soft)]">You owe</dt>
          <dd className="font-display text-xl font-semibold text-[var(--color-brick)]">{formatCurrency(totalLoan)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-ink-soft)]">You own</dt>
          <dd className="font-display text-xl font-semibold text-[var(--color-eucalyptus)]">{formatCurrency(totalEquity)}</dd>
        </div>
      </dl>

      <ul
        className="space-y-4"
        aria-label={`Property values. ${rows.map((r) => `${r.name}: worth ${formatCurrency(r.value)}, you own ${formatCurrency(r.equity)}, you owe ${formatCurrency(r.loan)}`).join("; ")}`}
      >
        {rows.map((r) => {
          const colour = BAR[r.type];
          const widthPct = r.value > 0 ? Math.max(6, (r.value / max) * 100) : 0;
          return (
            <li key={r.id}>
              <Link to={`/properties/${r.id}`} className="block group rounded-lg -mx-2 px-2 py-1 hover:bg-[var(--color-paper-dim)] focus-visible:outline-2 focus-visible:outline-[var(--color-sky)]">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">{r.name}</span>
                    <PropertyTypeBadge type={r.type} />
                  </span>
                  <span className="text-sm font-medium shrink-0">{r.value > 0 ? formatCurrency(r.value) : "No value yet"}</span>
                </div>
                {r.value > 0 ? (
                  <>
                    <div className="h-4 rounded-full bg-[var(--color-paper-dim)] overflow-hidden">
                      <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${widthPct}%` }} aria-hidden>
                        <div style={{ width: `${(r.equity / r.value) * 100}%`, background: colour }} />
                        <div style={{ width: `${(r.loan / r.value) * 100}%`, background: hatched(colour), boxShadow: `inset 0 0 0 1px ${colour}` }} />
                      </div>
                    </div>
                    <p className="text-xs text-[var(--color-ink-soft)] mt-1">
                      You own {formatCurrency(r.equity)}
                      {r.loan > 0 ? ` · owe ${formatCurrency(r.loan)} (${r.owedShare}% of its value)` : " · no loan"}
                      {r.loanExceedsValue ? " · loan is more than the value" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-[var(--color-ink-soft)]">Add an estimated value on the property page to see it here.</p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 pt-3 border-t border-[var(--color-line)] flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-[var(--color-ink-soft)]">
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-2.5 rounded-sm" style={{ background: "var(--color-ink-soft)" }} aria-hidden /> Solid = what you own
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-2.5 rounded-sm" style={{ background: hatched("var(--color-ink-soft)"), boxShadow: "inset 0 0 0 1px var(--color-ink-soft)" }} aria-hidden /> Striped = what you owe
          </span>
        </span>
        <PropertyTypeLegend />
      </div>
      <p className="sr-only">{PROPERTY_TYPE_INFO.INVESTMENT.label} bars are green and {PROPERTY_TYPE_INFO.PPR.label} bars are blue.</p>
    </div>
  );
}
