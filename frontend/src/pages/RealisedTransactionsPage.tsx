import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useFinancialYear } from "../context/FinancialYearContext";
import { api } from "../api/client";
import type { CapitalGainDisposal } from "../api/types";
import { Card, EmptyState, SectionHeading } from "../components/ui";
import { FinancialYearSwitcher, labelFromId } from "../components/FinancialYearSwitcher";
import { formatCurrency, formatCurrencySigned, formatDate } from "../lib/format";

/**
 * "View realised transactions" for Shares, ETFs & other investments.
 *
 * This reuses the existing /api/capital-gains endpoint and its underlying
 * average-cost disposal calculation (see backend/src/routes/capitalGains.ts
 * and backend/src/lib/capitalGains.ts) rather than recomputing realised
 * profit/loss here. A "realised transaction" is any disposal (automatic,
 * from BUY/SELL history, or manually recorded) for the financial year
 * selected via the app-wide financial year switcher.
 */
export default function RealisedTransactionsPage() {
  const { financialYearId } = useFinancialYear();
  const [items, setItems] = useState<CapitalGainDisposal[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ items: CapitalGainDisposal[]; totals: { gains: number; losses: number; net: number }; disclaimer: string }>(
        `/capital-gains?financialYear=${financialYearId}`
      )
      .then((res) => {
        setItems(res.items);
        setDisclaimer(res.disclaimer);
      })
      .finally(() => setLoading(false));
  }, [financialYearId]);

  useEffect(load, [load]);

  // Totals derived from the same per-transaction figures shown in the table below —
  // not a separate calculation.
  const totalProceeds = items.reduce((s, d) => s + d.proceeds, 0);
  const totalCostBase = items.reduce((s, d) => s + d.costBase, 0);
  const totalProfit = items.filter((d) => d.grossGainLoss >= 0).reduce((s, d) => s + d.grossGainLoss, 0);
  const totalLoss = items.filter((d) => d.grossGainLoss < 0).reduce((s, d) => s - d.grossGainLoss, 0);
  const net = totalProfit - totalLoss;

  return (
    <div className="space-y-6">
      <SectionHeading
        title={`Realised Transactions – ${labelFromId(financialYearId)}`}
        subtitle="Every investment sale/disposal recorded for the selected financial year, with the realised profit or loss for each."
        action={<Link to="/investments" className="text-sm text-[var(--color-eucalyptus-dark)] hover:underline">← Back to investments</Link>}
      />

      <div className="flex items-center justify-between gap-4">
        <FinancialYearSwitcher />
      </div>

      {disclaimer && <p className="text-xs bg-[var(--color-ochre-tint)] text-[#7a4d1a] rounded-lg px-3 py-2">{disclaimer}</p>}

      {loading ? (
        <p className="text-[var(--color-ink-soft)]">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No realised transactions this financial year"
          description="Sales recorded against your investments will show up here automatically, or add a manual disposal from the Reports page for a sale that isn't tracked as a buy/sell transaction."
          action={
            <Link to="/reports" className="text-sm text-[var(--color-eucalyptus-dark)] hover:underline">
              Go to Reports → Capital gains
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Card>
              <p className="text-sm text-[var(--color-ink-soft)]">Total sale proceeds</p>
              <p className="font-display text-xl font-semibold mt-1">{formatCurrency(totalProceeds)}</p>
            </Card>
            <Card>
              <p className="text-sm text-[var(--color-ink-soft)]">Total cost base</p>
              <p className="font-display text-xl font-semibold mt-1">{formatCurrency(totalCostBase)}</p>
            </Card>
            <Card>
              <p className="text-sm text-[var(--color-ink-soft)]">Total realised profit</p>
              <p className="font-display text-xl font-semibold mt-1 text-[var(--color-eucalyptus)]">{formatCurrency(totalProfit)}</p>
            </Card>
            <Card>
              <p className="text-sm text-[var(--color-ink-soft)]">Total realised loss</p>
              <p className="font-display text-xl font-semibold mt-1 text-[var(--color-brick)]">{formatCurrency(totalLoss)}</p>
            </Card>
            <Card>
              <p className="text-sm text-[var(--color-ink-soft)]">Net realised gain/loss</p>
              <p className="font-display text-xl font-semibold mt-1">{formatCurrencySigned(net)}</p>
            </Card>
          </div>

          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[56rem]">
              <thead className="text-left text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-dim)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Security</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Acquisition date</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Date sold</th>
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Units</th>
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Sale proceeds</th>
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Cost base</th>
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Realised profit/loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {items.map((d) => {
                  const isProfit = d.grossGainLoss >= 0;
                  return (
                    <tr key={`${d.source}-${d.id}`} className="hover:bg-[var(--color-paper-dim)] align-top">
                      <td className="px-4 py-3">
                        <Link to={`/investments/${d.investmentId}`} className="font-medium hover:underline">
                          {d.investmentName} {d.ticker ? `(${d.ticker})` : ""}
                        </Link>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {d.source === "manual" ? "Manually recorded" : "From buy/sell history"}
                          {d.holdingPeriodDays !== null ? ` · Held ${d.holdingPeriodDays} days` : ""}
                        </p>
                        {d.notes && <p className="text-xs text-[var(--color-ink-soft)] mt-0.5">{d.notes}</p>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{d.acquisitionDate ? formatDate(d.acquisitionDate) : "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(d.saleDate)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{d.quantity}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(d.proceeds)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(d.costBase)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        <span className={isProfit ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}>
                          {isProfit ? "Profit " : "Loss "}
                          {formatCurrencySigned(d.grossGainLoss)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
