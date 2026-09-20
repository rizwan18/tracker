/**
 * Turns a sale or expense into balanced double-entry journals.
 *
 *  Sale     Dr Accounts Receivable (total)   Cr Income (net)   Cr GST Collected (gst)
 *  paid     Dr Bank (total)                  Cr Accounts Receivable (total)
 *
 *  Expense  Dr Expense/Asset (net)  Dr GST Paid (gst)   Cr Accounts Payable (total)
 *  paid     Dr Accounts Payable (total)                 Cr Bank (total)
 *
 * The sale/expense is posted on its own date and the payment on the paid date,
 * so receivables and payables are right on any date in between.
 */

export interface PostingAccounts {
  receivable: string;
  payable: string;
  gstCollected: string;
  gstPaid: string;
}

export interface EntryForPosting {
  kind: "INCOME" | "EXPENSE";
  date: Date;
  description: string;
  reference?: string | null;
  accountId: string;
  totalCents: number;
  gstCents: number;
  status: "PAID" | "UNPAID";
  paidDate?: Date | null;
  bankAccountId?: string | null;
}

export interface JournalLineDraft {
  accountId: string;
  debitCents: number;
  creditCents: number;
  memo?: string | null;
}

export interface JournalDraft {
  date: Date;
  description: string;
  reference?: string | null;
  source: "ENTRY" | "PAYMENT" | "MANUAL";
  lines: JournalLineDraft[];
}

export class PostingError extends Error {}

export function assertBalanced(lines: JournalLineDraft[]): void {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.debitCents) || !Number.isInteger(l.creditCents) || l.debitCents < 0 || l.creditCents < 0) {
      throw new PostingError("Amounts must be whole cents and not negative.");
    }
    if (l.debitCents > 0 && l.creditCents > 0) throw new PostingError("A line can be a debit or a credit, not both.");
    debit += l.debitCents;
    credit += l.creditCents;
  }
  if (debit !== credit) throw new PostingError(`The entry doesn't balance: debits ${debit / 100} vs credits ${credit / 100}.`);
  if (debit === 0) throw new PostingError("The entry has no amounts.");
}

const dr = (accountId: string, cents: number, memo?: string): JournalLineDraft => ({ accountId, debitCents: cents, creditCents: 0, memo });
const cr = (accountId: string, cents: number, memo?: string): JournalLineDraft => ({ accountId, debitCents: 0, creditCents: cents, memo });
const nonZero = (lines: JournalLineDraft[]) => lines.filter((l) => l.debitCents > 0 || l.creditCents > 0);

export function journalsForEntry(entry: EntryForPosting, accounts: PostingAccounts): JournalDraft[] {
  const net = entry.totalCents - entry.gstCents;
  if (entry.totalCents <= 0) throw new PostingError("The amount must be greater than zero.");
  if (entry.gstCents < 0 || entry.gstCents > entry.totalCents) throw new PostingError("The GST amount isn't valid.");
  const isIncome = entry.kind === "INCOME";

  const main: JournalDraft = {
    date: entry.date,
    description: entry.description,
    reference: entry.reference ?? null,
    source: "ENTRY",
    lines: nonZero(
      isIncome
        ? [dr(accounts.receivable, entry.totalCents), cr(entry.accountId, net), cr(accounts.gstCollected, entry.gstCents)]
        : [dr(entry.accountId, net), dr(accounts.gstPaid, entry.gstCents), cr(accounts.payable, entry.totalCents)]
    ),
  };
  assertBalanced(main.lines);
  const journals = [main];

  if (entry.status === "PAID") {
    if (!entry.bankAccountId) throw new PostingError("Choose the bank account it was paid to or from.");
    if (!entry.paidDate) throw new PostingError("Enter the date it was paid.");
    const payment: JournalDraft = {
      date: entry.paidDate,
      description: `${isIncome ? "Payment received" : "Payment made"}: ${entry.description}`,
      reference: entry.reference ?? null,
      source: "PAYMENT",
      lines: isIncome
        ? [dr(entry.bankAccountId, entry.totalCents), cr(accounts.receivable, entry.totalCents)]
        : [dr(accounts.payable, entry.totalCents), cr(entry.bankAccountId, entry.totalCents)],
    };
    assertBalanced(payment.lines);
    journals.push(payment);
  }
  return journals;
}
