import { Link } from "react-router-dom";
import type { BrokerAccount, Investment } from "../api/types";
import { Card } from "./ui";
import { MARKET_TITLES, formatPercent, formatPrice, formatUnits, formatUsd } from "../lib/holdings";
import { formatDateUtc, formatDateTime, formatMoney } from "../lib/format";
import { resolveMarketPosition } from "../lib/pnl";
import { brokerLabel, brokerShort, holdingBrokerAccountId } from "../lib/brokers";

const fmtValue = (n: number, isUs: boolean) => (isUs ? formatUsd(n) : formatMoney(n));
// Same +/- convention as the Realised Transactions page, just usable in either currency.
const fmtSigned = (n: number, isUs: boolean) => `${n < 0 ? "-" : "+"}${fmtValue(Math.abs(n), isUs)}`;
const gainLossCls = (n: number) => (n >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]");

/**
 * Share and ETF holdings laid out like a Stake portfolio report:
 * Symbol · Name · Weighting · Units · Purchase Price · Purchase Value · Market Price · Market Value · Unrealised Gain/Loss.
 * Wall St Equities are shown in US$ only (no A$ conversion).
 *
 * Market Price/Value come from the database (Investment.marketPrice, set by
 * POST /investments/refresh-market-prices — see InvestmentsPage, which fires that once after
 * this table has already rendered from the stored values, and marketPriceRefresh.ts on the
 * backend, which refreshes at most once a minute while the exchange is open and at most once
 * every 24 hours while it is closed, so evenings and weekends still get a saved price). Each row
 * shows when that price was last *successfully* refreshed; a failed refresh simply leaves the
 * previous stored price and timestamp in place. Before a holding has ever been successfully
 * refreshed —
 * Market Price falls back to its last recorded valuation price instead of a blank dash, labelled
 * "Recorded" rather than "As at" so it isn't mistaken for a live quote. Purchase Price/Value come
 * from the investment's cost base (summary.costBase, which includes brokerage — see
 * computeHoldingSummary on the backend) rather than the raw valuation, so brokerage entered via
 * "Update holding" or "Add a buy/sell transaction" is reflected here. Unrealised Gain/Loss =
 * Market Value − Purchase Value, shown in green for a gain and red for a loss. A holding falls
 * back to its last recorded valuation for Purchase Price/Value if it has no buy history yet
 * (cost base unknown), and is blank ("—") in the market columns only if it has neither a live
 * price nor any recorded valuation at all.
 */
