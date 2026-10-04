import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { ProductDetail, SourcingDetail } from "../../api/businessTypes";
import { Button, Card, EmptyState, SectionHeading, StatTile } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { ProductForm } from "../../components/business/ProductForm";
import { ProductImage } from "../../components/business/ProductImage";
import { ProductImageControl } from "../../components/business/ProductImageControl";
import { SourcingRecordForm } from "../../components/business/SourcingForms";
import { formatDate } from "../../lib/format";
import { formatOrderMoney, formatPercent, ORIGIN_LABELS, orderPath, STATUS_BADGE, STATUS_LABELS } from "../../lib/sourcing";

type Dialog = "edit" | "order" | null;

/** One product/SKU: its picture and details at the top, then every sourcing order placed for it. */
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const load = useCallback(async () => {
    try {
      setProduct(await api.get<ProductDetail>(`/business/products/${id}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load this product.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-[var(--color-brick)]">{error}</p>
        <Link to="/business/products" className="text-[var(--color-eucalyptus)] font-medium">← Back to Products/SKU</Link>
      </div>
    );
  }
  if (!product) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;

  const p = product;
  const today = new Date().toISOString().slice(0, 10);
  const latest = p.latest;
  const close = () => setDialog(null);

  async function removeProduct() {
    if (!confirm(`Delete the product “${p.name}”? This can't be undone.`)) return;
    setActionError(null);
    try {
      await api.delete(`/business/products/${p.id}`);
      navigate("/business/products");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "We couldn't delete that product. Please try again.");
    }
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-[var(--color-ink-soft)]">
        <Link to="/business/products" className="text-[var(--color-eucalyptus)] font-medium">Products/SKU</Link>
        <span aria-hidden> › </span>
        <span aria-current="page">{p.name}</span>
      </nav>

      <Card>
        <div className="flex flex-col sm:flex-row gap-5">
          <div className="space-y-3 sm:w-48 shrink-0">
            <div className="mx-auto sm:mx-0 w-full max-w-[12rem] aspect-square">
              <ProductImage product={p} size={192} large />
            </div>
            <ProductImageControl product={p} onChanged={setProduct} />
          </div>
          <div className="flex-1 min-w-0">
            <SectionHeading
              title={p.name}
              subtitle={p.sku ? `SKU: ${p.sku}` : "No SKU yet"}
              action={
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setDialog("edit")}>Edit</Button>
                  <Button variant="danger" onClick={() => void removeProduct()}>Delete</Button>
                </div>
              }
            />
            {p.description && <p className="text-sm text-[var(--color-ink)] whitespace-pre-line -mt-2 mb-3">{p.description}</p>}
            {actionError && <p role="alert" className="text-sm text-[var(--color-brick)] mb-3">{actionError}</p>}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile label="Sourcing orders" value={String(p.orderCount)} tone="neutral" help={p.openOrderCount > 0 ? `${p.openOrderCount} still open` : "None open"} />
              <StatTile
                label="Current cost / unit"
                value={latest && latest.costPerUnitCents !== null ? formatOrderMoney(latest.costPerUnitCents, latest.currency) : "—"}
                tone="accent"
                help={latest ? "From the latest order" : "Add an order to see this"}
              />
              <StatTile
                label="Selling price / unit"
                value={latest && latest.sellingPricePerUnitCents !== null ? formatOrderMoney(latest.sellingPricePerUnitCents, latest.currency) : "—"}
                tone="positive"
                help={latest ? `At a ${formatPercent(latest.targetMarginPercent)} gross margin` : undefined}
              />
              <StatTile label="Latest order" value={latest ? STATUS_LABELS[latest.status] : "—"} tone="neutral" help={latest?.orderDate ? `Ordered ${formatDate(latest.orderDate)}` : undefined} />
            </div>
          </div>
        </div>
      </Card>

      <SectionHeading
        title="Sourcing Orders"
        subtitle="Every order placed for this product. Each one keeps its own supplier, costs, payments, inspections and shipments."
        action={<Button onClick={() => setDialog("order")}>+ Add Sourcing Order</Button>}
      />

      {p.orders.length === 0 ? (
        <EmptyState
          title="No sourcing orders yet"
          description="Record what you order from a manufacturer or supplier for this product — you can add as many orders as you place."
          action={<Button onClick={() => setDialog("order")}>+ Add Sourcing Order</Button>}
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-[var(--color-line)]">
            {p.orders.map((r) => {
              const late = r.expectedDate && !r.deliveredDate && r.status !== "DELIVERED" && r.status !== "CANCELLED" && r.expectedDate.slice(0, 10) < today;
              return (
                <li key={r.id}>
                  <Link to={orderPath(r.id)} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-[var(--color-paper-dim)]">
                    <div className="flex-1 min-w-[12rem]">
                      <p className="font-medium text-[var(--color-ink)]">
                        {r.reference ? `Order #${r.reference}` : r.itemDescription}
                        <span className="font-normal text-[var(--color-ink-soft)]"> · {r.quantity.toLocaleString("en-AU")} units</span>
                      </p>
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {r.supplierName}
                        {r.supplierCountry ? ` · ${r.supplierCountry}` : ""}
                        {r.orderDate ? ` · ordered ${formatDate(r.orderDate)}` : ""}
                        {r.reference ? ` · ${r.itemDescription}` : ""}
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

      {dialog === "edit" && (
        <Modal title="Edit product" onClose={close}>
          <ProductForm
            initial={p}
            onCancel={close}
            onSaved={(saved) => {
              setProduct(saved);
              close();
            }}
          />
        </Modal>
      )}
      {dialog === "order" && (
        <Modal title="Add sourcing order" onClose={close}>
          <SourcingRecordForm
            product={{ id: p.id, name: p.name }}
            onCancel={close}
            onSaved={(saved: SourcingDetail) => {
              close();
              navigate(orderPath(saved.id));
            }}
          />
        </Modal>
      )}
    </div>
  );
}
