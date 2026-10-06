import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { SourcingDetail, SourcingDocument } from "../../api/businessTypes";
import { useBusinessBasics } from "../../hooks/useBusiness";
import { Button, Card, EmptyState, SectionHeading, StatTile, TabPanel, Tabs } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { ProductImage } from "../../components/business/ProductImage";
import { SourcingPricingCard } from "../../components/business/SourcingPricingCard";
import { SourcingInspectionForm, SourcingPaymentForm, SourcingRecordForm, SourcingShipmentForm } from "../../components/business/SourcingForms";
import { formatCurrencyIn, formatDate } from "../../lib/format";
import {
  formatOrderMoney, INSPECTION_RESULT_LABELS, ORIGIN_LABELS, productPath, PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, SHIPMENT_METHOD_LABELS, STATUS_BADGE, STATUS_LABELS,
} from "../../lib/sourcing";

type Tab = "overview" | "payments" | "inspections" | "shipments" | "documents";
type Dialog = "edit" | "payment" | "inspection" | "shipment" | null;

/** A ghost-styled "+ Attach invoice" button with its own hidden file input, for use inline on a
 * payment or shipment row. Optional — a payment or shipment is complete without one. */
function AttachInvoiceButton({ uploading, onSelect }: { uploading: boolean; onSelect: (file: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
          e.target.value = "";
        }}
      />
      <Button variant="ghost" size="sm" disabled={uploading} onClick={() => ref.current?.click()}>
        {uploading ? "Uploading…" : "📎 Attach invoice"}
      </Button>
    </>
  );
}

