/** Broker accounts: identification details only (broker, account nickname, login e-mail) — never credentials. */
import type { Prisma } from "@prisma/client";
import { FriendlyError } from "../middleware/errorHandler";

type Db = Pick<Prisma.TransactionClient, "brokerAccount">;

/**
 * Confirms `id` is one of this household's broker accounts and returns it (null when no account was chosen).
 * A trade stores only this id, so editing the account later never changes which account a trade belongs to.
 */
export async function resolveBrokerAccountId(db: Db, householdId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const found = await db.brokerAccount.findFirst({ where: { id, householdId }, select: { id: true } });
  if (!found) throw new FriendlyError("That broker account couldn't be found. Please choose one from the list.", 400);
  return found.id;
}

/** Two accounts are the same if broker and account name match (ignoring case and spacing). */
export const sameAccountKey = (a: { brokerName: string; accountName: string }, b: { brokerName: string; accountName: string }): boolean => {
  const k = (x: { brokerName: string; accountName: string }) => `${x.brokerName.trim().toLowerCase()}|${x.accountName.trim().toLowerCase()}`;
  return k(a) === k(b);
};
