import { Link } from "react-router-dom";
import type { Investment, LatestPrice } from "../api/types";
import { Card } from "./ui";
import { MARKET_TITLES, formatPercent, formatPrice, formatUnits, formatUsd } from "../lib/holdings";
import { formatDateUtc, formatMoney } from "../lib/format";

const fmtValue = (n: number, isUs: boolean) => (isUs ? formatUsd(n) : formatMoney(n));
// Same +/- convention as the Realised Transactions page, just usable in either currency.
const fmtSigned = (n: number, isUs: boolean) => `${n < 0 ? "-" : "+"}${fmtValue(Math.abs(n), isUs)}`;
const gainLossCls = (n: number) => (n >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]");

/**
 * Share and ETF holdings laid out like a Stake portfolio report:
 * Symbol · Name · Weighting · Units · Purchase Price · Purchase Value · Market Price · Market Value · Unrealised Gain/Loss.
 * Wall St Equities are shown in US$ only (no A$ conversion).
 *
 * Market Price / Market Value come from `livePrices` (see useLiveHoldingPrices), fetched fresh on
 * every page load from the same market-data endpoint as the Check Security Price page. Purchase
 * Price/Value come from the investment's cost base (summary.costBase, which includes brokerage —
 * see computeHoldingSummary on the backend) rather than the raw valuation, so brokerage entered via
 * "Update holding" or "Add a buy/sell transaction" is reflected here. Unrealised Gain/Loss = Market
 * Value − Purchase Value, shown in green for a gain and red for a loss. A holding falls back to its
 * last recorded valuation for Purchase Price/Value if it has no buy history yet (cost base unknown),
 * and is blank ("—") in the market columns until its live price has loaded, or if none was found.
 */
export function HoldingsTable({ market, holdings, livePrices }: { market: "ASX" | "WALL_ST"; holdings: Investment[]; livePrices?: Record<string, LatestPrice> }) {
  const isUs = market === "WALL_ST";
  const currency = isUs ? "USD" : "AUD";
  const rows = holdings.map((inv) => {
    const h = inv.holding ?? null;
    const units = h ? h.units : inv.summary.quantity > 0 ? inv.summary.quantity : null;
    const costBaseKnown = inv.summary.costBaseKnown !== false;
    // Wall St values are US$ only; ASX values are A$ (falls back to the summary value for holdings with no valuation).
    const value = costBaseKnown ? inv.summary.costBase : h ? h.marketValue : isUs ? null : inv.summary.currentValue > 0 ? inv.summary.currentValue : null;
    const price = costBaseKnown && units ? value! / units : h ? h.marketPrice : null;
    const live = livePrices?.[inv.id] ?? null;
    const marketPrice = live ? live.price : null;
    const marketValue = live && units !== null ? live.price * units : null;
    const unrealisedGainLoss = marketValue !== null && value !== null ? marketValue - value : null;
    return {
      inv,
      weighting: h ? h.weightingPercent : null,
      units,
      price,
      value,
      marketPrice,
      marketValue,
      unrealisedGainLoss,
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
        <table className="w-full text-sm min-w-[48rem]">
          <thead className="text-left text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-dim)]">
            <tr>
              <th className="px-4 py-2.5 font-medium">Symbol</th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Weighting</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Units</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Purchase Price</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">{isUs ? "Purchase Value (US$)" : "Purchase Value"}</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Market Price</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Market Value</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Unrealised Gain/Loss</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.map(({ inv, weighting, units, price, value, marketPrice, marketValue, unrealisedGainLoss }) => (
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
                <td className="px-4 py-3 text-right tabular-nums font-medium">{value !== null ? fmtValue(value, isUs) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums">{marketPrice !== null ? formatPrice(marketPrice, currency) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums">{marketValue !== null ? fmtValue(marketValue, isUs) : dash}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-medium ${unrealisedGainLoss !== null ? gainLossCls(unrealisedGainLoss) : ""}`}>
                  {unrealisedGainLoss !== null ? fmtSigned(unrealisedGainLoss, isUs) : dash}
                </td>
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
              <td className="px-4 py-3 text-right tabular-nums">{fmtValue(sum((r) => r.value), isUs)}</td>
              <td className="px-4 py-3" colSpan={2} />
              <td className={`px-4 py-3 text-right tabular-nums ${gainLossCls(sum((r) => r.unrealisedGainLoss))}`}>
                {rows.some((r) => r.unrealisedGainLoss !== null) ? fmtSigned(sum((r) => r.unrealisedGainLoss), isUs) : dash}
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </section>
  );
}
