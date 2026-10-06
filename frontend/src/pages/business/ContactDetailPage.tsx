import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { ContactDetail, ContactPerson } from "../../api/businessTypes";
import { Button, Card, EmptyState, Field, inputClass, SectionHeading } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { ContactForm } from "../../components/business/ContactForm";
import { QuickActions, TypeBadges } from "../../components/business/ContactActions";
import { locationOf, SHIPMENT_ROLE_LABELS } from "../../lib/contacts";
import { formatDate } from "../../lib/format";
import { formatOrderMoney, INSPECTION_RESULT_LABELS, PAYMENT_TYPE_LABELS, SHIPMENT_METHOD_LABELS, STATUS_BADGE, STATUS_LABELS } from "../../lib/sourcing";
import { formatCents } from "../../lib/money";

const BASE = "/business/contacts";

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="py-2 border-b border-[var(--color-line)] last:border-0 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="text-[15px] text-[var(--color-ink)] break-words">{children}</dd>
    </div>
  );
}

/** Company Finance → Contacts → one contact: their details, the people there, and everything that uses them. */
export default function ContactDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState<ContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [person, setPerson] = useState<ContactPerson | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setC(await api.get<ContactDetail>(`${BASE}/${id}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load that contact.");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (error && !c) return (
    <div className="space-y-3">
      <p className="text-[var(--color-brick)]">{error}</p>
      <Link to="/business/contacts" className="text-[var(--color-sky)] hover:underline">← Back to Contacts</Link>
    </div>
  );
  if (!c) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;

  const act = c.activity;
  const link = c.people.length > 0 ? c.people : [];
  const action = async (fn: () => Promise<unknown>) => {
    setNotice(null);
    try { await fn(); await load(); } catch (e) { setNotice(e instanceof ApiError ? e.message : "Something went wrong. Please try again."); }
  };
  const used = act.orders.length + act.payments.length + act.shipments.length + act.inspections.length + act.entries.length;

  return (
    <div className="space-y-6">
      <Link to="/business/contacts" className="text-sm text-[var(--color-sky)] hover:underline">← All contacts</Link>
      <SectionHeading
        title={<>{c.name}{c.isArchived && <span className="ml-2 align-middle text-xs rounded-full bg-[var(--color-paper-dim)] px-2 py-0.5 text-[var(--color-ink-soft)]">Archived</span>}</>}
        subtitle={locationOf(c) || undefined}
        action={<Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
      />
      <div className="-mt-3 space-y-3">
        <TypeBadges types={c.types} />
        <QuickActions email={c.email} phone={c.phone} mobile={c.mobile} whatsapp={c.whatsapp} wechat={c.wechat} />
      </div>
      {notice && <p role="alert" className="text-sm text-[var(--color-brick)]">{notice}</p>}

      <Card>
        <h3 className="font-display text-base font-semibold mb-2">Details</h3>
        <dl>
          <Row label="Email">{c.email && <a className="text-[var(--color-eucalyptus)]" href={`mailto:${c.email}`}>{c.email}</a>}</Row>
          <Row label="Phone">{c.phone}</Row>
          <Row label="Mobile">{c.mobile}</Row>
          <Row label="WhatsApp">{c.whatsapp}</Row>
          <Row label="WeChat">{c.wechat}</Row>
          <Row label="Other contact">{c.otherContact}</Row>
          <Row label="Website">{c.website && <a className="text-[var(--color-eucalyptus)]" href={c.website} target="_blank" rel="noreferrer noopener">{c.website}</a>}</Row>
          <Row label="Address">{[c.address, c.city, c.state, c.country].filter(Boolean).join(", ")}</Row>
          <Row label="ABN">{c.abn}</Row>
          <Row label="Registration no.">{c.registrationNumber}</Row>
          <Row label="Tax / VAT / GST no.">{c.taxNumber}</Row>
          <Row label="Payment terms">{c.paymentTerms}</Row>
          <Row label="Usual currency">{c.currency}</Row>
          <Row label="Notes"><span className="whitespace-pre-wrap">{c.notes}</span></Row>
        </dl>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display text-base font-semibold">People</h3>
          <Button size="sm" variant="secondary" onClick={() => setPerson("new")}>+ Add person</Button>
        </div>
        {link.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)]">No one listed yet. Add the people you deal with here — for example sales, accounts and logistics.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {link.map((p) => (
              <li key={p.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{p.name}{p.role ? <span className="font-normal text-[var(--color-ink-soft)]"> · {p.role}</span> : null}{p.isPrimary && <span className="ml-2 text-xs rounded-full bg-[var(--color-eucalyptus-tint)] px-2 py-0.5 text-[var(--color-eucalyptus-dark)]">Main</span>}</p>
                  <p className="text-sm text-[var(--color-ink-soft)] break-words">{[p.email, p.phone, p.mobile, p.whatsapp && `WhatsApp ${p.whatsapp}`, p.wechat && `WeChat ${p.wechat}`].filter(Boolean).join(" · ") || "Uses the business's contact details"}</p>
                  {p.notes && <p className="text-sm text-[var(--color-ink-soft)] mt-1">{p.notes}</p>}
                </div>
                <div className="flex flex-col gap-2 sm:items-end shrink-0">
                  <QuickActions email={p.email || c.email} phone={p.phone || c.phone} mobile={p.mobile || c.mobile} whatsapp={p.whatsapp || c.whatsapp} wechat={p.wechat || c.wechat} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setPerson(p)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => { if (confirm(`Remove ${p.name} from ${c.name}?`)) void action(() => api.delete(`${BASE}/${c.id}/people/${p.id}`)); }}>Remove</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Activity c={c} used={used} />

      <Card>
        <h3 className="font-display text-base font-semibold mb-2">Archive or delete</h3>
        <p className="text-sm text-[var(--color-ink-soft)] mb-3">
          Archiving hides this contact from lists and pickers but keeps it on every record that uses it. A contact that is used anywhere can only be archived; one that isn't used can be deleted.
        </p>
        <div className="flex flex-wrap gap-2">
          {c.isArchived
            ? <Button variant="secondary" onClick={() => void action(() => api.post(`${BASE}/${c.id}/unarchive`))}>Restore contact</Button>
            : <Button variant="secondary" onClick={() => { if (confirm(`Archive “${c.name}”?`)) void action(() => api.post(`${BASE}/${c.id}/archive`)); }}>Archive</Button>}
          <Button variant="danger" onClick={() => { if (confirm(`Delete “${c.name}”? This can't be undone.`)) void action(async () => { await api.delete(`${BASE}/${c.id}`); navigate("/business/contacts"); }); }}>Delete</Button>
        </div>
      </Card>

      {editing && (
        <Modal title="Edit contact" onClose={() => setEditing(false)}>
          <ContactForm initial={c} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} onUseExisting={(other) => { setEditing(false); navigate(`/business/contacts/${other}`); }} />
        </Modal>
      )}
      {person && (
        <Modal title={person === "new" ? "Add a person" : "Edit person"} onClose={() => setPerson(null)}>
          <PersonForm contactId={c.id} initial={person === "new" ? undefined : person} first={c.people.length === 0} onCancel={() => setPerson(null)} onSaved={() => { setPerson(null); void load(); }} />
        </Modal>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- related activity
function Activity({ c, used }: { c: ContactDetail; used: number }) {
  const a = c.activity;
  const orderTitle = (o: { reference: string | null; itemDescription: string }) => `${o.itemDescription}${o.reference ? ` · #${o.reference}` : ""}`;
  const section = (title: string, count: number, children: ReactNode) => count > 0 && (
    <div>
      <h4 className="text-sm font-semibold text-[var(--color-ink)] mb-1">{title} <span className="font-normal text-[var(--color-ink-soft)]">({count})</span></h4>
      <ul className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">{children}</ul>
    </div>
  );
  const item = "px-3 py-2 text-sm flex items-start justify-between gap-3";
  return (
    <Card>
      <h3 className="font-display text-base font-semibold mb-3">Related activity</h3>
      {used === 0 ? (
        <EmptyState title="Nothing linked yet" description="Orders, payments, shipments, inspections and sales or expenses that use this contact will show up here." />
      ) : (
        <div className="space-y-4">
          {section("Orders & products", a.orders.length, a.orders.map((o) => (
            <li key={o.id} className={item}>
              <span className="min-w-0">
                <Link className="text-[var(--color-eucalyptus)] hover:underline" to={`/business/products/orders/${o.id}`}>{orderTitle(o)}</Link>
                {o.product && <span className="block text-xs text-[var(--color-ink-soft)]">Product: <Link className="hover:underline" to={`/business/products/${o.product.id}`}>{o.product.name}</Link>{o.product.sku ? ` (${o.product.sku})` : ""}</span>}
              </span>
              <span className="shrink-0 text-right">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                <span className="block text-xs text-[var(--color-ink-soft)] mt-0.5">{o.orderDate ? formatDate(o.orderDate) : ""}</span>
              </span>
            </li>
          )))}
          {section("Payments", a.payments.length, a.payments.map((p) => (
            <li key={p.id} className={item}>
              <span className="min-w-0"><span className="font-medium">{PAYMENT_TYPE_LABELS[p.type]}</span> · <Link className="text-[var(--color-eucalyptus)] hover:underline" to={`/business/products/orders/${p.order.id}`}>{orderTitle(p.order)}</Link></span>
              <span className="shrink-0 text-right">{formatOrderMoney(p.amountCents, p.currency)}<span className="block text-xs text-[var(--color-ink-soft)]">{formatDate(p.date)}</span></span>
            </li>
          )))}
          {section("Shipments", a.shipments.length, a.shipments.map((s) => (
            <li key={s.id} className={item}>
              <span className="min-w-0">
                <Link className="text-[var(--color-eucalyptus)] hover:underline" to={`/business/products/orders/${s.order.id}`}>{orderTitle(s.order)}</Link>
                <span className="block text-xs text-[var(--color-ink-soft)]">{[s.method ? SHIPMENT_METHOD_LABELS[s.method] : null, s.carrier, s.trackingNumber && `Tracking ${s.trackingNumber}`].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-[var(--color-ink-soft)]">{s.roles.map((r) => SHIPMENT_ROLE_LABELS[r]).join(", ")}<span className="block">{s.arrivedDate ? `Arrived ${formatDate(s.arrivedDate)}` : s.eta ? `ETA ${formatDate(s.eta)}` : ""}</span></span>
            </li>
          )))}
          {section("Inspections", a.inspections.length, a.inspections.map((i) => (
            <li key={i.id} className={item}>
              <span className="min-w-0"><Link className="text-[var(--color-eucalyptus)] hover:underline" to={`/business/products/orders/${i.order.id}`}>{orderTitle(i.order)}</Link><span className="block text-xs text-[var(--color-ink-soft)]">{INSPECTION_RESULT_LABELS[i.result]}</span></span>
              <span className="shrink-0 text-right">{formatOrderMoney(i.costCents, i.currency)}<span className="block text-xs text-[var(--color-ink-soft)]">{formatDate(i.date)}</span></span>
            </li>
          )))}
          {section("Sales & expenses", a.entries.length, a.entries.map((e) => (
            <li key={e.id} className={item}>
              <span className="min-w-0 truncate">{e.kind === "INCOME" ? "Sale" : "Expense"} · {e.description}</span>
              <span className="shrink-0 text-right">{formatCents(e.totalCents)}<span className="block text-xs text-[var(--color-ink-soft)]">{formatDate(e.date)} · {e.status === "PAID" ? "Paid" : "Unpaid"}</span></span>
            </li>
          )))}
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- one person
function PersonForm({ contactId, initial, first, onSaved, onCancel }: { contactId: string; initial?: ContactPerson; first: boolean; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "", role: initial?.role ?? "", email: initial?.email ?? "", phone: initial?.phone ?? "", mobile: initial?.mobile ?? "",
    whatsapp: initial?.whatsapp ?? "", wechat: initial?.wechat ?? "", notes: initial?.notes ?? "",
  });
  const [isPrimary, setPrimary] = useState(initial?.isPrimary ?? first);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const blank = (v: string) => (v.trim() === "" ? null : v.trim());

  async function submit() {
    if (!f.name.trim()) return setError("Please enter the person's name.");
    setSaving(true);
    setError(null);
    try {
      const body = { name: f.name.trim(), role: blank(f.role), email: blank(f.email), phone: blank(f.phone), mobile: blank(f.mobile), whatsapp: blank(f.whatsapp), wechat: blank(f.wechat), notes: blank(f.notes), isPrimary };
      if (initial) await api.put(`${BASE}/${contactId}/people/${initial.id}`, body);
      else await api.post(`${BASE}/${contactId}/people`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save that. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" htmlFor="pp-name"><input id="pp-name" className={inputClass} value={f.name} onChange={set("name")} maxLength={120} required autoFocus /></Field>
        <Field label="Position / role" htmlFor="pp-role"><input id="pp-role" className={inputClass} value={f.role} onChange={set("role")} maxLength={120} placeholder="e.g. Accounts" /></Field>
        <Field label="Email" htmlFor="pp-email"><input id="pp-email" type="email" className={inputClass} value={f.email} onChange={set("email")} maxLength={200} /></Field>
        <Field label="Phone" htmlFor="pp-phone"><input id="pp-phone" type="tel" className={inputClass} value={f.phone} onChange={set("phone")} maxLength={40} /></Field>
        <Field label="Mobile" htmlFor="pp-mobile"><input id="pp-mobile" type="tel" className={inputClass} value={f.mobile} onChange={set("mobile")} maxLength={40} /></Field>
        <Field label="WhatsApp" htmlFor="pp-wa"><input id="pp-wa" className={inputClass} value={f.whatsapp} onChange={set("whatsapp")} maxLength={60} /></Field>
        <Field label="WeChat" htmlFor="pp-wechat"><input id="pp-wechat" className={inputClass} value={f.wechat} onChange={set("wechat")} maxLength={60} /></Field>
      </div>
      <p className="text-xs text-[var(--color-ink-soft)] -mt-2">Leave a detail blank to use the business's own.</p>
      <Field label="Notes (optional)" htmlFor="pp-notes"><input id="pp-notes" className={inputClass} value={f.notes} onChange={set("notes")} maxLength={1000} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isPrimary} onChange={(e) => setPrimary(e.target.checked)} /> Main person to contact</label>
      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : initial ? "Save changes" : "Add person"}</Button>
      </div>
    </form>
  );
}
