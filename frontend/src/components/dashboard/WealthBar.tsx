import { formatCurrency } from "../../lib/format";
import { Donut } from "./Donut";

export interface WealthPart {
  key: string;
  label: string;
  value: number;
  colour: string;
  icon: string;
}

/** Where your money sits — home, investment property, shares, other — as a ring with a picture key. */
export function WealthBar({ parts }: { parts: WealthPart[] }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="text-sm text-[var(--color-ink-soft)]">Add a property or an investment to see how your money is spread out.</p>;

  const label = `Where your money is. ${shown.map((p) => `${p.label}: ${formatCurrency(p.value)}, ${Math.round((p.value / total) * 100)} percent`).join("; ")}`;
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <Donut segments={shown.map((p) => ({ key: p.key, value: p.value, colour: p.colour }))} label={label}>
        <span className="text-xs text-[var(--color-ink-soft)]">Total</span>
        <span className="font-display text-xl font-semibold">{formatCurrency(total)}</span>
      </Donut>
      <ul className="w-full space-y-2.5">
        {shown.map((p) => (
          <li key={p.key} className="flex items-center gap-3 text-sm">
            <span className="text-xl" aria-hidden>
              {p.icon}
            </span>
            <span className="flex-1 truncate">{p.label}</span>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.colour }} aria-hidden />
            <span className="w-10 text-right text-xs text-[var(--color-ink-soft)]">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
