import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Investment } from "../api/types";
import { Button, Card, EmptyState, SectionHeading } from "../components/ui";
import { Modal } from "../components/Modal";
import { InvestmentForm } from "../components/InvestmentForm";
import { SellSharesDialog } from "../components/SellSharesDialog";
import { PnlSummaryCards } from "../components/PnlSummaryCards";
import { TransactionsTable } from "../components/TransactionsTable";
import { EditTransactionDialog } from "../components/EditTransactionDialog";
import { BrokerAccountsManager } from "../components/BrokerAccountsManager";
import { buildTransactionLines, type TransactionLine } from "../lib/transactions";
import { currencyOfStock } from "../lib/pnl";
import { useBrokerAccounts } from "../lib/useBrokerAccounts";
import { SecurityPriceCheckPanel, type PriceCheckState } from "../components/SecurityPriceCheckPanel";
import { resolveMarketPosition, summarisePnl } from "../lib/pnl";
import { isStock } from "../lib/holdings";
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
  const [sellTarget, setSellTarget] = useState<Investment | null>(null);

  const fetchInvestments = useCallback(() => api.get<Investment[]>("/investments"), []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<Investment[]>("/investments")
      .then(setInvestments)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const { accounts, reload: reloadAccounts } = useBrokerAccounts();
  const [managingBrokers, setManagingBrokers] = useState(false);
  const [editTarget, setEditTarget] = useState<TransactionLine | null>(null);

  const [priceCheck, setPriceCheck] = useState<PriceCheckState>({ status: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const investmentsRef = useRef<Investment[]>([]);
  useEffect(() => {
    investmentsRef.current = investments;
  }, [investments]);

  // Refresh persisted market prices (the existing refresh-market-prices endpoint). The backend decides which holdings
  // are actually due — at most once a minute per holding while its exchange is open, once every 24 hours while it's
  // closed — so this is safe to fire on every visit and on every click without creating uncontrolled provider traffic.
  // One shared in-flight guard means the automatic refresh on page load and a click on "Refresh my prices" can never
  // overlap, and repeated clicks while one is running do nothing. The automatic run stays silent (a failure never blocks
  // the page); only a run the person asked for reports its outcome.
  const refreshPrices = useCallback(
    async (userInitiated: boolean) => {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      setRefreshing(true);
      if (userInitiated) setPriceCheck({ status: "running" });
      const before = new Map(investmentsRef.current.map((i) => [i.id, i.marketPriceUpdatedAt]));
      try {
        await api.post("/investments/refresh-market-prices");
      } catch (err) {
        if (userInitiated) setPriceCheck({ status: "error", message: err instanceof ApiError ? err.message : "We couldn’t reach the price service just now." });
        refreshInFlight.current = false;
        setRefreshing(false);
        return;
      }
      try {
        const fresh = await fetchInvestments();
        setInvestments(fresh);
        if (userInitiated) {
          const priced = fresh.filter((i) => isStock(i) && !i.summary.closed && i.ticker);
          const updated = priced.filter((i) => i.marketPriceUpdatedAt && i.marketPriceUpdatedAt !== (before.get(i.id) ?? null)).length;
          setPriceCheck(updated > 0 ? { status: "updated", count: updated } : { status: "unchanged", marketsClosed: priced.length > 0 && priced.every((i) => i.marketOpen === false) });
        }
      } catch (err) {
        if (userInitiated) setPriceCheck({ status: "error", message: err instanceof ApiError ? err.message : "We couldn’t load the latest prices." });
      } finally {
        refreshInFlight.current = false;
        setRefreshing(false);
      }
    },
    [fetchInvestments]
  );

  useEffect(() => {
    // Once per mount, after the table has already rendered from the database (deferred a tick; also keeps a dev-mode double mount to one request).
    const t = setTimeout(() => void refreshPrices(false), 0);
    return () => clearTimeout(t);
  }, [refreshPrices]);

  const totalValue = investments.reduce((s, i) => s + i.summary.currentValue, 0);
  const pnl = summarisePnl(investments);
  const allStocks = investments.filter(isStock);
  // `stocks` = what is still held (prices, P&L). A fully sold holding stays in the holdings tables below with 0 available
  // units and its realised result, so nothing disappears and there is no separate "closed" list to look at.
  const stocks = allStocks.filter((i) => !i.summary.closed);
  const transactionLines = buildTransactionLines(investments);
  const securities = allStocks.map((i) => ({ id: i.id, label: i.ticker ? `${i.ticker} — ${i.name}` : i.name, currency: currencyOfStock(i) })).sort((a, b) => a.label.localeCompare(b.label));
  // Crypto, managed funds and term deposits have their own page now (see
  // CryptoManagedFundsPage.tsx) — everything else non-stock still lands here.
  const others = investments.filter((i) => !isStock(i) && !["CRYPTO", "MANAGED_FUND", "TERM_DEPOSIT"].includes(i.type));
  // Price-check panel facts, taken from the holdings still held (a fully sold holding no longer needs a price).
  const latestPriceAt = stocks.map((i) => i.marketPriceUpdatedAt).filter((t): t is string => !!t).sort().at(-1) ?? null;
  const unpricedCount = stocks.filter((i) => i.ticker && resolveMarketPosition(i).priceBasis === "none").length;
  const noTickerCount = stocks.filter((i) => !i.ticker).length;

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Shares and ETFs"
        subtitle="Track holdings, dividends, and gains — all figures are estimates based on what you enter."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/import-export?section=investments">
              <Button variant="secondary">Import/Export</Button>
            </Link>
            <Button variant="secondary" onClick={() => setManagingBrokers(true)}>
              Broker accounts
            </Button>
            <Button onClick={() => setShowForm(true)}>+ Add investment</Button>
          </div>
        }
      />

      {!loading && investments.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Card className="sm:col-span-2 lg:col-span-1">
            <p className="text-sm text-[var(--color-ink-soft)]">Total portfolio value</p>
            <p className="font-display text-2xl font-semibold mt-1">{formatCurrency(totalValue)}</p>
          </Card>
          <PnlSummaryCards pnl={pnl} />
        </div>
      )}

      <SecurityPriceCheckPanel
        state={priceCheck}
        busy={refreshing}
        onRefresh={() => void refreshPrices(true)}
        latestPriceAt={latestPriceAt}
        unpricedCount={unpricedCount}
        noTickerCount={noTickerCount}
      />

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
          {allStocks.length > 0 && <TransactionsTable investments={investments} lines={transactionLines} accounts={accounts} onSell={setSellTarget} onEdit={setEditTarget} />}

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

      {sellTarget && (
        <SellSharesDialog
          investment={sellTarget}
          onCancel={() => setSellTarget(null)}
          onFinished={() => {
            setSellTarget(null);
            load();
            reloadAccounts();
          }}
        />
      )}

      {editTarget && (
        <EditTransactionDialog
          line={editTarget}
          securities={securities}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            load();
            reloadAccounts();
          }}
          onDeleted={() => {
            setEditTarget(null);
            load();
            reloadAccounts();
          }}
        />
      )}

      {managingBrokers && (
        <BrokerAccountsManager
          accounts={accounts}
          onChanged={reloadAccounts}
          onClose={() => {
            setManagingBrokers(false);
            reloadAccounts();
          }}
        />
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