/** The small file chips shown under a payment or shipment once one or more documents are attached. */
function DocumentChips({ documents, onDownload, onDelete }: { documents: SourcingDocument[]; onDownload: (id: string, fileName: string) => void; onDelete: (id: string) => void }) {
  if (documents.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {documents.map((d) => (
        <span key={d.id} className="inline-flex items-center gap-1.5 text-xs rounded-full bg-[var(--color-paper-dim)] pl-2.5 pr-1.5 py-1">
          <button type="button" className="text-[var(--color-eucalyptus)] font-medium max-w-[10rem] truncate" onClick={() => onDownload(d.id, d.fileName)} title={`Download ${d.fileName}`}>
            📄 {d.fileName}
          </button>
          <button type="button" aria-label={`Remove ${d.fileName}`} className="text-[var(--color-ink-soft)] hover:text-[var(--color-brick)] leading-none" onClick={() => onDelete(d.id)}>
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex justify-between gap-4 py-2 text-sm border-b border-[var(--color-line)] last:border-0">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="text-[var(--color-ink)] text-right">{children}</dd>
    </div>
  );
}

export default function SourcingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { accounts } = useBusinessBasics();
  const [record, setRecord] = useState<SourcingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [itemId, setItemId] = useState<string | null>(null); // the payment/inspection/shipment being edited, if any
  // Which upload is in flight, if any — "record" for the Documents tab, or "payment:<id>" /
  // "shipment:<id>" for an invoice attached inline to one payment or shipment row.
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setRecord(await api.get<SourcingDetail>(`/business/sourcing/${id}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load this sourcing order.");
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
  if (!record) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;

  const r = record;
  const money = (cents: number) => formatOrderMoney(cents, r.currency);
  const today = new Date().toISOString().slice(0, 10);
  const banks = accounts.filter((a) => a.isBank && a.isActive);
  const close = () => {
    setDialog(null);
    setItemId(null);
  };
  const openDialog = (d: Dialog, id: string | null = null) => {
    setItemId(id);
    setDialog(d);
  };
  const saved = (next: SourcingDetail) => {
    setRecord(next);
    close();
  };

  async function act(fn: () => Promise<SourcingDetail | void>) {
    setActionError(null);
    try {
      const next = await fn();
      if (next) setRecord(next);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That didn't work. Please try again.");
    }
  }

  async function removeRecord() {
    if (!confirm(`Delete this sourcing order (“${r.itemDescription}”) and all of its payments, inspections and shipments? The product itself is kept. This can't be undone.`)) return;
    await act(async () => {
      await api.delete(`/business/sourcing/${r.id}`);
      navigate(r.productId ? productPath(r.productId) : "/business/products");
    });
  }

  // `extra` optionally scopes the document to one payment or shipment (an invoice for that item
  // specifically); it's always also attached to the record as a whole, so it appears in the
  // Documents tab either way.
  async function uploadFile(file: File, key: string, extra: Record<string, string> = {}) {
    setUploadingKey(key);
    setActionError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sourcingRecordId", r.id);
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      await api.upload("/documents", form);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "We couldn't upload that file.");
    } finally {
      setUploadingKey(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function downloadDocument(docId: string, fileName: string) {
    await act(async () => {
      const blob = await api.get<Blob>(`/documents/${docId}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function deleteDocument(docId: string) {
    await act(async () => {
      await api.delete(`/documents/${docId}`);
      await load();
    });
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "payments", label: `Payments (${r.payments.length})` },
    { id: "inspections", label: `Inspections (${r.inspections.length})` },
    { id: "shipments", label: `Shipments (${r.shipments.length})` },
    { id: "documents", label: `Documents (${r.documents.length})` },
  ];

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-ink-soft)]">
        <Link to="/business/products" className="text-[var(--color-eucalyptus)] font-medium">Products/SKU</Link>
        {r.product && (
          <>
            <span aria-hidden>›</span>
            <Link to={productPath(r.product.id)} className="inline-flex items-center gap-2 text-[var(--color-eucalyptus)] font-medium">
              <ProductImage product={r.product} size={28} />
              {r.product.name}
              {r.product.sku ? <span className="font-normal text-[var(--color-ink-soft)]">({r.product.sku})</span> : null}
            </Link>
          </>
        )}
        <span aria-hidden>›</span>
        <span aria-current="page">Sourcing order{r.reference ? ` #${r.reference}` : ""}</span>
      </nav>
      <SectionHeading
        title={r.itemDescription}
        subtitle={`${r.supplierName}${r.supplierCountry ? ` · ${r.supplierCountry}` : ""}${r.reference ? ` · #${r.reference}` : ""}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDialog("edit")}>Edit</Button>
            <Button variant="danger" onClick={removeRecord}>Delete</Button>
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium rounded-full px-2.5 py-0.5 bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]">{ORIGIN_LABELS[r.origin]}</span>
        <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
      </div>

      {actionError && <p role="alert" className="text-sm text-[var(--color-brick)]">{actionError}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Goods" value={money(r.goodsCostCents)} help={`${r.quantity} × ${money(r.unitCostCents)}`} />
        <StatTile label="Total cost" value={money(r.totalCostCents)} tone="accent" help="Goods, shipping, inspections and fees" />
        <StatTile label="Paid" value={money(r.paidCents)} tone="positive" help="Payments plus transaction fees" />
        <StatTile label={r.balanceCents < 0 ? "Overpaid" : "Still to pay"} value={money(Math.abs(r.balanceCents))} tone={r.balanceCents > 0 ? "negative" : "neutral"} />
      </div>
      {r.currency !== "AUD" && (
        <p className="text-xs text-[var(--color-ink-soft)]">
          {r.exchangeRateToAud
            ? `About ${formatCurrencyIn(r.totalCostAudEstCents / 100, "AUD")} in Australian dollars at 1 ${r.currency} = ${r.exchangeRateToAud} AUD.`
            : `Add an exchange rate (Edit) to see an Australian-dollar estimate. Amounts are in ${r.currency}.`}
        </p>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <TabPanel id="overview">
          <SourcingPricingCard record={r} />
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <h3 className="font-display font-semibold mb-2">Order</h3>
              <dl>
                <Row label="Quantity">{r.quantity}</Row>
                <Row label="Supplier price per unit">{money(r.unitCostCents)}</Row>
                <Row label="Currency">{r.currency}</Row>
                <Row label="Ordered">{r.orderDate && formatDate(r.orderDate)}</Row>
                <Row label="Expected">{r.expectedDate && formatDate(r.expectedDate)}</Row>
                <Row label="Delivered">{r.deliveredDate && formatDate(r.deliveredDate)}</Row>
                <Row label="Shipping & duties">{money(r.shippingCostCents)}</Row>
                <Row label="Inspections">{money(r.inspectionCostCents)}</Row>
                <Row label="Transaction fees">{r.transactionFeeCents > 0 ? money(r.transactionFeeCents) : null}</Row>
              </dl>
            </Card>
            <Card>
              <h3 className="font-display font-semibold mb-2">Supplier</h3>
              <dl>
                <Row label="Name">{r.supplier ? <Link className="text-[var(--color-eucalyptus)] hover:underline" to={`/business/contacts/${r.supplier.id}`}>{r.supplierName}</Link> : r.supplierName}</Row>
                <Row label="Country">{r.supplierCountry}</Row>
                <Row label="Contact">{r.supplierContactName}</Row>
                <Row label="Email">{r.supplierEmail && <a className="text-[var(--color-eucalyptus)]" href={`mailto:${r.supplierEmail}`}>{r.supplierEmail}</a>}</Row>
                <Row label="Phone">{r.supplierPhone}</Row>
                <Row label="Website">{r.supplierWebsite && <a className="text-[var(--color-eucalyptus)]" href={r.supplierWebsite} target="_blank" rel="noreferrer noopener">{r.supplierWebsite}</a>}</Row>
                <Row label="Address">{r.supplierAddress}</Row>
              </dl>
            </Card>
          </div>
          {r.notes && (
            <Card>
              <h3 className="font-display font-semibold mb-2">Notes</h3>
              <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
            </Card>
          )}
        </TabPanel>
      )}

      {tab === "payments" && (
        <TabPanel id="payments">
          <div className="flex justify-end"><Button onClick={() => openDialog("payment")}>+ Record payment</Button></div>
          {r.payments.length === 0 ? (
            <EmptyState title="No payments yet" description="Record deposits, progress payments and the final balance as you pay the supplier." />
          ) : (
            <Card className="p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]">
                {r.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <div className="flex-1 min-w-[12rem]">
                      <p className="font-medium">{PAYMENT_TYPE_LABELS[p.type]} · {formatDate(p.date)}</p>
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {[p.method && PAYMENT_METHOD_LABELS[p.method], p.bankAccount && `${p.bankAccount.code} ${p.bankAccount.name}`, p.reference && `Ref ${p.reference}`, p.notes].filter(Boolean).join(" · ")}
                      </p>
                      {p.contact && <p className="text-xs text-[var(--color-ink-soft)]">Paid to <Link className="text-[var(--color-eucalyptus)] hover:underline" to={`/business/contacts/${p.contact.id}`}>{p.contact.name}</Link></p>}
                      <DocumentChips documents={p.documents} onDownload={downloadDocument} onDelete={deleteDocument} />
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{money(p.amountCents)}</p>
                      {p.feeCents > 0 && <p className="text-xs text-[var(--color-ink-soft)]">+ {money(p.feeCents)} fee</p>}
                    </div>
                    <AttachInvoiceButton uploading={uploadingKey === `payment:${p.id}`} onSelect={(file) => uploadFile(file, `payment:${p.id}`, { sourcingPaymentId: p.id })} />
                    <Button variant="ghost" size="sm" onClick={() => openDialog("payment", p.id)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => confirm("Delete this payment?") && act(() => api.delete<SourcingDetail>(`/business/sourcing/${r.id}/payments/${p.id}`))}>Delete</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabPanel>
      )}

      {tab === "inspections" && (
        <TabPanel id="inspections">
          <div className="flex justify-end"><Button onClick={() => openDialog("inspection")}>+ Add inspection</Button></div>
          {r.inspections.length === 0 ? (
            <EmptyState title="No inspections yet" description="Track quality-control inspections and what each one cost." />
          ) : (
            <Card className="p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]">
                {r.inspections.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <div className="flex-1 min-w-[12rem]">
                      <p className="font-medium">{formatDate(i.date)} · {INSPECTION_RESULT_LABELS[i.result]}</p>
                      <p className="text-xs text-[var(--color-ink-soft)]">{i.inspectorContact ? <Link className="text-[var(--color-eucalyptus)] hover:underline" to={`/business/contacts/${i.inspectorContact.id}`}>{i.inspectorContact.name}</Link> : i.inspector}{i.notes ? ` · ${i.notes}` : ""}</p>
                    </div>
                    <span className="font-medium">{money(i.costCents)}</span>
                    <Button variant="ghost" size="sm" onClick={() => openDialog("inspection", i.id)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => confirm("Delete this inspection?") && act(() => api.delete<SourcingDetail>(`/business/sourcing/${r.id}/inspections/${i.id}`))}>Delete</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabPanel>
      )}

      {tab === "shipments" && (
        <TabPanel id="shipments">
          <div className="flex justify-end"><Button onClick={() => openDialog("shipment")}>+ Add shipment</Button></div>
          {r.shipments.length === 0 ? (
            <EmptyState title="No shipments yet" description="Track freight, customs and insurance costs, plus dates and tracking." />
          ) : (
            <div className="space-y-3">
              {r.shipments.map((s) => {
                const total = s.freightCostCents + s.customsDutyCents + s.insuranceCostCents + s.otherCostCents;
                const late = s.eta && !s.arrivedDate && s.eta.slice(0, 10) < today;
                return (
                  <Card key={s.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{[s.method && SHIPMENT_METHOD_LABELS[s.method], s.carrier].filter(Boolean).join(" · ") || "Shipment"}</p>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {[s.trackingNumber && `Tracking ${s.trackingNumber}`, s.shippedDate && `Shipped ${formatDate(s.shippedDate)}`, s.eta && `ETA ${formatDate(s.eta)}`, s.arrivedDate && `Arrived ${formatDate(s.arrivedDate)}`].filter(Boolean).join(" · ")}
                        </p>
                        {[["Forwarder", s.forwarder], ["Customs", s.customsAgent], ["Logistics", s.logistics], ["Warehouse", s.warehouse]].some(([, c]) => c) && (
                          <p className="text-xs text-[var(--color-ink-soft)]">
                            {([["Forwarder", s.forwarder], ["Customs", s.customsAgent], ["Logistics", s.logistics], ["Warehouse", s.warehouse]] as const).filter(([, c]) => c).map(([label, c], i) => (
                              <span key={label}>{i > 0 && " · "}{label}: <Link className="text-[var(--color-eucalyptus)] hover:underline" to={`/business/contacts/${c!.id}`}>{c!.name}</Link></span>
                            ))}
                          </p>
                        )}
                        {late && <p className="text-xs text-[var(--color-brick)]">Past its ETA and not marked arrived.</p>}
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{money(total)}</p>
                        <div className="mt-1 flex flex-wrap justify-end gap-1">
                          <AttachInvoiceButton uploading={uploadingKey === `shipment:${s.id}`} onSelect={(file) => uploadFile(file, `shipment:${s.id}`, { sourcingShipmentId: s.id })} />
                          <Button variant="ghost" size="sm" onClick={() => openDialog("shipment", s.id)}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => confirm("Delete this shipment?") && act(() => api.delete<SourcingDetail>(`/business/sourcing/${r.id}/shipments/${s.id}`))}>Delete</Button>
                        </div>
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 text-sm">
                      <div><dt className="text-[var(--color-ink-soft)]">Freight</dt><dd>{money(s.freightCostCents)}</dd></div>
                      <div><dt className="text-[var(--color-ink-soft)]">Customs / duty</dt><dd>{money(s.customsDutyCents)}</dd></div>
                      <div><dt className="text-[var(--color-ink-soft)]">Insurance</dt><dd>{money(s.insuranceCostCents)}</dd></div>
                      <div><dt className="text-[var(--color-ink-soft)]">Other</dt><dd>{money(s.otherCostCents)}</dd></div>
                    </dl>
                    {s.notes && <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{s.notes}</p>}
                    <DocumentChips documents={s.documents} onDownload={downloadDocument} onDelete={deleteDocument} />
                  </Card>
                );
              })}
            </div>
          )}
        </TabPanel>
      )}

      {tab === "documents" && (
        <TabPanel id="documents">
          <div className="flex justify-end">
            <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" id="so-upload" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], "record")} />
            <Button disabled={uploadingKey === "record"} onClick={() => fileInput.current?.click()}>{uploadingKey === "record" ? "Uploading…" : "+ Upload document"}</Button>
          </div>
          {r.documents.length === 0 ? (
            <EmptyState title="No documents yet" description="Attach supplier invoices, quotes, inspection reports or shipping paperwork (PDF, JPG or PNG, up to 15 MB)." />
          ) : (
            <Card className="p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]">
                {r.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <div className="flex-1 min-w-[12rem]">
                      <p className="font-medium">{d.fileName}</p>
                      <p className="text-xs text-[var(--color-ink-soft)]">Added {formatDate(d.createdAt)}</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => downloadDocument(d.id, d.fileName)}>Download</Button>
                    <Button variant="ghost" size="sm" onClick={() => confirm(`Delete ${d.fileName}?`) && deleteDocument(d.id)}>Delete</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabPanel>
      )}

      {dialog === "edit" && <Modal title="Edit sourcing order" onClose={close}><SourcingRecordForm initial={r} onCancel={close} onSaved={saved} /></Modal>}
      {dialog === "payment" && (
        <Modal title={itemId ? "Edit payment" : "Record a payment"} onClose={close}>
          <SourcingPaymentForm recordId={r.id} currency={r.currency} banks={banks} defaultDate={today} initial={r.payments.find((p) => p.id === itemId)} onCancel={close} onSaved={saved} />
        </Modal>
      )}
      {dialog === "inspection" && (
        <Modal title={itemId ? "Edit inspection" : "Add an inspection"} onClose={close}>
          <SourcingInspectionForm recordId={r.id} currency={r.currency} defaultDate={today} initial={r.inspections.find((i) => i.id === itemId)} onCancel={close} onSaved={saved} />
        </Modal>
      )}
      {dialog === "shipment" && (
        <Modal title={itemId ? "Edit shipment" : "Add a shipment"} onClose={close}>
          <SourcingShipmentForm recordId={r.id} currency={r.currency} initial={r.shipments.find((s) => s.id === itemId)} onCancel={close} onSaved={saved} />
        </Modal>
      )}
    </div>
  );
}
