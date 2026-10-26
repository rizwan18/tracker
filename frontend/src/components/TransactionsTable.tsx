import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BrokerAccount } from "../api/types";
import { Button, Card, inputClass } from "./ui";
import { formatDateUtc } from "../lib/format";
import { formatPrice, formatUnits } from "../lib/holdings";
import { brokerLabel, brokerShort } from "../lib/brokers";
import {
  DEFAULT_SORT,
  NO_BROKER,
  NO_FILTERS,
  filterLines,
  formatLineMoney,
  hasActiveFilters,
  sortLines,
  type SortKey,
  type TransactionFilters,
  type TransactionLine,
  type TransactionSort,
} from "../lib/transactions";

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
  const n = Math.round(line.realisedGainLoss * 100) / 100;
  if (n === 0) return <span className="text-[var(--color-ink-soft)]">{formatLineMoney(0, line.currency)}</span>;
  return (
    <span className={`font-medium ${n > 0 ? GAIN : LOSS}`} data-tone={n > 0 ? "profit" : "loss"}>
      {n > 0 ? "+" : "-"}
      {formatLineMoney(Math.abs(n), line.currency)}
    </span>
  );
}

const SORT_OPTIONS: Array<{ value: string; label: string; sort: TransactionSort }> = [
  { value: "date-desc", label: "Newest first", sort: { key: "date", dir: "desc" } },
  { value: "date-asc", label: "Oldest first", sort: { key: "date", dir: "asc" } },
  { value: "security-asc", label: "Security A–Z", sort: { key: "security", dir: "asc" } },
  { value: "total-desc", label: "Largest value", sort: { key: "total", dir: "desc" } },
  { value: "realised-desc", label: "Best realised P&L", sort: { key: "realised", dir: "desc" } },
  { value: "realised-asc", label: "Worst realised P&L", sort: { key: "realised", dir: "asc" } },
];

/**
 * Every share/ETF buy and sell in one list, newest first. Buys show the total cost including brokerage; sells show net
 * proceeds after brokerage and the realised profit or loss. Figures are the server's (one ledger replay shared with the
 * holdings and P&L cards). On narrow screens each transaction becomes a compact card instead of a wide table.
 */
