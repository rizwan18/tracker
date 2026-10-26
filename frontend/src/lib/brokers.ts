import type { BrokerAccount, Investment } from "../api/types";

/** Dropdown label: `Broker — Account name (login@email.com)`. */
export const brokerLabel = (a: Pick<BrokerAccount, "brokerName" | "accountName" | "loginEmail">): string => `${a.brokerName} — ${a.accountName} (${a.loginEmail})`;

/** Compact form for table cells; the full label (with e-mail) goes in the tooltip / details. */
export const brokerShort = (a: Pick<BrokerAccount, "brokerName" | "accountName">): string => `${a.brokerName} — ${a.accountName}`;

/**
 * The broker account a holding was bought through, used to pre-select the account when selling. It is the account of the
 * most recent purchase that has one (falling back to any trade that has one); null for older holdings with none recorded.
 * Always an id, so it stays correct if the account's details are edited later.
 */
export function holdingBrokerAccountId(inv: Pick<Investment, "investmentTransactions">): string | null {
  const newestFirst = (a: { date: string; createdAt?: string }, b: { date: string; createdAt?: string }) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  const withAccount = inv.investmentTransactions.filter((t) => t.brokerAccountId).sort(newestFirst);
  return (withAccount.find((t) => t.type === "BUY") ?? withAccount[0])?.brokerAccountId ?? null;
}