export function HoldingsTable({ market, holdings, onSell, accounts = [] }: { market: "ASX" | "WALL_ST"; holdings: Investment[]; onSell?: (inv: Investment) => void; accounts?: BrokerAccount[] }) {
  const isUs = market === "WALL_ST";
  const currency = isUs ? "USD" : "AUD";
  const rows = holdings.map((inv) => {
    const h = inv.holding ?? null;
    // Units, market price (live, else last recorded) and market value come from the shared resolver so the
    // dashboard P&L cards use exactly the same figures as this table.
    const { units, marketPrice, marketPriceAsAt, priceBasis, marketValue } = resolveMarketPosition(inv);
    const marketPriceIsLive = priceBasis === "live";
    const costBaseKnown = inv.summary.costBaseKnown !== false;
    // Wall St values are US$ only; ASX values are A$ (falls back to the summary value for holdings with no valuation).
    const value = costBaseKnown ? inv.summary.costBase : h ? h.marketValue : isUs ? null : inv.summary.currentValue > 0 ? inv.summary.currentValue : null;
    const price = costBaseKnown && units ? value! / units : h ? h.marketPrice : null;
    // A fully sold position has 0 units and no active unrealised position; its realised result stays visible (see below).
    const closed = inv.summary.closed === true;
    const unrealisedGainLoss = !closed && marketValue !== null && value !== null ? marketValue - value : null;
    const unrealisedPercent = unrealisedGainLoss !== null && value !== null && value > 0 ? (unrealisedGainLoss / value) * 100 : null;
    return {
      inv,
      closed,
      weighting: closed ? null : h ? h.weightingPercent : null,
      units: closed ? 0 : units,
      price: closed ? null : price,
      value: closed ? null : value,
      marketPrice: closed ? null : marketPrice,
      marketPriceAsAt: closed ? null : marketPriceAsAt,
      marketPriceIsLive,
      marketValue: closed ? null : marketValue,
      unrealisedGainLoss,
      unrealisedPercent,
      realised: inv.summary.realisedGain - inv.summary.realisedLoss,
    };
  });
  const sum = (pick: (r: (typeof rows)[number]) => number | null) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  const asAt = holdings.map((i) => i.holding?.asAt).filter(Boolean).sort().at(-1);
  const fromStake = holdings.some((i) => i.holding?.source === "STAKE");
  const dash = <span className="text-[var(--color-ink-soft)]">—</span>;
  // Every holding in a table shares one exchange, so its open/closed status is the same for all
  // of them — take it from the first row that has an opinion (a ticker-less holding reports null).
  const marketOpen = holdings.find((i) => i.marketOpen !== null && i.marketOpen !== undefined)?.marketOpen ?? null;

  return (
    <section aria-labelledby={`holdings-${market}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <h3 id={`holdings-${market}`} className="font-display text-lg font-semibold">
            {MARKET_TITLES[market]}
          </h3>
          {marketOpen !== null && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${marketOpen ? "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]" : "bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]"}`}
              title={marketOpen ? "Market prices refresh automatically about once a minute while the exchange is open." : "This exchange is closed — showing the last saved price. It is refreshed once every 24 hours while the market is closed."}
            >
              {marketOpen ? "Market open" : "Market closed"}
            </span>
          )}
        </div>
        {asAt && (
          <p className="text-xs text-[var(--color-ink-soft)]">
            Holdings as at {formatDateUtc(asAt)}
            {fromStake ? " · from Stake" : ""}
          </p>
        )}
      </div>
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[52rem]">
          <thead className="text-left text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-dim)]">
            <tr>
              <th className="px-4 py-2.5 font-medium">Symbol</th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Weighting</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Available units</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap" title="Average cost per unit, including brokerage">Avg cost/unit</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap" title="Cost of the units still held, including brokerage">{isUs ? "Cost basis (US$)" : "Cost basis"}</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Market Price</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Market Value</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Unrealised Gain/Loss</th>
              {onSell && <th className="px-4 py-2.5 font-medium text-right sticky right-0 bg-[var(--color-paper-dim)]"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.map(({ inv, closed, weighting, units, price, value, marketPrice, marketPriceAsAt, marketPriceIsLive, marketValue, unrealisedGainLoss, unrealisedPercent, realised }) => (
              <tr key={inv.id} className={`group hover:bg-[var(--color-paper-dim)] ${closed ? "bg-[var(--color-paper-dim)]/50" : ""}`}>
                <td className="px-4 py-3 font-medium">
                  <Link to={`/investments/${inv.id}`} className="text-[var(--color-eucalyptus-dark)] hover:underline">
                    {inv.ticker ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link to={`/investments/${inv.id}`} className="hover:underline">
                    {inv.name}
                  </Link>
                  {closed && (
                    <p className="text-xs text-[var(--color-ink-soft)]">
                      <span className="font-medium">Position closed</span> · realised{" "}
                      <span className={`font-medium ${realised > 0 ? "text-[var(--color-eucalyptus)]" : realised < 0 ? "text-[var(--color-brick)]" : ""}`}>{realised === 0 ? fmtValue(0, isUs) : fmtSigned(realised, isUs)}</span>
                    </p>
                  )}
                  {(() => {
                    const id = holdingBrokerAccountId(inv);
                    const account = id ? accounts.find((a) => a.id === id) : undefined;
                    return account ? (
                      <p className="text-xs text-[var(--color-ink-soft)]" title={brokerLabel(account)}>
                        {brokerShort(account)}
                      </p>
                    ) : null;
                  })()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{weighting !== null ? formatPercent(weighting) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums">{units !== null ? formatUnits(units) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums">{price !== null ? formatPrice(price, currency) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{value !== null ? fmtValue(value, isUs) : dash}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {marketPrice !== null ? (
                    <>
                      <div>{formatPrice(marketPrice, currency)}</div>
                      {marketPriceAsAt && (
                        <div className="text-[11px] font-normal text-[var(--color-ink-soft)] whitespace-nowrap">
                          {marketPriceIsLive ? `As at ${formatDateTime(marketPriceAsAt)}` : `Recorded ${formatDateUtc(marketPriceAsAt)}`}
                        </div>
                      )}
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{marketValue !== null ? fmtValue(marketValue, isUs) : dash}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-medium ${unrealisedGainLoss !== null ? gainLossCls(unrealisedGainLoss) : ""}`}>
                  {unrealisedGainLoss !== null ? fmtSigned(unrealisedGainLoss, isUs) : dash}
                  {unrealisedPercent !== null && <div className="text-[11px] font-normal">{`${unrealisedPercent >= 0 ? "+" : "-"}${Math.abs(unrealisedPercent).toFixed(2)}%`}</div>}
                </td>
                {onSell && (
                  <td className="px-3 py-2 text-right sticky right-0 bg-white group-hover:bg-[var(--color-paper-dim)]">
                    {closed ? (
                      <span className="text-xs text-[var(--color-ink-soft)]">Closed</span>
                    ) : (
                      <span title={inv.sellable && !inv.sellable.canSell ? (inv.sellable.reason ?? undefined) : undefined}>
                        {/* A filled, dark button — deliberately unlike the pale "secondary" buttons used for ordinary actions. */}
                        <button
                          type="button"
                          disabled={!inv.sellable?.canSell}
                          onClick={() => onSell(inv)}
                          aria-label={`Sell ${inv.ticker ?? inv.name}`}
                          className="rounded-xl bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Sell
                        </button>
                      </span>
                    )}
                  </td>
                )}
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
              {onSell && <td className="sticky right-0 bg-white" />}
            </tr>
          </tfoot>
        </table>
      </Card>
    </section>
  );
}
