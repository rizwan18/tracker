import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Investment } from "../api/types";
import { Button, Card, SectionHeading, StatTile, HelpText } from "../components/ui";
import { Modal } from "../components/Modal";
import { InvestmentTransactionForm } from "../components/InvestmentTransactionForm";
import { DividendForm } from "../components/DividendForm";
import { HoldingValuationForm } from "../components/HoldingValuationForm";
import { LinkedTransactions } from "../components/LinkedTransactions";
import { useFinancialYear } from "../context/FinancialYearContext";
import { formatCurrency, formatCurrencySigned, formatDate, formatDateUtc, formatMoney } from "../lib/format";
import { MARKET_TITLES, formatPercent, formatPrice, formatUnits, formatUsd, isStock, marketOf } from "../lib/holdings";

export default function InvestmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { financialYearId } = useFinancialYear();
  const [investment, setInvestment] = useState<Investment | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTxForm, setShowTxForm] = useState(false);
  const [showDividendForm, setShowDividendForm] = useState(false);
  const [showHoldingForm, setShowHoldingForm] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<Investment>(`/investments/${id}`)
      .then(setInvestment)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  async function handleDelete() {
    if (!id || !confirm("Remove this investment and all its recorded transactions and dividends?")) return;
    await api.delete(`/investments/${id}`);
    navigate("/investments");
  }

  async function handleDeleteTx(txId: string) {
    if (!confirm("Remove this transaction?")) return;
    await api.delete(`/investments/transactions/${txId}`);
    load();
  }

  async function handleDeleteValuation(valuationId: string) {
    if (!id || !confirm("Remove this entry from the holding's history?")) return;
    await api.delete(`/investments/${id}/valuations/${valuationId}`);
    load();
  }

  async function handleMarkReceived(dividendId: string) {
    await api.post(`/dividends/${dividendId}/mark-received`);
    load();
  }

  if (loading || !investment) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;

  // Wall St holdings are shown in US$ only.
  const isStockUs = isStock(investment) && marketOf(investment) === "WALL_ST";

  return (
    <div className="space-y-6">
      <SectionHeading
        title={`${investment.name}${investment.ticker ? ` (${investment.ticker})` : ""}`}
        subtitle={investment.notes ?? undefined}
        action={
          <Button variant="danger" onClick={handleDelete}>
            Remove
          </Button>
        }
      />

      {isStock(investment) && <HoldingCard investment={investment} onUpdate={() => setShowHoldingForm(true)} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Units held" value={formatUnits(investment.summary.quantity)} />
        <StatTile label="Cost base" value={investment.summary.costBaseKnown === false ? "—" : formatCurrency(investment.summary.costBase)} help={investment.summary.costBaseKnown === false ? "Add your buy history to see what you paid." : "What you paid in total, including brokerage."} />
        <StatTile label="Current value" value={formatCurrency(investment.summary.currentValue)} tone="accent" />
        {investment.summary.costBaseKnown === false ? (
          <StatTile label="Unrealised gain/loss" value="—" help="Add your buy history to see gains and losses." />
        ) : (
          <StatTile label="Unrealised gain/loss" value={formatCurrencySigned(investment.summary.unrealisedGainLoss)} tone={investment.summary.unrealisedGainLoss >= 0 ? "positive" : "negative"} />
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <SectionHeading title="Buy / sell history" action={<Button size="sm" onClick={() => setShowTxForm(true)}>+ Add</Button>} />
          <Card className="p-0 overflow-hidden">
            {investment.investmentTransactions.length === 0 ? (
              <p className="p-5 text-sm text-[var(--color-ink-soft)]">No transactions recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {[...investment.investmentTransactions]
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((tx) => (
                    <li key={tx.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="font-medium">
                          {tx.type === "BUY" ? "Buy" : "Sell"} · {tx.quantity} @ {formatCurrency(tx.pricePerUnit)}
                        </p>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {formatDate(tx.date)}
                          {tx.brokerage > 0 ? ` · Brokerage ${formatCurrency(tx.brokerage)}` : ""}
                        </p>
                      </div>
                      <button onClick={() => handleDeleteTx(tx.id)} className="text-xs text-[var(--color-brick)] hover:underline">
                        Delete
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </section>

        <section>
          <SectionHeading
            title="Dividends"
            action={<Button size="sm" onClick={() => setShowDividendForm(true)}>+ Add</Button>}
          />
          <Card className="p-0 overflow-hidden">
            {investment.dividends.length === 0 ? (
              <p className="p-5 text-sm text-[var(--color-ink-soft)]">No dividends recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {[...investment.dividends]
                  .sort((a, b) => new Date(b.paymentDate ?? 0).getTime() - new Date(a.paymentDate ?? 0).getTime())
                  .map((d) => (
                    <li key={d.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="font-medium">{formatCurrency(d.netAmount)} net</p>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {d.paymentDate ? formatDate(d.paymentDate) : "Date not set"} · {d.status === "RECEIVED" ? "Received" : "Expected"}
                          {d.frankingCredit > 0 ? ` · ${formatCurrency(d.frankingCredit)} ` : " "}
                          {d.frankingCredit > 0 && (
                            <HelpText term="Franking Credit">
                              <span>franking</span>
                            </HelpText>
                          )}
                        </p>
                      </div>
                      {d.status === "EXPECTED" && (
                        <button onClick={() => handleMarkReceived(d.id)} className="text-xs text-[var(--color-eucalyptus)] hover:underline">
                          Mark received
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      {isStock(investment) && (investment.valuations?.length ?? 0) > 1 && (
        <section>
          <SectionHeading title="Holding history" subtitle="Each statement or update you've recorded, newest first." />
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[32rem]">
              <thead className="text-left text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-dim)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">As at</th>
                  <th className="px-4 py-2.5 font-medium text-right">Units</th>
                  <th className="px-4 py-2.5 font-medium text-right">Purchase Price</th>
                  <th className="px-4 py-2.5 font-medium text-right">{isStockUs ? "Purchase Value (US$)" : "Purchase Value"}</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {investment.valuations!.map((v) => (
                  <tr key={v.id}>
                    <td className="px-4 py-2.5">{formatDateUtc(v.asAt)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatUnits(v.units)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatPrice(v.marketPrice, v.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{isStockUs ? formatUsd(v.marketValue) : formatMoney(v.marketValue)}</td>
                    <td className="px-4 py-2.5 text-[var(--color-ink-soft)]">{v.source === "STAKE" ? "Stake" : "Entered by hand"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => handleDeleteValuation(v.id)} className="text-xs text-[var(--color-brick)] hover:underline" aria-label={`Remove the ${formatDateUtc(v.asAt)} entry`}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      <LinkedTransactions scope={{ kind: "investment", id: investment.id, name: investment.name }} financialYearId={financialYearId} />

      {showHoldingForm && (
        <Modal title={investment.holding ? "Update holding" : "Add holding"} onClose={() => setShowHoldingForm(false)}>
          <HoldingValuationForm
            investment={investment}
            onCancel={() => setShowHoldingForm(false)}
            onSaved={() => {
              setShowHoldingForm(false);
              load();
            }}
          />
        </Modal>
      )}

      {showTxForm && (
        <Modal title="Add a buy/sell transaction" onClose={() => setShowTxForm(false)}>
          <InvestmentTransactionForm
            investmentId={investment.id}
            onCancel={() => setShowTxForm(false)}
            onSaved={() => {
              setShowTxForm(false);
              load();
            }}
          />
        </Modal>
      )}

      {showDividendForm && (
        <Modal title="Add a dividend" onClose={() => setShowDividendForm(false)}>
          <DividendForm
            investmentId={investment.id}
            onCancel={() => setShowDividendForm(false)}
            onSaved={() => {
              setShowDividendForm(false);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/** The holding's details, using the same headings as a Stake portfolio report. */
function HoldingCard({ investment, onUpdate }: { investment: Investment; onUpdate: () => void }) {
  const h = investment.holding ?? null;
  const market = marketOf(investment);
  const isUs = market === "WALL_ST";
  // Purchase Price/Value and Unrealised Gain/Loss come from the cost base (summary.costBase, which
  // includes brokerage) rather than the raw valuation, so they match the Cost base / Unrealised
  // gain/loss stat tiles shown just above this card.
  const costBaseKnown = investment.summary.costBaseKnown !== false;
  const units = h ? h.units : null;
  const purchaseValue = costBaseKnown ? investment.summary.costBase : h ? h.marketValue : null;
  const purchasePrice = costBaseKnown && units ? purchaseValue! / units : h ? h.marketPrice : null;
  const unrealisedGainLoss = costBaseKnown ? investment.summary.unrealisedGainLoss : null;
  const cell = (label: string, value: string) => (
    <div>
      <dt className="text-xs text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="font-medium mt-0.5">{value}</dd>
    </div>
  );
  return (
    <section>
      <SectionHeading
        title="Holding"
        subtitle={h ? `As at ${formatDateUtc(h.asAt)} · ${h.source === "STAKE" ? "from a Stake report" : "entered by hand"}` : "No units or price recorded yet."}
        action={
          <Button size="sm" variant="secondary" onClick={onUpdate}>
            {h ? "Update holding" : "+ Add holding"}
          </Button>
        }
      />
      <Card>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 text-sm">
          {cell("Symbol", investment.ticker ?? "—")}
          {cell("Name", investment.name)}
          {cell("Market", MARKET_TITLES[market])}
          {cell("Weighting", h ? formatPercent(h.weightingPercent) : "—")}
          {cell("Units", h ? formatUnits(h.units) : "—")}
          {cell(isUs ? "Purchase Price (US$)" : "Purchase Price", purchasePrice != null ? formatPrice(purchasePrice, isUs ? "USD" : "AUD") : "—")}
          {cell(isUs ? "Purchase Value (US$)" : "Purchase Value", purchaseValue != null ? (isUs ? formatUsd(purchaseValue) : formatMoney(purchaseValue)) : "—")}
          {cell(isUs ? "Market Price (US$)" : "Market Price", h?.currentMarketPrice != null ? formatPrice(h.currentMarketPrice, isUs ? "USD" : "AUD") : "—")}
          {cell(isUs ? "Market Value (US$)" : "Market Value", h?.currentMarketValue != null ? (isUs ? formatUsd(h.currentMarketValue) : formatMoney(h.currentMarketValue)) : "—")}
          {cell("Unrealised Gain/Loss", unrealisedGainLoss != null ? (isUs ? formatUsd(unrealisedGainLoss) : formatMoney(unrealisedGainLoss)) : "—")}
        </dl>
      </Card>
    </section>
  );
}