export function TransactionsTable({ lines, accounts, securities }: { lines: TransactionLine[]; accounts: BrokerAccount[]; securities: Array<{ id: string; label: string }> }) {
  const [filters, setFilters] = useState<TransactionFilters>(NO_FILTERS);
  const [sort, setSort] = useState<TransactionSort>(DEFAULT_SORT);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const shown = useMemo(() => sortLines(filterLines(lines, filters), sort), [lines, filters, sort]);
  const set = (patch: Partial<TransactionFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const brokerOf = (l: TransactionLine) => (l.brokerAccountId ? accountById.get(l.brokerAccountId) : undefined);
  const brokerCell = (l: TransactionLine) => {
    const a = brokerOf(l);
    if (a) return <span title={brokerLabel(a)}>{brokerShort(a)}</span>;
    return <span className="text-[var(--color-ink-soft)]">{l.brokerAccountId ? "Account unavailable" : "Not recorded"}</span>;
  };
  const securityCell = (l: TransactionLine) => (
    <Link to={`/investments/${l.investmentId}`} className="font-medium hover:underline">
      {l.ticker ?? l.name}
      {l.ticker && <span className="block text-xs font-normal text-[var(--color-ink-soft)] max-w-[14rem] truncate">{l.name}</span>}
    </Link>
  );

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "security" || key === "type" ? "asc" : "desc" }));
  const th = (key: SortKey | null, label: string, right = true) => {
    const active = key !== null && sort.key === key;
    return (
      <th className={`px-3 py-2.5 font-medium whitespace-nowrap ${right ? "text-right" : ""}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
        {key ? (
          <button type="button" onClick={() => toggle(key)} className="hover:text-[var(--color-ink)] inline-flex items-center gap-1">
            {label}
            <span aria-hidden="true" className={active ? "" : "opacity-30"}>
              {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
            </span>
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  return (
    <section aria-labelledby="transactions-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 id="transactions-heading" className="font-display text-lg font-semibold">
          All transactions
        </h3>
        <p className="text-xs text-[var(--color-ink-soft)]" aria-live="polite">
          {lines.length === 0 ? "" : shown.length === lines.length ? `${lines.length} ${lines.length === 1 ? "transaction" : "transactions"}` : `Showing ${shown.length} of ${lines.length}`}
        </p>
      </div>

      {lines.length === 0 ? (
        <Card>
          <p className="text-center text-[var(--color-ink-soft)] py-6">No buy or sell transactions yet. Add an investment with a purchase, or record a trade from a holding, and it will appear here.</p>
        </Card>
      ) : (
        <>
          <Card className="mb-3">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
              <label className="text-xs font-medium text-[var(--color-ink-soft)] block">
                Security
                <select className={`${inputClass} mt-1`} value={filters.investmentId} onChange={(e) => set({ investmentId: e.target.value })}>
                  <option value="">All securities</option>
                  {securities.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
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
              <label className="text-xs font-medium text-[var(--color-ink-soft)] block">
                Sort by
                <select
                  className={`${inputClass} mt-1`}
                  value={SORT_OPTIONS.find((o) => o.sort.key === sort.key && o.sort.dir === sort.dir)?.value ?? "date-desc"}
                  onChange={(e) => setSort(SORT_OPTIONS.find((o) => o.value === e.target.value)!.sort)}
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {hasActiveFilters(filters) && (
              <div className="mt-3">
                <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              </div>
            )}
          </Card>

          {shown.length === 0 ? (
            <Card>
              <p className="text-center text-[var(--color-ink-soft)] py-6">No transactions match these filters.</p>
            </Card>
          ) : (
            <>
              {/* Wide screens: one table. */}
              <Card className="p-0 overflow-x-auto hidden lg:block">
                <table className="w-full text-sm min-w-[62rem]">
                  <thead className="text-left text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-dim)]">
                    <tr>
                      {th("date", "Date", false)}
                      {th("security", "Security", false)}
                      {th(null, "Broker account", false)}
                      {th("type", "Type", false)}
                      {th(null, "Units")}
                      {th(null, "Price")}
                      {th(null, "Brokerage")}
                      {th("total", "Total value")}
                      {th("realised", "Realised P&L")}
                      {th(null, "Units after")}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {shown.map((l) => (
                      <tr key={l.id} className="hover:bg-[var(--color-paper-dim)]">
                        <td className="px-3 py-3 whitespace-nowrap">{formatDateUtc(l.date)}</td>
                        <td className="px-3 py-3">{securityCell(l)}</td>
                        <td className="px-3 py-3 text-[13px]">{brokerCell(l)}</td>
                        <td className="px-3 py-3">
                          <TypeBadge type={l.type} />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatUnits(l.quantity)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatPrice(l.pricePerUnit, l.currency)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{l.brokerage > 0 ? formatLineMoney(l.brokerage, l.currency) : <span className="text-[var(--color-ink-soft)]">—</span>}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium" title={l.type === "BUY" ? "Total cost, including brokerage" : "Net proceeds, after brokerage"}>
                          {formatLineMoney(l.totalValue, l.currency)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <RealisedCell line={l} />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{l.unitsAfter !== null ? formatUnits(l.unitsAfter) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Tablets and phones: one compact card per transaction. */}
              <ul className="space-y-3 lg:hidden">
                {shown.map((l) => (
                  <li key={l.id}>
                    <Card>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <TypeBadge type={l.type} />
                            {securityCell(l)}
                          </div>
                          <p className="text-xs text-[var(--color-ink-soft)] mt-1">{formatDateUtc(l.date)}</p>
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
                        <dt className="text-[var(--color-ink-soft)]">Broker account</dt>
                        <dd className="text-right text-[13px]">{brokerCell(l)}</dd>
                      </dl>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
