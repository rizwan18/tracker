import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { ContactImportResult, ContactSummary, ContactType } from "../../api/businessTypes";
import { Button, Card, EmptyState, Field, inputClass, SectionHeading } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { ContactForm } from "../../components/business/ContactForm";
import { QuickActions, TypeBadges } from "../../components/business/ContactActions";
import { bestChannel, CONTACT_TYPE_LABELS, CONTACT_TYPE_ORDER, downloadBlob, locationOf } from "../../lib/contacts";

type Status = "active" | "archived";

/** Company Finance → Contacts: every business you deal with, in one searchable place. */
export default function ContactsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ContactSummary[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ContactType | "ALL">("ALL");
  const [country, setCountry] = useState("ALL");
  const [status, setStatus] = useState<Status>("active");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (query) p.set("q", query);
      if (type !== "ALL") p.set("type", type);
      if (country !== "ALL") p.set("country", country);
      p.set("status", status);
      const res = await api.get<{ items: ContactSummary[]; countries: string[] }>(`/business/contacts?${p.toString()}`);
      setItems(res.items);
      setCountries(res.countries);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load your contacts.");
    }
  }, [query, type, country, status]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const filtering = query !== "" || type !== "ALL" || country !== "ALL";
  const clear = () => { setSearch(""); setQuery(""); setType("ALL"); setCountry("ALL"); };

  async function exportCsv() {
    try {
      downloadBlob("contacts.csv", await api.get<Blob>("/business/contacts/export.csv"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't download your contacts.");
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Contacts"
        subtitle="Suppliers, freight forwarders, inspectors, customs agents, warehouses and customers — add each once, then pick them wherever you need them."
        action={<Button onClick={() => setAdding(true)}>+ Add contact</Button>}
      />

      <Card>
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
          <Field label="Search" htmlFor="ct-search">
            <input id="ct-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} placeholder="Company, person, email, phone, type or country" />
          </Field>
          <Field label="Type" htmlFor="ct-type">
            <select id="ct-type" value={type} onChange={(e) => setType(e.target.value as ContactType | "ALL")} className={inputClass}>
              <option value="ALL">All types</option>
              {CONTACT_TYPE_ORDER.map((t) => <option key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Country" htmlFor="ct-country">
            <select id="ct-country" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} disabled={countries.length === 0}>
              <option value="ALL">All countries</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportCsv()}>Export CSV</Button>
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>Import CSV</Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {(["active", "archived"] as Status[]).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s} className={`rounded-full px-3 py-1 text-sm ${status === s ? "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)] font-medium" : "text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-dim)]"}`}>
              {s === "active" ? "Active" : "Archived"}
            </button>
          ))}
          {filtering && <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}
        </div>
      </Card>

      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}

      {loading ? (
        <p className="text-[var(--color-ink-soft)]">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title={filtering ? "No contacts match that" : status === "archived" ? "Nothing archived" : "No contacts yet"}
          description={filtering ? "Try a different search, or clear the filters." : status === "archived" ? "Contacts you archive are kept here, and stay on the records that use them." : "Add a supplier, freight forwarder or customer once — then pick them from a list when you record a payment, shipment or order."}
          action={filtering ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : status === "active" ? <Button onClick={() => setAdding(true)}>+ Add contact</Button> : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.id}>
              <Card className="hover:border-[var(--color-eucalyptus)] transition-colors">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <Link to={`/business/contacts/${c.id}`} className="font-display text-lg font-semibold text-[var(--color-ink)] hover:text-[var(--color-eucalyptus)] break-words">{c.name}</Link>
                    <div className="mt-1"><TypeBadges types={c.types} /></div>
                    <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                      {[c.primaryPerson ? `${c.primaryPerson.name}${c.primaryPerson.role ? ` (${c.primaryPerson.role})` : ""}${c.personCount > 1 ? ` +${c.personCount - 1}` : ""}` : null, locationOf(c) || null, bestChannel(c)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 md:items-end shrink-0">
                    <QuickActions email={c.email} phone={c.phone} mobile={c.mobile} whatsapp={c.whatsapp} wechat={c.wechat} />
                    {c.linkCount > 0 && <span className="text-xs text-[var(--color-ink-soft)]">Used on {c.linkCount} record{c.linkCount === 1 ? "" : "s"}</span>}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <Modal title="Add a contact" onClose={() => setAdding(false)}>
          <ContactForm
            onCancel={() => setAdding(false)}
            onSaved={(c) => { setAdding(false); navigate(`/business/contacts/${c.id}`); }}
            onUseExisting={(id) => { setAdding(false); navigate(`/business/contacts/${id}`); }}
          />
        </Modal>
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); void load(); }} />}
    </div>
  );
}

// --------------------------------------------------------------------------- import
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ContactImportResult | null>(null);
  const [result, setResult] = useState<ContactImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null); setPreview(null); setResult(null);
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    await run(text, false);
  }
  async function run(text: string, commit: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<ContactImportResult>("/business/contacts/import", { csv: text, commit });
      if (commit) setResult(r); else setPreview(r);
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : "We couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  const shown = result ?? preview;
  const label: Record<string, string> = { create: "New", update: "Adds to existing", skip: "Already have", error: "Needs fixing" };
  const importable = preview ? preview.summary.create + preview.summary.update : 0;

  return (
    <Modal title="Import contacts" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-ink-soft)]">
          Use a CSV with a <strong>Company Name</strong> column (and, if you like, Contact Type, Contact Person, Role, Email, Phone, Mobile, WhatsApp, WeChat, Address, City, State, Country, Website, Notes). Contacts you already have are never overwritten — a file can only add to them.{" "}
          <button type="button" className="text-[var(--color-sky)] underline" onClick={async () => downloadBlob("contacts-template.csv", await api.get<Blob>("/business/contacts/template.csv"))}>Download the template</button>
        </p>
        <input ref={fileInput} type="file" accept=".csv,text/csv" className="block w-full text-sm" onChange={(e) => void choose(e.target.files?.[0])} aria-label="Choose a contacts CSV file" />
        {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}
        {busy && <p className="text-sm text-[var(--color-ink-soft)]">Working…</p>}

        {shown && (
          <>
            <p className="text-sm font-medium text-[var(--color-ink)]" role="status">
              {result ? "Imported. " : `${fileName}: `}
              {shown.summary.create} new · {shown.summary.update} added to · {shown.summary.skip} already there{shown.summary.error > 0 ? ` · ${shown.summary.error} need fixing` : ""}
            </p>
            {shown.ignoredColumns.length > 0 && <p className="text-xs text-[var(--color-ink-soft)]">Ignored columns: {shown.ignoredColumns.join(", ")}</p>}
            <ul className="max-h-64 overflow-y-auto divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
              {shown.rows.map((r, i) => (
                <li key={i} className="px-3 py-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium truncate">{r.name || "(no name)"}</span>
                    <span className={r.action === "error" ? "text-[var(--color-brick)]" : "text-[var(--color-ink-soft)]"}>{label[r.action]}</span>
                  </div>
                  {r.people.length > 0 && <p className="text-xs text-[var(--color-ink-soft)]">{r.people.join(", ")}</p>}
                  {r.messages.map((m, j) => <p key={j} className={`text-xs ${r.action === "error" ? "text-[var(--color-brick)]" : "text-[var(--color-ink-soft)]"}`}>{m}</p>)}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex justify-end gap-2">
          {result ? (
            <Button onClick={onDone}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button disabled={busy || !csv || importable === 0} onClick={() => csv && void run(csv, true)}>
                {importable > 0 ? `Import ${importable} contact${importable === 1 ? "" : "s"}` : "Import"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
