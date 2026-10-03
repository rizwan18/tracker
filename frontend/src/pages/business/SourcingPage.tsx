import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { SourcingDetail, SourcingOrigin, SourcingStatus, SourcingSummary, SourcingTotals } from "../../api/businessTypes";
import { useBusinessBasics } from "../../hooks/useBusiness";
import { Button, Card, EmptyState, Field, inputClass, SectionHeading, StatTile } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { SourcingRecordForm } from "../../components/business/SourcingForms";
import { formatDate } from "../../lib/format";
import { formatCents } from "../../lib/money";
import { formatOrderMoney, formatPercent, ORIGIN_LABELS, STATUS_BADGE, STATUS_LABELS, STATUS_ORDER } from "../../lib/sourcing";

const EMPTY_TOTALS: SourcingTotals = { openCount: 0, totalCostAudEstCents: 0, paidAudEstCents: 0, balanceAudEstCents: 0 };

/** Company Finance → Sourcing: purchases from overseas and local manufacturers and suppliers. */
export default function SourcingPage() {
  const navigate = useNavigate();
  const { profile, loading: basicsLoading, error: basicsError } = useBusinessBasics();
  const [items, setItems] = useState<SourcingSummary[]>([]);
  const [totals, setTotals] = useState<SourcingTotals>(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<SourcingOrigin | "ALL">("ALL");
  const [status, setStatus] = useState<SourcingStatus | "ALL">("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [adding, setAdding] = useState(false);

  // Wait a moment after typing stops before asking the server.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (origin !== "ALL") params.set("origin", origin);
      if (status !== "ALL") params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await api.get<{ items: SourcingSummary[]; totals: SourcingTotals }>(`/business/sourcing?${params.toString()}`);
      setItems(res.items);
      setTotals(res.totals);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load your sourcing records.");
    }
  }, [query, origin, status, from, to]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const filtering = query !== "" || origin !== "ALL" || status !== "ALL" || from !== "" || to !== "";
  function clearFilters() {
    setSearch("");
    setQuery("");
    setOrigin("ALL");
    setStatus("ALL");
    setFrom("");
    setTo("");
  }

  if (basicsLoading) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;
  if (basicsError || !profile) return <p className="text-[var(--color-brick)]">{basicsError ?? "We couldn't load your business."}</p>;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Sourcing"
        subtitle={`${profile.businessName} · purchases from overseas and local manufacturers and suppliers`}
        action={<Button onClick={() => setAdding(true)}>+ New sourcing record</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Open orders" value={String(totals.openCount)} tone="neutral" help="Not yet delivered or cancelled." />
        <StatTile label="Total cost (AUD est.)" value={formatCents(totals.totalCostAudEstCents)} tone="accent" help="Goods, shipping and inspection." />
        <StatTile label="Paid so far (AUD est.)" value={formatCents(totals.paidAudEstCents)} tone="positive" />
        <StatTile label="Still to pay (AUD est.)" value={formatCents(totals.balanceAudEstCents)} tone={totals.balanceAudEstCents > 0 ? "negative" : "neutral"} />
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <Field label="Search" htmlFor="sf-search">
              <input id="sf-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} placeholder="Supplier, item, order number or country" />
            </Field>
          </div>
          <Field label="Supplier" htmlFor="sf-origin">
            <select id="sf-origin" value={origin} onChange={(e) => setOrigin(e.target.value as SourcingOrigin | "ALL")} className={inputClass}>
              <option value="ALL">All suppliers</option>
              {Object.entries(ORIGIN_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Status" htmlFor="sf-status">
            <select id="sf-status" value={status} onChange={(e) => setStatus(e.target.value as SourcingStatus | "ALL")} className={inputClass}>
              <option value="ALL">All statuses</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2 md:col-span-1">
            <Field label="Ordered from" htmlFor="sf-from"><input id="sf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></Field>
            <Field label="to" htmlFor="sf-to"><input id="sf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></Field>
          </div>
        </div>
        {filtering && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          </div>
        )}
      </Card>

      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}

      {loading ? (
        <p className="text-[var(--color-ink-soft)]">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title={filtering ? "Nothing matches those filters" : "No sourcing records yet"}
          description={filtering ? "Try a different search, or clear the filters to see everything." : "Record what you buy from manufacturers and suppliers — payments, inspections and shipping costs all in one place."}
          action={filtering ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : <Button onClick={() => setAdding(true)}>+ New sourcing record</Button>}
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-[var(--color-line)]">
            {items.map((r) => {
              const late = r.expectedDate && !r.deliveredDate && r.status !== "DELIVERED" && r.status !== "CANCELLED" && r.expectedDate.slice(0, 10) < today;
              return (
                <li key={r.id}>
                  <Link to={`/business/sourcing/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-[var(--color-paper-dim)]">
                    <div className="flex-1 min-w-[12rem]">
                      <p className="font-medium text-[var(--color-ink)]">{r.itemDescription}</p>
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {r.supplierName}
                        {r.supplierCountry ? ` · ${r.supplierCountry}` : ""}
                        {r.reference ? ` · #${r.reference}` : ""}
                        {r.orderDate ? ` · ordered ${formatDate(r.orderDate)}` : ""}
                      </p>
                      {late && <p className="text-xs text-[var(--color-brick)]">Expected {formatDate(r.expectedDate!)} — overdue</p>}
                    </div>
                    <span className="text-xs font-medium rounded-full px-2.5 py-0.5 bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]">{ORIGIN_LABELS[r.origin]}</span>
                    <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    <div className="text-right min-w-[8rem]">
                      <p className="font-medium text-[var(--color-ink)]">{formatOrderMoney(r.totalCostCents, r.currency)}</p>
                      <p className={`text-xs ${r.balanceCents > 0 ? "text-[var(--color-brick)]" : "text-[var(--color-ink-soft)]"}`}>
                        {r.balanceCents > 0 ? `${formatOrderMoney(r.balanceCents, r.currency)} to pay` : r.balanceCents < 0 ? "Overpaid" : "Paid in full"}
                      </p>
                    </div>
                    {r.pricing.unit.ok && (
                      <div className="text-right min-w-[11rem] basis-full sm:basis-auto" title={`Cost per unit, and the selling price that earns a ${formatPercent(r.pricing.targetMarginPercent)} gross margin`}>
                        <p className="text-xs text-[var(--color-ink-soft)]">Cost / unit {formatOrderMoney(r.pricing.unit.costPerUnitCents, r.currency)}</p>
                        <p className="text-sm font-semibold text-[var(--color-eucalyptus-dark)]">
                          Sell at {formatOrderMoney(r.pricing.unit.sellingPricePerUnitCents, r.currency)}
                          <span className="font-normal text-xs text-[var(--color-ink-soft)]"> · {formatPercent(r.pricing.targetMarginPercent)} margin</span>
                        </p>
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {adding && (
        <Modal title="New sourcing record" onClose={() => setAdding(false)}>
          <SourcingRecordForm
            onCancel={() => setAdding(false)}
            onSaved={(saved: SourcingDetail) => {
              setAdding(false);
              navigate(`/business/sourcing/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
