import { formatCurrency } from "../../lib/format";
import { Donut } from "./Donut";

/**
 * Your year in one picture: the ring is everything that came in; the red part is what went
 * out and the green part is what's left. The middle says which it is, in one number.
 */
export function YearDonut({ income, expenses }: { income: number; expenses: number }) {
  const spent = Math.min(expenses, Math.max(income, 0));
  const leftOver = income - expenses;
  const short = leftOver < 0;
  const label = `Your year so far. Money in ${formatCurrency(income)}, money out ${formatCurrency(expenses)}, ${short ? `shortfall ${formatCurrency(-leftOver)}` : `left over ${formatCurrency(leftOver)}`}.`;
  const segments =
    income <= 0 && expenses > 0
      ? [{ key: "out", value: 1, colour: "var(--color-brick)" }]
      : [
          { key: "out", value: spent, colour: "var(--color-brick)" },
          { key: "left", value: Math.max(leftOver, 0), colour: "var(--color-eucalyptus)" },
        ];

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <Donut segments={segments} label={label}>
        <span className="text-xs text-[var(--color-ink-soft)]">{short ? "Shortfall" : "Left over"}</span>
        <span className={`font-display text-2xl font-semibold ${short ? "text-[var(--color-brick)]" : "text-[var(--color-eucalyptus)]"}`}>{formatCurrency(Math.abs(leftOver))}</span>
      </Donut>
      <ul className="w-full space-y-3">
        <li className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            💰
          </span>
          <span className="flex-1 text-[var(--color-ink-soft)]">Money in</span>
          <span className="font-display text-lg font-semibold">{formatCurrency(income)}</span>
        </li>
        <li className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            🛒
          </span>
          <span className="flex-1 text-[var(--color-ink-soft)]">Money out</span>
          <span className="font-display text-lg font-semibold">{formatCurrency(expenses)}</span>
        </li>
      </ul>
    </div>
  );
}
