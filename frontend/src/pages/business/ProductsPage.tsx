import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { ProductDetail, ProductSummary, ProductTotals, SourcingOrigin, SourcingStatus } from "../../api/businessTypes";
import { useBusinessBasics } from "../../hooks/useBusiness";
import { Button, Card, EmptyState, Field, inputClass, SectionHeading, StatTile } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { ProductForm } from "../../components/business/ProductForm";
import { ProductImage } from "../../components/business/ProductImage";
import { formatCents } from "../../lib/money";
import { formatDate } from "../../lib/format";
import { formatOrderMoney, formatPercent, ORIGIN_LABELS, productPath, STATUS_BADGE, STATUS_LABELS, STATUS_ORDER } from "../../lib/sourcing";

const EMPTY_TOTALS: ProductTotals = { productCount: 0, openCount: 0, totalCostAudEstCents: 0, paidAudEstCents: 0, balanceAudEstCents: 0 };
// Thumbnail | Product | SKU | Orders | Current cost | Status | Action — on wide screens; stacked on phones.
const ROW = "md:grid md:grid-cols-[3rem_minmax(0,2.2fr)_minmax(0,1fr)_5.5rem_minmax(0,1.5fr)_7.5rem_3.5rem] md:items-center md:gap-x-4";

/** Company Finance → Products/SKU: each product, with its picture and the sourcing orders placed for it. */
export default function ProductsPage() {
  const navigate = useNavigate();
  const { profile, loading: basicsLoading, error: basicsError } = useBusinessBasics();
  const [items, setItems] = useState<ProductSummary[]>([]);
  const [totals, setTotals] = useState<ProductTotals>(EMPTY_TOTALS);
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
      const res = await api.get<{ items: ProductSummary[]; totals: ProductTotals }>(`/business/products?${params.toString()}`);
      setItems(res.items);
      setTotals(res.totals);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load your products.");
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

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Products/SKU"
        subtitle={`${profile.businessName} · your products, and the sourcing orders placed with manufacturers and suppliers for each`}
        action={<Button onClick={() => setAdding(true)}>+ New product</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Open orders" value={String(totals.openCount)} tone="neutral" help="Sourcing orders not yet delivered or cancelled." />
        <StatTile label="Total cost (AUD est.)" value={formatCents(totals.totalCostAudEstCents)} tone="accent" help="Goods, shipping and inspection." />
        <StatTile label="Paid so far (AUD est.)" value={formatCents(totals.paidAudEstCents)} tone="positive" />
        <StatTile label="Still to pay (AUD est.)" value={formatCents(totals.balanceAudEstCents)} tone={totals.balanceAudEstCents > 0 ? "negative" : "neutral"} />
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <Field label="Search" htmlFor="sf-search">
              <input id="sf-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} placeholder="Product, SKU, supplier, order number or country" />
            </Field>
          </div>
          <Field label="Supplier" htmlFor="sf-origin">
            <select id="sf-origin" value={origin} onChange={(e) => setOrigin(e.target.value as SourcingOrigin | "ALL")} className={inputClass}>
              <option value="ALL">All suppliers</option>
              {Object.entries(ORIGIN_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Order status" htmlFor="sf-status">
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
          title={filtering ? "Nothing matches those filters" : "No products yet"}
          description={filtering ? "Try a different search, or clear the filters to see everything." : "Add a product (or SKU), give it a picture so it's easy to spot, then record each sourcing order you place for it — payments, inspections and shipping costs all in one place."}
          action={filtering ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : <Button onClick={() => setAdding(true)}>+ New product</Button>}
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className={`hidden ${ROW} px-5 py-2 text-xs font-medium text-[var(--color-ink-soft)] border-b border-[var(--color-line)] bg-[var(--color-paper-dim)]`}>
            <span className="sr-only">Image</span>
            <span>Product</span>
            <span>SKU</span>
            <span className="text-right">Sourcing orders</span>
            <span className="text-right">Current cost</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {items.map((p) => (
              <li key={p.id}>
                <Link to={productPath(p.id)} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-[var(--color-paper-dim)] ${ROW}`}>
                  <ProductImage product={p} size={48} />
                  <div className="flex-1 min-w-[10rem] md:min-w-0">
                    <p className="font-medium text-[var(--color-ink)] truncate">{p.name}</p>
                    <p className="text-xs text-[var(--color-ink-soft)] md:hidden">{p.sku ? `SKU ${p.sku}` : "No SKU"}</p>
                  </div>
                  <span className="hidden md:block text-sm text-[var(--color-ink-soft)] truncate">{p.sku ?? "—"}</span>
                  <span className="text-sm text-[var(--color-ink-soft)] md:text-right" title={p.openOrderCount > 0 ? `${p.openOrderCount} still open` : undefined}>
                    {p.orderCount} {p.orderCount === 1 ? "order" : "orders"}
                  </span>
                  <div className="md:text-right basis-full md:basis-auto">
                    {p.latest && p.latest.costPerUnitCents !== null && p.latest.sellingPricePerUnitCents !== null ? (
                      <>
                        <p className="text-sm text-[var(--color-ink)]" title={`Latest order${p.latest.orderDate ? `, ordered ${formatDate(p.latest.orderDate)}` : ""}`}>
                          Cost / unit {formatOrderMoney(p.latest.costPerUnitCents, p.latest.currency)}
                        </p>
                        <p className="text-xs font-semibold text-[var(--color-eucalyptus-dark)]" title={`The selling price that earns a ${formatPercent(p.latest.targetMarginPercent)} gross margin`}>
                          Sell at {formatOrderMoney(p.latest.sellingPricePerUnitCents, p.latest.currency)}
                          <span className="font-normal text-[var(--color-ink-soft)]"> · {formatPercent(p.latest.targetMarginPercent)}</span>
                        </p>
                      </>
                    ) : (
                      <span className="text-sm text-[var(--color-ink-soft)]">{p.orderCount === 0 ? "No orders yet" : "—"}</span>
                    )}
                  </div>
                  <div>
                    {p.latest ? (
                      <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${STATUS_BADGE[p.latest.status]}`} title="Status of the latest order">{STATUS_LABELS[p.latest.status]}</span>
                    ) : (
                      <span className="text-xs text-[var(--color-ink-soft)]">—</span>
                    )}
                  </div>
                  <span className="hidden md:block text-right text-sm font-medium text-[var(--color-eucalyptus)]">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding && (
        <Modal title="New product" onClose={() => setAdding(false)}>
          <ProductForm
            onCancel={() => setAdding(false)}
            onSaved={(saved: ProductDetail) => {
              setAdding(false);
              navigate(productPath(saved.id)); // straight to the product, to add its picture and first order
            }}
          />
        </Modal>
      )}
    </div>
  );
}
