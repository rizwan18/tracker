import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { ContactOption, ContactRef, ContactType } from "../../api/businessTypes";
import { Modal } from "../Modal";
import { ContactForm } from "./ContactForm";
import { CONTACT_TYPE_SHORT, locationOf } from "../../lib/contacts";

const norm = (s: string) => s.toLowerCase();

/**
 * A searchable "pick a contact" box. Contacts of the kinds `prefer` are listed first (a freight forwarder box leads with
 * freight forwarders) but any contact can still be chosen — nothing is hidden, since one business often does several jobs.
 * "+ Add new contact" opens the add form in a pop-up, so the person never has to leave what they were doing.
 *
 * `selected` is the contact already on the record (shown even if it is archived, or the list hasn't loaded).
 * `onFreeText`, when given, lets the person use a typed name without saving it to Contacts (for one-off customers).
 */
export function ContactPicker({ id, selected, onSelect, prefer = [], placeholder = "Search contacts…", onFreeText, freeTextName, addLabel = "+ Add new contact" }: {
  id: string;
  selected: ContactRef | null;
  onSelect: (c: ContactRef | null) => void;
  prefer?: ContactType[];
  placeholder?: string;
  onFreeText?: (name: string) => void;
  /** A name typed earlier that isn't in Contacts (shown as the current value when nothing is picked). */
  freeTextName?: string | null;
  addLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ContactOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setOptions(await api.get<ContactOption[]>(`/business/contacts/options${selected ? `?includeId=${encodeURIComponent(selected.id)}` : ""}`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [selected]);

  useEffect(() => {
    if (open && options === null) void load();
  }, [open, options, load]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const { suggested, others } = useMemo(() => {
    const term = norm(q.trim());
    const match = (o: ContactOption) => !term || [o.name, o.country, o.email, o.phone, o.personName].some((v) => norm(v ?? "").includes(term));
    const all = (options ?? []).filter(match);
    const isPreferred = (o: ContactOption) => prefer.some((t) => o.types.includes(t));
    return prefer.length > 0 ? { suggested: all.filter(isPreferred), others: all.filter((o) => !isPreferred(o)) } : { suggested: [], others: all };
  }, [options, q, prefer]);

  const pick = (o: ContactOption) => { onSelect({ id: o.id, name: o.name, types: o.types, country: o.country, isArchived: o.isArchived }); setOpen(false); setQ(""); };
  const row = (o: ContactOption) => (
    <li key={o.id}>
      <button type="button" onClick={() => pick(o)} className="w-full text-left px-3 py-2 hover:bg-[var(--color-paper-dim)] focus:bg-[var(--color-paper-dim)] focus:outline-none">
        <span className="block text-sm font-medium text-[var(--color-ink)]">{o.name}</span>
        <span className="block text-xs text-[var(--color-ink-soft)]">{[o.types.map((t) => CONTACT_TYPE_SHORT[t]).join(" · "), locationOf(o)].filter(Boolean).join(" — ")}</span>
      </button>
    </li>
  );
  const trimmed = q.trim();
  const noMatch = options !== null && suggested.length + others.length === 0;

  return (
    <div ref={box} className="relative">
      <div className="flex gap-2">
        <button
          type="button"
          id={id}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 flex items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] bg-white px-3 py-2.5 text-left text-[15px] focus:border-[var(--color-eucalyptus)] focus:ring-1 focus:ring-[var(--color-eucalyptus)]"
        >
          <span className={`truncate ${selected || freeTextName ? "text-[var(--color-ink)]" : "text-[var(--color-ink-soft)]"}`}>
            {selected ? selected.name : freeTextName ? `${freeTextName} (not in Contacts)` : placeholder}
          </span>
          <span aria-hidden className="text-[var(--color-ink-soft)]">▾</span>
        </button>
        {selected && (
          <>
            <Link to={`/business/contacts/${selected.id}`} target="_blank" rel="noreferrer" className="shrink-0 self-center text-sm text-[var(--color-sky)] hover:underline">View</Link>
            <button type="button" onClick={() => onSelect(null)} aria-label="Clear contact" className="shrink-0 self-center px-1 text-[var(--color-ink-soft)] hover:text-[var(--color-brick)]">×</button>
          </>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-[var(--color-line)] bg-white shadow-lg">
          <div className="p-2 border-b border-[var(--color-line)]">
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              aria-label="Search contacts"
              className="w-full rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {options === null && !failed && <p className="px-3 py-3 text-sm text-[var(--color-ink-soft)]">Loading…</p>}
            {failed && <p className="px-3 py-3 text-sm text-[var(--color-brick)]">We couldn't load your contacts. <button type="button" className="underline" onClick={() => void load()}>Try again</button></p>}
            {suggested.length > 0 && (
              <>
                <p className="px-3 pt-2 text-xs font-medium text-[var(--color-ink-soft)]">Suggested</p>
                <ul role="listbox">{suggested.map(row)}</ul>
              </>
            )}
            {others.length > 0 && (
              <>
                {suggested.length > 0 && <p className="px-3 pt-2 text-xs font-medium text-[var(--color-ink-soft)]">Other contacts</p>}
                <ul role="listbox">{others.map(row)}</ul>
              </>
            )}
            {noMatch && <p className="px-3 py-3 text-sm text-[var(--color-ink-soft)]">{trimmed ? `No contact matches “${trimmed}”.` : "You haven't added any contacts yet."}</p>}
          </div>
          <div className="border-t border-[var(--color-line)] p-1">
            {onFreeText && trimmed && (
              <button type="button" onClick={() => { onFreeText(trimmed); setOpen(false); setQ(""); }} className="w-full text-left rounded-lg px-3 py-2 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-dim)]">
                Use “{trimmed}” without saving it to Contacts
              </button>
            )}
            <button type="button" onClick={() => { setAdding(trimmed); setOpen(false); }} className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-eucalyptus)] hover:bg-[var(--color-eucalyptus-tint)]">
              {addLabel}{trimmed ? ` “${trimmed}”` : ""}
            </button>
          </div>
        </div>
      )}

      {adding !== null && (
        <Modal title="Add a contact" onClose={() => setAdding(null)}>
          <ContactForm
            defaultName={adding}
            defaultTypes={prefer.slice(0, 1)}
            onCancel={() => setAdding(null)}
            onSaved={(c) => {
              setOptions(null); // reload next time so the new contact is in the list
              onSelect({ id: c.id, name: c.name, types: c.types, country: c.country, isArchived: false });
              setAdding(null);
              setQ("");
            }}
            onUseExisting={(existingId) => {
              setAdding(null);
              const o = (options ?? []).find((x) => x.id === existingId);
              if (o) return pick(o);
              // e.g. an archived contact, which isn't in the list: ask for it directly.
              api.get<{ id: string; name: string; types: ContactType[]; country: string | null; isArchived: boolean }>(`/business/contacts/${existingId}`)
                .then((c) => onSelect({ id: c.id, name: c.name, types: c.types, country: c.country, isArchived: c.isArchived }))
                .catch(() => undefined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
