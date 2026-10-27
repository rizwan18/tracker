import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BrokerAccount, Investment } from "../api/types";
import { Button, Card, inputClass } from "./ui";
import { formatDateTime, formatDateUtc } from "../lib/format";
import { formatPrice, formatUnits } from "../lib/holdings";
import { brokerLabel, brokerShort } from "../lib/brokers";
import {
  NO_BROKER,
  NO_FILTERS,
  formatLineMoney,
  groupBySecurity,
  hasActiveFilters,
  type SecurityGroup,
  type TransactionFilters,
  type TransactionLine,
} from "../lib/transactions";
import type { Currency } from "../lib/pnl";

const GAIN = "text-[var(--color-eucalyptus)]";
const LOSS = "text-[var(--color-brick)]";

/** Buy / Sell badges use blue and amber on purpose: green and red are kept for profit and loss only. */
export function TypeBadge({ type }: { type: "BUY" | "SELL" }) {
  return type === "BUY" ? (
    <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[var(--color-sky-tint)] text-[var(--color-sky)]">Buy</span>
  ) : (
    <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[var(--color-ochre-tint)] text-[#7a4510]">Sell</span>
  );
}

/** Realised profit (green, +) / loss (red, −) for a sale; a neutral dash for a purchase, where it doesn't apply. */
export function RealisedCell({ line }: { line: Pick<TransactionLine, "type" | "realisedGainLoss" | "currency"> }) {
  if (line.type === "BUY" || line.realisedGainLoss === null) {
    return (
      <span className="text-[var(--color-ink-soft)]" title="Not applicable to a purchase">
        —
      </span>
    );
  }
  return <Signed amount={line.realisedGainLoss} currency={line.currency} />;
}

/** A profit/loss figure: green + for profit, red − for loss, neutral for exactly zero. */
export function Signed({ amount, currency, bold = true }: { amount: number; currency: Currency; bold?: boolean }) {
  const n = Math.round(amount * 100) / 100;
  if (n === 0) return <span className="text-[var(--color-ink-soft)]">{formatLineMoney(0, currency)}</span>;
  return (
    <span className={`${bold ? "font-medium" : ""} ${n > 0 ? GAIN : LOSS}`} data-tone={n > 0 ? "profit" : "loss"}>
      {n > 0 ? "+" : "-"}
      {formatLineMoney(Math.abs(n), currency)}
    </span>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

const dash = <span className="text-[var(--color-ink-soft)]">—</span>;

/** The holding's standing, from its transaction history and the latest valid price (unavailable is shown as unavailable, never as $0). */
function GroupSummary({ group }: { group: SecurityGroup }) {
  const { metrics: m, currency } = group;
  const price =
    m.marketPrice !== null ? (
      <>
        {formatPrice(m.marketPrice, currency)}
        <span className="block text-[11px] font-normal text-[var(--color-ink-soft)]">
          {m.priceBasis === "live" ? "as at" : "recorded"} {m.marketPriceAsAt ? formatDateTime(m.marketPriceAsAt) : ""}
        </span>
      </>
    ) : m.closed ? (
      dash
    ) : (
      <span className="text-[var(--color-ink-soft)]">Price unavailable</span>
    );
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-3 px-4 pb-4">
      <Metric label="Available units">{formatUnits(m.units)}</Metric>
      <Metric label="Avg cost / unit">{m.avgCost !== null ? formatPrice(m.avgCost, currency) : dash}</Metric>
      <Metric label="Cost basis">{m.costBase !== null ? formatLineMoney(m.costBase, currency) : dash}</Metric>
      <Metric label="Market price">{price}</Metric>
      <Metric label="Market value">{m.marketValue !== null ? formatLineMoney(m.marketValue, currency) : dash}</Metric>
      <Metric label="Unrealised P&L">
        {m.unrealised !== null ? (
          <>
            <Signed amount={m.unrealised} currency={currency} />
            {m.unrealisedPercent !== null && <span className="block text-[11px] font-normal">{`${m.unrealisedPercent >= 0 ? "+" : "-"}${Math.abs(m.unrealisedPercent).toFixed(2)}%`}</span>}
          </>
        ) : (
          dash
        )}
      </Metric>
      <Metric label="Realised P&L">{m.hasSales ? <Signed amount={m.realised} currency={currency} /> : dash}</Metric>
    </dl>
  );
}

/**
 * ONE table of every share/ETF buy and sell, grouped by security. Each security's heading shows where the holding stands;
 * under it the transactions run oldest to newest, and every sale carries the purchases it was matched against. Every
 * transaction has an Edit action. Figures are the server's (one ledger replay shared with the P&L cards and reports).
 */
export function TransactionsTable({
  investments,
  lines,
  accounts,
  onSell,
  onEdit,
}: {
  investments: Investment[];
  lines: TransactionLine[];
  accounts: BrokerAccount[];
  onSell: (inv: Investment) => void;
  onEdit: (line: TransactionLine) => void;
}) {
  const [filters, setFilters] = useState<TransactionFilters>(NO_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const groups = useMemo(() => groupBySecurity(investments, lines, filters), [investments, lines, filters]);
  const allGroups = useMemo(() => groupBySecurity(investments, lines), [investments, lines]);
  const set = (patch: Partial<TransactionFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const total = lines.length;
  const shown = groups.reduce((n, g) => n + g.lines.length, 0);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const brokerCell = (l: TransactionLine) => {
    const a = l.brokerAccountId ? accountById.get(l.brokerAccountId) : undefined;
    if (a) return <span title={brokerLabel(a)}>{brokerShort(a)}</span>;
    return <span className="text-[var(--color-ink-soft)]">{l.brokerAccountId ? "Account unavailable" : "Not recorded"}</span>;
  };
  const editButton = (l: TransactionLine, g: SecurityGroup) => (
    <button
      type="button"
      onClick={() => onEdit(l)}
      aria-label={`Edit ${l.type === "BUY" ? "buy" : "sell"} of ${g.investment.ticker ?? g.investment.name} on ${formatDateUtc(l.date)}`}
      className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-paper-dim)]"
    >
      Edit
    </button>
  );

  return (
    <section aria-labelledby="transactions-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 id="transactions-heading" className="font-display text-lg font-semibold">
          All transactions
        </h3>
        <p className="text-xs text-[var(--color-ink-soft)]" aria-live="polite">
          {total === 0 ? "" : shown === total ? `${total} ${total === 1 ? "transaction" : "transactions"} in ${allGroups.length} ${allGroups.length === 1 ? "security" : "securities"}` : `Showing ${shown} of ${total}`}
        </p>
      </div>

      <Card className="mb-3">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <label className="text-xs font-medium text-[var(--color-ink-soft)] block">
            Security
            <select className={`${inputClass} mt-1`} value={filters.investmentId} onChange={(e) => set({ investmentId: e.target.value })}>
              <option value="">All securities</option>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--color-ink-soft)] block">
            Broker account
            <select className={`${inputClass} mt-1`} value={filters.brokerAccountId} onChange={(e) => set({ brokerAccountId: e.target.value })}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {brokerShort(a)}
                </option>
              ))}
              <option value={NO_BROKER}>No account recorded</option>
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--color-ink-soft)] block">
            Type
            <select className={`${inputClass} mt-1`} value={filters.type} onChange={(e) => set({ type: e.target.value as TransactionFilters["type"] })}>
              <option value="">Buys and sells</option>
              <option value="BUY">Buys only</option>
              <option value="SELL">Sells only</option>
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--color-ink-soft)] block">
            From
            <input type="date" className={`${inputClass} mt-1`} value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-[var(--color-ink-soft)] block">
            To
            <input type="date" className={`${inputClass} mt-1`} value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
            Expand all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(groups.map((g) => g.id)))}>
            Collapse all
          </Button>
          {hasActiveFilters(filters) && (
            <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card>
          <p className="text-center text-[var(--color-ink-soft)] py-6">{total === 0 ? "No shares or ETFs yet. Add an investment with a purchase and it will appear here." : "No transactions match these filters."}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const open = !collapsed.has(g.id);
            const m = g.metrics;
            const sellable = g.investment.sellable;
            return (
              <Card key={g.id} className="p-0 overflow-hidden" data-security={g.investment.ticker ?? g.investment.name}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3">
                  <button type="button" onClick={() => toggle(g.id)} aria-expanded={open} aria-controls={`sec-${g.id}`} className="flex items-center gap-3 text-left min-w-0">
                    <span aria-hidden="true" className="text-[var(--color-ink-soft)] w-4">
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display text-lg font-semibold leading-tight">{g.investment.ticker ?? g.investment.name}</span>
                      {g.investment.ticker && <span className="block text-sm text-[var(--color-ink-soft)] truncate">{g.investment.name}</span>}
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[var(--color-ink-soft)]">
                      {g.allLines.length} {g.allLines.length === 1 ? "transaction" : "transactions"}
                    </span>
                    {m.closed ? (
                      <span className="rounded-full bg-[var(--color-paper-dim)] border border-[var(--color-line)] px-2.5 py-0.5 text-xs font-medium">Position closed · 0 units</span>
                    ) : (
                      <span className="rounded-full bg-[var(--color-sky-tint)] text-[var(--color-sky)] px-2.5 py-0.5 text-xs font-medium">Open · {formatUnits(m.units)} units</span>
                    )}
                    {g.needsReview && <span className="rounded-full bg-[var(--color-brick-tint)] text-[var(--color-brick)] px-2.5 py-0.5 text-xs font-medium">Needs review</span>}
                    <Link to={`/investments/${g.id}`} className="text-xs text-[var(--color-eucalyptus-dark)] underline hover:no-underline">
                      Details
                    </Link>
                    {!m.closed && (
                      <span title={sellable && !sellable.canSell ? (sellable.reason ?? undefined) : undefined}>
                        {/* A filled, dark button — deliberately unlike the pale buttons used for ordinary actions. */}
                        <button
                          type="button"
                          disabled={!sellable?.canSell}
                          onClick={() => onSell(g.investment)}
                          aria-label={`Sell ${g.investment.ticker ?? g.investment.name}`}
                          className="rounded-xl bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Sell
                        </button>
                      </span>
                    )}
                  </div>
                </div>
                <GroupSummary group={g} />

                {open && (
                  <div id={`sec-${g.id}`} className="border-t border-[var(--color-line)]">
                    {g.allLines.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-[var(--color-ink-soft)]">
                        No buy or sell transactions are recorded for this security{m.units > 0 ? ", so its cost and profit or loss can't be worked out. Record the purchase from Details." : "."}
                      </p>
                    ) : g.lines.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-[var(--color-ink-soft)]">No transactions for this security match the filters.</p>
                    ) : (
                      <>
                        {/* Wide screens: a table, oldest to newest. */}
                        <div className="hidden lg:block overflow-x-auto">
                          <table className="w-full text-sm min-w-[60rem]">
                            <thead className="text-left text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-dim)]">
                              <tr>
                                <th className="px-3 py-2 font-medium">Date</th>
                                <th className="px-3 py-2 font-medium">Type</th>
                                <th className="px-3 py-2 font-medium">Broker account</th>
                                <th className="px-3 py-2 font-medium text-right">Units</th>
                                <th className="px-3 py-2 font-medium text-right">Price</th>
                                <th className="px-3 py-2 font-medium text-right">Brokerage</th>
                                <th className="px-3 py-2 font-medium text-right">Total value</th>
                                <th className="px-3 py-2 font-medium text-right">Realised P&amp;L</th>
                                <th className="px-3 py-2 font-medium text-right">Units after</th>
                                <th className="px-3 py-2 font-medium text-right">
                                  <span className="sr-only">Actions</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.lines.map((l) => (
                                <tr key={l.id} className={`border-t border-[var(--color-line)] border-l-4 ${l.type === "BUY" ? "border-l-[var(--color-sky)]" : "border-l-[var(--color-ochre)]"} hover:bg-[var(--color-paper-dim)]`}>
                                    <td className="px-3 py-3 whitespace-nowrap">{formatDateUtc(l.date)}</td>
                                    <td className="px-3 py-3">
                                      <TypeBadge type={l.type} />
                                    </td>
                                    <td className="px-3 py-3 text-[13px]">{brokerCell(l)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums">{formatUnits(l.quantity)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums">{formatPrice(l.pricePerUnit, l.currency)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums">{l.brokerage > 0 ? formatLineMoney(l.brokerage, l.currency) : dash}</td>
                                    <td className="px-3 py-3 text-right tabular-nums font-medium" title={l.type === "BUY" ? "Total cost, including brokerage" : "Net proceeds, after brokerage"}>
                                      {formatLineMoney(l.totalValue, l.currency)}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums">
                                      <RealisedCell line={l} />
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums">{l.unitsAfter !== null ? formatUnits(l.unitsAfter) : dash}</td>
                                    <td className="px-3 py-3 text-right">{editButton(l, g)}</td>
                                  </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Tablets and phones: one compact card per transaction. */}
                        <ul className="lg:hidden divide-y divide-[var(--color-line)]">
                          {g.lines.map((l) => (
                            <li key={l.id} className={`p-4 border-l-4 ${l.type === "BUY" ? "border-l-[var(--color-sky)]" : "border-l-[var(--color-ochre)]"}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <TypeBadge type={l.type} />
                                    <span className="text-sm">{formatDateUtc(l.date)}</span>
                                  </div>
                                  <p className="text-xs text-[var(--color-ink-soft)] mt-1">{brokerCell(l)}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-[var(--color-ink-soft)]">{l.type === "BUY" ? "Total cost" : "Net proceeds"}</p>
                                  <p className="font-semibold tabular-nums">{formatLineMoney(l.totalValue, l.currency)}</p>
                                </div>
                              </div>
                              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-sm">
                                <dt className="text-[var(--color-ink-soft)]">Units</dt>
                                <dd className="text-right tabular-nums">{formatUnits(l.quantity)}</dd>
                                <dt className="text-[var(--color-ink-soft)]">Price</dt>
                                <dd className="text-right tabular-nums">{formatPrice(l.pricePerUnit, l.currency)}</dd>
                                <dt className="text-[var(--color-ink-soft)]">Brokerage</dt>
                                <dd className="text-right tabular-nums">{l.brokerage > 0 ? formatLineMoney(l.brokerage, l.currency) : "—"}</dd>
                                <dt className="text-[var(--color-ink-soft)]">Realised P&amp;L</dt>
                                <dd className="text-right tabular-nums">
                                  <RealisedCell line={l} />
                                </dd>
                                <dt className="text-[var(--color-ink-soft)]">Units after</dt>
                                <dd className="text-right tabular-nums">{l.unitsAfter !== null ? formatUnits(l.unitsAfter) : "—"}</dd>
                              </dl>
                              <div className="mt-3 flex justify-end">{editButton(l, g)}</div>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
