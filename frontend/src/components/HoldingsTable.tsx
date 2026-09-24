import { Link } from "react-router-dom";
import type { Investment } from "../api/types";
import { Card } from "./ui";
import { MARKET_TITLES, formatPercent, formatPrice, formatUnits, formatUsd } from "../lib/holdings";
import { formatDateUtc, formatMoney } from "../lib/format";

/**
 * Share and ETF holdings laid out like a Stake portfolio report:
 * Symbol · Name · Weighting · Units · Purchase Price · Purchase Value (Wall St shows both US$ and A$) ·
 * Market Price · Market Value (read-only, blank until a live market quote is available).
 */
export function HoldingsTable({ market, holdings }: { market: "ASX" | "WALL_ST"; holdings: Investment[] }) {
  const isUs = market === "WALL_ST";
  const currency = isUs ? "USD" : "AUD";
  const rows = holdings.map((inv) => {
    const h = inv.holding ?? null;
    return {
      inv,
      weighting: h ? h.weightingPercent : null,
      units: h ? h.units : inv.summary.quantity > 0 ? inv.summary.quantity : null,
      price: h ? h.marketPrice : null,
      value: h ? h.marketValue : isUs ? null : inv.summary.currentValue > 0 ? inv.summary.currentValue : null,
      valueAud: h ? h.marketValueAud : inv.summary.currentValue > 0 ? inv.summary.currentValue : null,
      marketPrice: h?.currentMarketPrice ?? null,
      marketValue: h?.currentMarketValue ?? null,
    };
  });
  const sum = (pick: (r: (typeof rows)[number]) => number | null) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  const asAt = holdings.map((i) => i.holding?.asAt).filter(Boolean).sort().at(-1);
  const fromStake = holdings.some((i) => i.holding?.source === "STAKE");
  const dash = <span className="text-[var(--color-ink-soft)]">—</span>;

  return (
    <section aria-labelledby={`holdings-${market}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 id={`holdings-${market}`} className="font-display text-lg font-semibold">
          {MARKET_TITLES[market]}
        </h3>
        {asAt && (
          <p className="text-xs text-[var(--color-ink-soft)]">
            As at {formatDateUtc(asAt)}
            {fromStake ? " · from Stake" : ""}
          </p>
        )}
      </div>
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[44rem]">
          <thead className="text-left text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-dim)]">
            <tr>
              <th className="px-4 py-2.5 font-medium">Symbol</th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium text-right">Weighting</th>
              <th className="px-4 py-2.5 font-medium text-right">Units</th>
              <th className="px-4 py-2.5 font-medium text-right">Purchase Price</th>
              {isUs ? (
                <>
                  <th className="px-4 py-2.5 font-medium text-right">Purchase Value (US$)</th>
                  <th className="px-4 py-2.5 font-medium text-right">Purchase Value (A$)</th>
                </>
              ) : (
                <th className="px-4 py-2.5 font-medium text-right">Purchase Value</th>
              )}
              <th className="px-4 py-2.5 font-medium text-right">Market Price</th>
              <th className="px-4 py-2.5 font-medium text-right">Market Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.map(({ inv, weighting, units, price, value, valueAud, marketPrice, marketValue }) => (
              <tr key={inv.id} className="hover:bg-[var(--color-paper-dim)]">
                <td className="px-4 py-3 font-medium">
                  <Link to={`/investments/${inv.id}`} className="text-[var(--color-eucalyptus-dark)] hover:underline">
                    {inv.ticker ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link to={`/investments/${inv.id}`} className="hover:underline">
                    {inv.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{weighting !== null ? formatPercent(weighting) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums">{units !== null ? formatUnits(units) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums">{price !== null ? formatPrice(price, currency) : dash}</td>
                {isUs ? (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums">{value !== null ? formatUsd(value) : dash}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{valueAud !== null ? formatMoney(valueAud) : dash}</td>
                  </>
                ) : (
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{valueAud !== null ? formatMoney(valueAud) : dash}</td>
                )}
                <td className="px-4 py-3 text-right tabular-nums">{marketPrice !== null ? formatPrice(marketPrice, currency) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums">{marketValue !== null ? formatMoney(marketValue) : dash}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-[var(--color-line)] font-semibold">
            <tr>
              <td className="px-4 py-3" colSpan={2}>
                Total
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPercent(sum((r) => r.weighting))}</td>
              <td className="px-4 py-3" colSpan={2} />
              {isUs ? (
                <>
                  <td className="px-4 py-3 text-right tabular-nums">{formatUsd(sum((r) => r.value))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.valueAud))}</td>
                </>
              ) : (
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.valueAud))}</td>
              )}
              <td className="px-4 py-3" colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </Card>
    </section>
  );
}
