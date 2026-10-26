import { useState } from "react";
import { createPortal } from "react-dom";
import type { BrokerAccount } from "../api/types";
import { inputClass } from "./ui";
import { BrokerAccountsManager } from "./BrokerAccountsManager";
import { brokerLabel } from "../lib/brokers";
import { useBrokerAccounts } from "../lib/useBrokerAccounts";

/**
 * Dropdown of the household's broker accounts, labelled `Broker — Account name (login@email.com)`, with a shortcut to
 * add or edit accounts. `value` is an account id ("" = none), so a trade stays tied to its account if the details change.
 */
export function BrokerAccountSelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (accountId: string) => void; disabled?: boolean }) {
  const { accounts, reload } = useBrokerAccounts();
  const [managing, setManaging] = useState(false);
  // An id that isn't in the loaded list (still loading, or removed) is kept selectable rather than silently dropped.
  const known = value === "" || accounts.some((a: BrokerAccount) => a.id === value);
  return (
    <div>
      <select id={id} className={inputClass} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">No broker account</option>
        {!known && <option value={value}>Loading account…</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {brokerLabel(a)}
          </option>
        ))}
      </select>
      <button type="button" className="text-xs text-[var(--color-eucalyptus-dark)] hover:underline mt-1" onClick={() => setManaging(true)}>
        {accounts.length === 0 ? "+ Add a broker account" : "Add or edit broker accounts"}
      </button>
      {managing &&
        createPortal(
        <BrokerAccountsManager
          accounts={accounts}
          onChanged={reload}
          onClose={() => {
            setManaging(false);
            reload();
          }}
        />,
        document.body
        )}
    </div>
  );
}
