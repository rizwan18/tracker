import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Investment } from "../api/types";
import { Button, Card, EmptyState, SectionHeading, HelpText } from "../components/ui";
import { Modal } from "../components/Modal";
import { InvestmentForm } from "../components/InvestmentForm";
import { formatCurrency, formatCurrencySigned } from "../lib/format";

// The three investment types this page covers. Everything else (shares, ETFs,
// LICs, bonds, etc.) lives on the "Shares and ETFs" page — see InvestmentsPage.tsx,
// which this page mirrors.
const PAGE_TYPES = ["CRYPTO", "MANAGED_FUND", "TERM_DEPOSIT"];

const TYPE_LABELS: Record<string, string> = {
  CRYPTO: "Cryptocurrency",
  MANAGED_FUND: "Managed fund",
  TERM_DEPOSIT: "Term deposit",
};

export default function CryptoManagedFundsPage() {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<Investment[]>("/investments")
      .then((all) => setInvestments(all.filter((i) => PAGE_TYPES.includes(i.type))))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const totalValue = investments.reduce((s, i) => s + i.summary.currentValue, 0);
  // Only holdings with a buy/sell history have a cost to compare against.
  const withCost = investments.filter((i) => i.summary.costBaseKnown !== false);
  const totalUnrealised = withCost.reduce((s, i) => s + i.summary.unrealisedGainLoss, 0);

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Crypto, Managed Funds, Term Deposit"
        subtitle="Track holdings and gains — all figures are estimates based on what you enter."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/investments/realised">
              <Button variant="secondary">View Trades</Button>
            </Link>
            <Link to="/import-export?section=investments">
              <Button variant="secondary">Import / Export</Button>
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
          title="Nothing here yet"
          description="Track crypto, managed funds and term deposits in one place."
          action={<Button onClick={() => setShowForm(true)}>Add investment</Button>}
        />
      ) : (
        <section>
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-[var(--color-line)]">
              {investments.map((inv) => (
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

      {showForm && (
        <Modal title="Add an investment" onClose={() => setShowForm(false)}>
          <InvestmentForm
            defaultType="CRYPTO"
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
