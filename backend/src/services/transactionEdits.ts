/**
 * Correcting a recorded share/ETF transaction (date, type, units, price, brokerage, broker account, or the security it
 * belongs to). Everything that depends on it is recomputed in the same database transaction as the edit:
 *  - holdings, cost base and realised/unrealised gains are always derived from the buy/sell history, so they follow
 *    automatically;
 *  - the frozen figures stored on recorded sales are recomputed, so each sale's cost base still matches the pool it was
 *    sold from (otherwise correcting an earlier buy would leave later sales on stale cost bases);
 *  - a holding's recorded units are kept in step when they were tracking the history.
 * An edit that would leave any holding short of units (selling more than was held) is refused, and nothing is changed.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { FriendlyError } from "../middleware/errorHandler";
import { STOCK_TYPES } from "../lib/constants";
import { QTY_EPSILON } from "../lib/decimal";
import type { InvestmentTransactionEditInput } from "../lib/validation";
import { resolveBrokerAccountId } from "./brokerAccounts";
import { checkEditShortfall, recomputeSaleSnapshots, replayLedger, type LedgerTx } from "./holdings";

type Db = Prisma.TransactionClient;
const isStock = (type: string) => (STOCK_TYPES as readonly string[]).includes(type);
const fmtDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "that date");

const historyOf = (db: Db, investmentId: string) => db.investmentTransaction.findMany({ where: { investmentId } });

/** Rewrites the stored figures of recorded sales so they match the current history. */
async function refreezeSales(db: Db, investmentId: string): Promise<void> {
  const txs = await historyOf(db, investmentId);
  const figures = recomputeSaleSnapshots(txs);
  for (const t of txs) {
    const f = figures.get(t.id);
    if (!f) continue;
    if (t.grossProceedsCents === f.grossProceedsCents && t.netProceedsCents === f.netProceedsCents && t.costBaseCents === f.costBaseCents && t.gainLossCents === f.gainLossCents) continue;
    await db.investmentTransaction.update({ where: { id: t.id }, data: { ...f } });
  }
}

/**
 * If the holding's latest recorded valuation was tracking the transaction history (same units as before the edit), move its
 * units — and the values that scale with them — to the new history. A valuation that deliberately differs (e.g. from a broker
 * statement) is left alone.
 */
async function syncValuationUnits(db: Db, investmentId: string, before: number, after: number): Promise<void> {
  if (Math.abs(after - before) <= QTY_EPSILON.toNumber() || before <= 0) return;
  const latest = await db.investmentValuation.findFirst({ where: { investmentId }, orderBy: { asAt: "desc" } });
  if (!latest || Math.abs(latest.units - before) > QTY_EPSILON.toNumber() * 10) return;
  const factor = after / before;
  await db.investmentValuation.update({
    where: { id: latest.id },
    data: { units: after, marketValue: latest.marketValue * factor, marketValueAud: latest.marketValueAud * factor },
  });
}

export async function editInvestmentTransaction(householdId: string, txId: string, input: InvestmentTransactionEditInput): Promise<{ id: string; investmentId: string }> {
  return prisma.$transaction(
    async (db) => {
      const existing = await db.investmentTransaction.findFirst({ where: { id: txId, investment: { householdId } }, include: { investment: true } });
      if (!existing) throw new FriendlyError("We couldn't find that transaction.", 404);

      const sourceId = existing.investmentId;
      const targetId = input.investmentId ?? sourceId;
      const moves = targetId !== sourceId;
      let target = existing.investment;
      if (moves) {
        const found = await db.investment.findFirst({ where: { id: targetId, householdId } });
        if (!found) throw new FriendlyError("We couldn't find the security you chose.", 400);
        target = found;
        if (!isStock(target.type) || !isStock(existing.investment.type)) throw new FriendlyError("Transactions can only be moved between shares, ETFs and LICs.", 400);
      }

      // Row locks, always taken in the same order, so two edits (or an edit and a sale) never interleave on the same holding.
      for (const id of [...new Set([sourceId, targetId])].sort()) {
        await db.investment.updateMany({ where: { id, householdId }, data: { updatedAt: new Date() } });
      }

      const brokerAccountId = input.brokerAccountId === undefined ? existing.brokerAccountId : await resolveBrokerAccountId(db, householdId, input.brokerAccountId);
      const sourceBefore = await historyOf(db, sourceId);
      const targetBefore = moves ? await historyOf(db, targetId) : sourceBefore;

      const edited: LedgerTx & { id: string } = { ...existing, type: input.type, date: input.date, quantity: input.quantity, pricePerUnit: input.pricePerUnit, brokerage: input.brokerage ?? 0 };
      const check = checkEditShortfall({ sourceHistory: sourceBefore, targetHistory: targetBefore, after: edited, moves });
      if (!check.ok) {
        const name = check.where === "target" ? target.name : existing.investment.name;
        throw new FriendlyError(`That change would leave ${name} with fewer units than were sold (short on ${fmtDay(check.at)}). Correct the sale first, or check the units and dates.`, 400);
      }

      const quantityBefore = { source: replayLedger(sourceBefore).quantity, target: moves ? replayLedger(targetBefore).quantity : 0 };

      // A purchase carries no sale figures; a sale keeps its stored figures until they are recomputed below.
      const clearSale = input.type === "BUY" ? { grossProceedsCents: null, netProceedsCents: null, costBaseCents: null, gainLossCents: null, costMethod: null } : {};
      await db.investmentTransaction.update({
        where: { id: txId },
        data: {
          investmentId: targetId,
          type: input.type,
          date: input.date,
          quantity: input.quantity,
          pricePerUnit: input.pricePerUnit,
          brokerage: input.brokerage ?? 0,
          brokerAccountId,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...clearSale,
        },
      });

      for (const id of [...new Set([sourceId, targetId])]) {
        await refreezeSales(db, id);
        const after = replayLedger(await historyOf(db, id)).quantity;
        await syncValuationUnits(db, id, id === sourceId ? quantityBefore.source : quantityBefore.target, after);
      }
      return { id: txId, investmentId: targetId };
    },
    { timeout: 20000 }
  );
}
