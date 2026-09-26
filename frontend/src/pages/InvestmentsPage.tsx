import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Investment } from "../api/types";
import { Button, Card, EmptyState, SectionHeading, HelpText } from "../components/ui";
import { Modal } from "../components/Modal";
import { InvestmentForm } from "../components/InvestmentForm";
import { HoldingsTable } from "../components/HoldingsTable";
import { isStock, marketOf } from "../lib/holdings";
import { formatCurrency, formatCurrencySigned } from "../lib/format";

const TYPE_LABELS: Record<string, string> = {
  SHARE: "Share",
  ETF: "ETF",
  LIC: "LIC",
  MANAGED_FUND: "Managed fund",
  BOND: "Bond",
  TERM_DEPOSIT: "Term deposit",
  CRYPTO: "Cryptocurrency",
  P2P: "Peer-to-peer",
  PRIVATE: "Private investment",
  COLLECTIBLE: "Collectible",
  OTHER: "Other",
};

export default function InvestmentsPage() {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<Investment[]>("/investments")
      .then(setInvestments)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Refresh persisted market prices in the background, once per page visit. The table above
  // has already rendered from the database by the time this resolves — the backend itself
  // decides which holdings are actually due (their exchange must be open, and it won't have
  // refreshed the same one in the last minute — see refresh-market-prices), so this is safe
  // to fire on every visit without creating uncontrolled provider traffic. Reload afterwards
  // so the table picks up whatever did or didn't change.
  useEffect(() => {
    api
      .post("/investments/refresh-market-prices")
      .catch(() => {
        /* a refresh failure never blocks the page — the table keeps showing the last saved prices */
      })
      .finally(load);
    // Intentionally run once per mount only, not on every `investments`/`load` identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalValue = investments.reduce((s, i) => s + i.summary.currentValue, 0);
  // Only holdings with a buy/sell history have a cost to compare against.
  const withCost = investments.filter((i) => i.summary.costBaseKnown !== false);
  const totalUnrealised = withCost.reduce((s, i) => s + i.summary.unrealisedGainLoss, 0);
  const stocks = investments.filter(isStock);
  const asxStocks = stocks.filter((i) => marketOf(i) === "ASX");
  const usStocks = stocks.filter((i) => marketOf(i) === "WALL_ST");
  // Crypto, managed funds and term deposits have their own page now (see
  // CryptoManagedFundsPage.tsx) — everything else non-stock still lands here.
  const others = investments.filter((i) => !isStock(i) && !["CRYPTO", "MANAGED_FUND", "TERM_DEPOSIT"].includes(i.type));
  const latestStatement = stocks.map((i) => i.holding?.asAt).filter(Boolean).sort().at(-1);

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Shares and ETFs"
        subtitle="Track holdings, dividends, and gains — all figures are estimates based on what you enter."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/investments/realised">
              <Button variant="secondary">View Trades</Button>
            </Link>
            <Link to="/import-export?section=investments">
              <Button variant="secondary">Import / Export</Button>
            </Link>
            <Link to="/investments/price-lookup">
              <Button variant="secondary">Check Security Price</Button>
            </Link>
            <Button onClick={() => setShowForm(true)}>+ Add investment</Button>
          </div>
        }
      />

      {!loading && investments.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-sm text-[var(--color-ink-soft)]">Total portfolio value</p>
            <p className="font-display text-2xl font-semibold mt-1">{formatCurrency(totalValue)}</p>
          </Card>
          <Card>
            <p className="text-sm text-[var(--color-ink-soft)]">
              <HelpText term="Unrealised Gain/Loss">
                <span>Unrealised gain/loss</span>
              </HelpText>
            </p>
            {withCost.length === 0 ? (
              <p className="font-display text-2xl font-semibold mt-1 text-[var(--color-ink-soft)]" title="Add your buy and sell history to see gains and losses.">
                —
              </p>
            ) : (
              <p className={`font-display text-2xl font-semibold mt-1 ${totalUnrealised >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{formatCurrencySigned(totalUnrealised)}</p>
            )}
          </Card>
        </div>
      )}

      {loading ? (
        <p className="text-[var(--color-ink-soft)]">Loading…</p>
      ) : investments.length === 0 ? (
        <EmptyState
          title="No investments yet"
          description="Track shares, ETFs and other investments in one place."
          action={<Button onClick={() => setShowForm(true)}>Add investment</Button>}
        />
      ) : (
        <div className="space-y-8">
          {asxStocks.length > 0 && <HoldingsTable market="ASX" holdings={asxStocks} />}
          {usStocks.length > 0 && <HoldingsTable market="WALL_ST" holdings={usStocks} />}
          {stocks.length > 0 && latestStatement === undefined && <p className="text-xs text-[var(--color-ink-soft)]">Units and prices come from what you record on each holding.</p>}

          {others.length > 0 && (
            <section>
              <h3 className="font-display text-lg font-semibold mb-2">Other investments</h3>
              <Card className="p-0 overflow-hidden">
                <ul className="divide-y divide-[var(--color-line)]">
                  {others.map((inv) => (
                    <li key={inv.id}>
                      <Link to={`/investments/${inv.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-[var(--color-paper-dim)]">
                        <div>
                          <p className="font-medium text-[var(--color-ink)]">
                            {inv.name} {inv.ticker && <span className="text-[var(--color-ink-soft)] font-normal">({inv.ticker})</span>}
                          </p>
                          <p className="text-xs text-[var(--color-ink-soft)]">{TYPE_LABELS[inv.type] ?? inv.type}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatCurrency(inv.summary.currentValue)}</p>
                          {inv.summary.costBaseKnown !== false && (
                            <p className={`text-xs ${inv.summary.unrealisedGainLoss >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{formatCurrencySigned(inv.summary.unrealisedGainLoss)}</p>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      )}

      {showForm && (
        <Modal title="Add an investment" onClose={() => setShowForm(false)}>
          <InvestmentForm
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
