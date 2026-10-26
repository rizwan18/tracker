import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { BrokerAccount } from "../api/types";
import { Button, Field, inputClass } from "./ui";
import { Modal } from "./Modal";
import { brokerLabel } from "../lib/brokers";

type Draft = { brokerName: string; accountName: string; loginEmail: string };
const EMPTY: Draft = { brokerName: "", accountName: "", loginEmail: "" };

/**
 * Add, edit and remove broker accounts (broker name, account name/nickname, login e-mail).
 * Identification only: there is no password or credential field here, and none is ever stored.
 * Editing an account updates how it is shown everywhere; trades keep pointing at it, so none are detached.
 */
export function BrokerAccountsManager({ accounts, onChanged, onClose }: { accounts: BrokerAccount[]; onChanged: () => void; onClose: () => void }) {
  const [editingId, setEditingId] = useState<string | "new" | null>(accounts.length === 0 ? "new" : null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = (a: BrokerAccount) => {
    setEditingId(a.id);
    setDraft({ brokerName: a.brokerName, accountName: a.accountName, loginEmail: a.loginEmail });
    setError(null);
  };
  const startNew = () => {
    setEditingId("new");
    setDraft(EMPTY);
    setError(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // This dialog can sit inside another form (e.g. the Sell form): saving an account must never submit that one too.
    e.stopPropagation();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId === "new") await api.post("/broker-accounts", draft);
      else await api.put(`/broker-accounts/${editingId}`, draft);
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save this account. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: BrokerAccount) {
    setError(null);
    try {
      await api.delete(`/broker-accounts/${a.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't remove this account. Please try again.");
    }
  }

  return (
    <Modal title="Broker accounts" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-ink-soft)]">Add the accounts you buy and sell through. Only the broker, an account name and the e-mail you log in with are kept — never a password.</p>

        {accounts.length > 0 && (
          <ul className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{brokerLabel(a)}</p>
                  <p className="text-xs text-[var(--color-ink-soft)]">{a.transactionCount === 0 ? "No trades yet" : `${a.transactionCount} ${a.transactionCount === 1 ? "trade" : "trades"}`}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(a)}>
                    Edit
                  </Button>
                  {a.transactionCount === 0 && (
                    <Button size="sm" variant="danger" onClick={() => void remove(a)}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {editingId !== null ? (
          <form onSubmit={save} className="space-y-3 rounded-xl bg-[var(--color-paper-dim)] p-4" noValidate>
            <p className="font-medium text-sm">{editingId === "new" ? "Add a broker account" : "Edit broker account"}</p>
            <Field label="Broker" htmlFor="ba-broker">
              <input id="ba-broker" className={inputClass} value={draft.brokerName} onChange={(e) => setDraft({ ...draft, brokerName: e.target.value })} placeholder="e.g. CommSec, Stake, SelfWealth" autoComplete="off" />
            </Field>
            <Field label="Account name or nickname" htmlFor="ba-account" hint="Tells two accounts with the same broker apart, e.g. “Joint” or “SMSF”.">
              <input id="ba-account" className={inputClass} value={draft.accountName} onChange={(e) => setDraft({ ...draft, accountName: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Login e-mail" htmlFor="ba-email" hint="Only used to recognise the account. We never ask for or store passwords.">
              <input id="ba-email" type="email" className={inputClass} value={draft.loginEmail} onChange={(e) => setDraft({ ...draft, loginEmail: e.target.value })} autoComplete="off" />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {accounts.length > 0 && (
                <Button variant="secondary" onClick={() => setEditingId(null)} disabled={saving}>
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save account"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex justify-between">
              <Button variant="secondary" onClick={startNew}>
                + Add broker account
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
