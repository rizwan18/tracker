import { formatCurrency } from "../../lib/format";

export interface WealthPart {
  key: string;
  label: string;
  value: number;
  colour: string;
}

/** One stacked bar showing where your money sits (home, investment property, shares, other). */
export function WealthBar({ parts }: { parts: WealthPart[] }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="text-sm text-[var(--color-ink-soft)]">Add a property or an investment to see how your money is spread out.</p>;

  return (
    <div>
      <p className="text-xs text-[var(--color-ink-soft)]">Total</p>
      <p className="font-display text-2xl font-semibold mb-3">{formatCurrency(total)}</p>
      <div
        className="flex h-5 rounded-full overflow-hidden bg-[var(--color-paper-dim)]"
        role="img"
        aria-label={`Where your money is. ${shown.map((p) => `${p.label}: ${formatCurrency(p.value)}, ${Math.round((p.value / total) * 100)} percent`).join("; ")}`}
      >
        {shown.map((p) => (
          <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.colour }} title={`${p.label} ${formatCurrency(p.value)}`} />
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {shown.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: p.colour }} aria-hidden />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="shrink-0">
              <span className="font-medium">{formatCurrency(p.value)}</span> <span className="text-xs text-[var(--color-ink-soft)]">{Math.round((p.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
