import { Link } from "react-router-dom";
import type { DashboardResponse } from "../../api/types";
import { formatCurrency } from "../../lib/format";
import { propertyTypeOf, type PropertyType } from "../../lib/propertyType";
import { PropertyIcon } from "../PropertyIcon";
import { PropertyTypeLegend } from "../PropertyTypeBadge";

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
 * Your property at a glance: one headline bar for everything, then one picture-and-bar per
 * property (its main photo if it has one). Solid = what you own, striped = what you owe.
 */
export function PropertyChart({ properties }: { properties: PropertyRow[] }) {
  const rows = propertyChartRows(properties);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalLoan = rows.reduce((s, r) => s + r.loan, 0);
  const totalEquity = totalValue - totalLoan;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const ownedShare = totalValue > 0 ? (totalEquity / totalValue) * 100 : 0;

  return (
    <div>
      {/* Screen readers get the three plain numbers; sighted people get the headline bar. */}
      <dl className="sr-only">
        <dt>Total value</dt>
        <dd>{formatCurrency(totalValue)}</dd>
        <dt>You owe</dt>
        <dd>{formatCurrency(totalLoan)}</dd>
        <dt>You own</dt>
        <dd>{formatCurrency(totalEquity)}</dd>
      </dl>

      <p className="text-[var(--color-ink-soft)]" aria-hidden>
        You own <span className="font-display text-2xl font-semibold text-[var(--color-eucalyptus)]">{formatCurrency(totalEquity)}</span> of {formatCurrency(totalValue)}
      </p>
      <div className="mt-2 h-3 rounded-full overflow-hidden flex bg-[var(--color-paper-dim)]" aria-hidden>
        <div style={{ width: `${ownedShare}%`, background: "var(--color-eucalyptus)" }} />
        <div style={{ width: `${100 - ownedShare}%`, background: hatched("var(--color-brick)"), boxShadow: "inset 0 0 0 1px var(--color-brick)" }} />
      </div>

      <ul
        className="mt-5 space-y-3"
        aria-label={`Property values. ${rows.map((r) => `${r.name}: worth ${formatCurrency(r.value)}, you own ${formatCurrency(r.equity)}, you owe ${formatCurrency(r.loan)}`).join("; ")}`}
      >
        {rows.map((r) => {
          const colour = BAR[r.type];
          const widthPct = r.value > 0 ? Math.max(6, (r.value / max) * 100) : 0;
          return (
            <li key={r.id}>
              <Link to={`/properties/${r.id}`} className="flex items-center gap-3 rounded-xl -mx-2 px-2 py-1.5 hover:bg-[var(--color-paper-dim)] focus-visible:outline-2 focus-visible:outline-[var(--color-sky)]">
                <PropertyIcon property={r} size={44} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-sm truncate">{r.name}</span>
                    <span className="text-sm shrink-0">{r.value > 0 ? formatCurrency(r.value) : <span className="text-[var(--color-ink-soft)]">No value yet</span>}</span>
                  </span>
                  {r.value > 0 ? (
                    <>
                      <span className="block mt-1.5 h-2.5 rounded-full bg-[var(--color-paper-dim)] overflow-hidden" aria-hidden>
                        <span className="flex h-full rounded-full overflow-hidden" style={{ width: `${widthPct}%` }}>
                          <span style={{ width: `${(r.equity / r.value) * 100}%`, background: colour }} />
                          <span style={{ width: `${(r.loan / r.value) * 100}%`, background: hatched(colour), boxShadow: `inset 0 0 0 1px ${colour}` }} />
                        </span>
                      </span>
                      <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                        {r.loan > 0 ? `owe ${formatCurrency(r.loan)} (${r.owedShare}%)` : "no loan"}
                        {r.loanExceedsValue ? " · loan is more than the value" : ""}
                      </span>
                    </>
                  ) : (
                    <span className="block text-xs text-[var(--color-ink-soft)]">Add a value on the property page to see it here.</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 pt-3 border-t border-[var(--color-line)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-ink-soft)]">
        <span>Solid = you own · striped = you owe</span>
        <PropertyTypeLegend />
      </div>
    </div>
  );
}
