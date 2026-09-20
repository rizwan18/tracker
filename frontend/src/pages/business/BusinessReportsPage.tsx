import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../../api/client";
import type { AgedBucket, AgedReport, BalanceSheet, CashSummary, GstReport, IncomeStatement, LedgerReport, MonthlyRow, Section, TrialBalance } from "../../api/businessTypes";
import { useFinancialYear } from "../../context/FinancialYearContext";
import { useBusinessBasics } from "../../hooks/useBusiness";
import { Button, Card, SectionHeading, inputClass } from "../../components/ui";
import { downloadCsv, type CsvCell } from "../../lib/csvDownload";
import { financialYearBounds, formatDate } from "../../lib/format";
import { formatCents } from "../../lib/money";

type ReportId = "income" | "balance" | "trial" | "gst" | "receivables" | "payables" | "cash" | "monthly" | "ledger";
type Mode = "range" | "asAt";

const REPORTS: Array<{ id: ReportId; label: string; mode: Mode; blurb: string }> = [
  { id: "income", label: "Income statement", mode: "range", blurb: "Profit and loss: what the business earned and spent." },
  { id: "balance", label: "Balance sheet", mode: "asAt", blurb: "What the business owns, owes and is worth on a date." },
  { id: "trial", label: "Trial balance", mode: "asAt", blurb: "Every account's balance — debits and credits must match." },
  { id: "gst", label: "GST / BAS", mode: "range", blurb: "The figures for your Business Activity Statement." },
  { id: "receivables", label: "Owed to you", mode: "asAt", blurb: "Unpaid customer invoices, by how overdue they are." },
  { id: "payables", label: "You owe", mode: "asAt", blurb: "Unpaid supplier bills, by how overdue they are." },
  { id: "cash", label: "Cash & bank", mode: "range", blurb: "Money in, money out and balances for your bank accounts." },
  { id: "monthly", label: "Monthly", mode: "range", blurb: "Income, expenses and profit month by month." },
  { id: "ledger", label: "Ledger", mode: "range", blurb: "Every entry for one account, with a running balance." },
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (cents: number) => cents / 100;

// ------------------------------------------------------------------ small building blocks
function Row({ label, value, bold, indent, muted }: { label: ReactNode; value?: number | null; bold?: boolean; indent?: boolean; muted?: boolean }) {
  return (
    <tr className={bold ? "font-semibold border-t border-[var(--color-line)]" : ""}>
      <td className={`py-1.5 pr-4 ${indent ? "pl-5" : ""} ${muted ? "text-[var(--color-ink-soft)]" : ""}`}>{label}</td>
      <td className="py-1.5 text-right tabular-nums">{value === undefined || value === null ? "" : formatCents(value)}</td>
    </tr>
  );
}

function SectionRows({ title, section, totalLabel }: { title: string; section: Section; totalLabel: string }) {
  return (
    <>
      <tr>
        <td colSpan={2} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">{title}</td>
      </tr>
      {section.lines.length === 0 && <Row label="Nothing recorded" muted indent />}
      {section.lines.map((l) => <Row key={l.accountId} label={l.name} value={l.amountCents} indent />)}
      <Row label={totalLabel} value={section.totalCents} bold />
    </>
  );
}

const sectionCsv = (title: string, s: Section, totalLabel: string): CsvCell[][] => [[title], ...s.lines.map((l) => [l.name, money(l.amountCents)]), [totalLabel, money(s.totalCents)], []];

function IncomeStatementView({ s }: { s: IncomeStatement }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        <SectionRows title="Revenue" section={s.revenue} totalLabel="Total revenue" />
        {s.costOfSales.lines.length > 0 && <SectionRows title="Cost of sales" section={s.costOfSales} totalLabel="Total cost of sales" />}
        <Row label="Gross profit" value={s.grossProfitCents} bold />
        {s.otherIncome.lines.length > 0 && <SectionRows title="Other income" section={s.otherIncome} totalLabel="Total other income" />}
        <SectionRows title="Operating expenses" section={s.operatingExpenses} totalLabel="Total operating expenses" />
        <tr className="border-t-2 border-[var(--color-ink)] font-display text-lg">
          <td className="py-3">Net profit</td>
          <td className={`py-3 text-right tabular-nums ${s.netProfitCents >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{formatCents(s.netProfitCents)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function BalanceSheetView({ b }: { b: BalanceSheet }) {
  return (
    <>
      <table className="w-full text-sm">
        <tbody>
          <SectionRows title="Current assets" section={b.currentAssets} totalLabel="Total current assets" />
          <SectionRows title="Non-current assets" section={b.nonCurrentAssets} totalLabel="Total non-current assets" />
          <Row label="Total assets" value={b.totalAssetsCents} bold />
          <SectionRows title="Current liabilities" section={b.currentLiabilities} totalLabel="Total current liabilities" />
          <SectionRows title="Non-current liabilities" section={b.nonCurrentLiabilities} totalLabel="Total non-current liabilities" />
          <Row label="Total liabilities" value={b.totalLiabilitiesCents} bold />
          <tr className="border-t-2 border-[var(--color-ink)] font-semibold"><td className="py-2">Net assets</td><td className="py-2 text-right tabular-nums">{formatCents(b.netAssetsCents)}</td></tr>
          <SectionRows title="Equity" section={b.equity} totalLabel="Total equity" />
        </tbody>
      </table>
      <p className={`text-xs mt-3 ${b.balanced ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`} role="status">
        {b.balanced ? "✓ Balanced: net assets equal total equity." : "This balance sheet doesn't balance — please check your journal entries."}
      </p>
    </>
  );
}

function TrialBalanceView({ t }: { t: TrialBalance }) {
  return (
    <>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--color-ink-soft)]">
          <tr><th className="py-1 font-medium">Account</th><th className="py-1 font-medium text-right">Debit</th><th className="py-1 font-medium text-right">Credit</th></tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.accountId} className="border-t border-[var(--color-line)]">
              <td className="py-1.5">{r.code} {r.name}</td>
              <td className="py-1.5 text-right tabular-nums">{r.debitCents ? formatCents(r.debitCents) : ""}</td>
              <td className="py-1.5 text-right tabular-nums">{r.creditCents ? formatCents(r.creditCents) : ""}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-[var(--color-ink)] font-semibold">
            <td className="py-2">Totals</td>
            <td className="py-2 text-right tabular-nums">{formatCents(t.totalDebitCents)}</td>
            <td className="py-2 text-right tabular-nums">{formatCents(t.totalCreditCents)}</td>
          </tr>
        </tbody>
      </table>
      <p className={`text-xs mt-3 ${t.balanced ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`} role="status">{t.balanced ? "✓ Debits equal credits." : "Debits and credits differ — please check your entries."}</p>
    </>
  );
}

function GstView({ g, registered }: { g: GstReport; registered: boolean }) {
  return (
    <>
      {!registered && <p className="text-sm bg-[var(--color-ochre-tint)] text-[#7a4d1a] rounded-lg px-3 py-2 mb-3">Your business isn't set up as registered for GST, so nothing is collected or claimed. Change this in Settings if that's wrong.</p>}
      <table className="w-full text-sm">
        <tbody>
          <SectionRows title="Sales" section={{ lines: [{ accountId: "g1", code: "G1", name: "G1  Total sales (including GST)", amountCents: g.g1TotalSalesCents }, { accountId: "g3", code: "G3", name: "G3  GST-free sales", amountCents: g.g3GstFreeSalesCents }], totalCents: g.g1TotalSalesCents }} totalLabel="Total sales" />
          <Row label="1A  GST on sales" value={g.oneAGstOnSalesCents} bold />
          <SectionRows title="Purchases" section={{ lines: [{ accountId: "g10", code: "G10", name: "G10  Capital purchases (including GST)", amountCents: g.g10CapitalPurchasesCents }, { accountId: "g11", code: "G11", name: "G11  Other purchases (including GST)", amountCents: g.g11NonCapitalPurchasesCents }], totalCents: g.g10CapitalPurchasesCents + g.g11NonCapitalPurchasesCents }} totalLabel="Total purchases" />
          <Row label="1B  GST on purchases" value={g.oneBGstOnPurchasesCents} bold />
          <tr className="border-t-2 border-[var(--color-ink)] font-display text-lg">
            <td className="py-3">{g.netGstCents >= 0 ? "GST payable to the ATO (1A − 1B)" : "GST refund from the ATO (1A − 1B)"}</td>
            <td className="py-3 text-right tabular-nums">{formatCents(Math.abs(g.netGstCents))}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-[var(--color-ink-soft)] mt-3">
        Worked out on a {g.basis === "CASH" ? "cash basis (when money was received or paid)" : "accrual basis (when invoices and bills are dated)"} from {g.salesCount} sale{g.salesCount === 1 ? "" : "s"} and {g.purchaseCount} purchase{g.purchaseCount === 1 ? "" : "s"}. A guide for completing your BAS — check it with your accountant before lodging.
      </p>
    </>
  );
}

const BUCKETS: Array<{ key: AgedBucket; label: string }> = [
  { key: "current", label: "Current" },
  { key: "days1to30", label: "1–30 days" },
  { key: "days31to60", label: "31–60" },
  { key: "days61to90", label: "61–90" },
  { key: "over90", label: "90+" },
];

function AgedView({ a, receivables }: { a: AgedReport; receivables: boolean }) {
  if (a.rows.length === 0) return <p className="text-sm text-[var(--color-ink-soft)]">{receivables ? "No customer invoices are outstanding on this date." : "No supplier bills are outstanding on this date."}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--color-ink-soft)]">
          <tr>
            <th className="py-1 font-medium">{receivables ? "Customer" : "Supplier"}</th>
            {BUCKETS.map((b) => <th key={b.key} className="py-1 font-medium text-right">{b.label}</th>)}
            <th className="py-1 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {a.contacts.map((c) => (
            <tr key={c.contactName} className="border-t border-[var(--color-line)]">
              <td className="py-1.5">{c.contactName}</td>
              {BUCKETS.map((b) => <td key={b.key} className="py-1.5 text-right tabular-nums">{c.totals[b.key] ? formatCents(c.totals[b.key]) : ""}</td>)}
              <td className="py-1.5 text-right tabular-nums font-medium">{formatCents(c.totalCents)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-[var(--color-ink)] font-semibold">
            <td className="py-2">Total</td>
            {BUCKETS.map((b) => <td key={b.key} className="py-2 text-right tabular-nums">{formatCents(a.totals[b.key])}</td>)}
            <td className="py-2 text-right tabular-nums">{formatCents(a.totalCents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CashView({ c }: { c: CashSummary }) {
  return c.accounts.length === 0 ? (
    <p className="text-sm text-[var(--color-ink-soft)]">No movement in your bank accounts for this period.</p>
  ) : (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-[var(--color-ink-soft)]">
        <tr><th className="py-1 font-medium">Account</th><th className="py-1 font-medium text-right">Opening</th><th className="py-1 font-medium text-right">Money in</th><th className="py-1 font-medium text-right">Money out</th><th className="py-1 font-medium text-right">Closing</th></tr>
      </thead>
      <tbody>
        {c.accounts.map((a) => (
          <tr key={a.accountId} className="border-t border-[var(--color-line)]">
            <td className="py-1.5">{a.name}</td>
            <td className="py-1.5 text-right tabular-nums">{formatCents(a.openingCents)}</td>
            <td className="py-1.5 text-right tabular-nums text-[var(--color-eucalyptus)]">{formatCents(a.moneyInCents)}</td>
            <td className="py-1.5 text-right tabular-nums text-[var(--color-brick)]">{formatCents(a.moneyOutCents)}</td>
            <td className="py-1.5 text-right tabular-nums font-medium">{formatCents(a.closingCents)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-[var(--color-ink)] font-semibold">
          <td className="py-2">Total</td>
          <td className="py-2 text-right tabular-nums">{formatCents(c.openingCents)}</td>
          <td className="py-2 text-right tabular-nums">{formatCents(c.moneyInCents)}</td>
          <td className="py-2 text-right tabular-nums">{formatCents(c.moneyOutCents)}</td>
          <td className="py-2 text-right tabular-nums">{formatCents(c.closingCents)}</td>
        </tr>
      </tbody>
    </table>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;

function MonthlyView({ months }: { months: MonthlyRow[] }) {
  const total = months.reduce((t, m) => ({ i: t.i + m.incomeCents, e: t.e + m.expensesCents, n: t.n + m.netCents }), { i: 0, e: 0, n: 0 });
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-[var(--color-ink-soft)]">
        <tr><th className="py-1 font-medium">Month</th><th className="py-1 font-medium text-right">Income</th><th className="py-1 font-medium text-right">Expenses</th><th className="py-1 font-medium text-right">Profit</th></tr>
      </thead>
      <tbody>
        {months.map((m) => (
          <tr key={m.month} className="border-t border-[var(--color-line)]">
            <td className="py-1.5">{monthName(m.month)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatCents(m.incomeCents)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatCents(m.expensesCents)}</td>
            <td className={`py-1.5 text-right tabular-nums ${m.netCents < 0 ? "text-[var(--color-brick)]" : ""}`}>{formatCents(m.netCents)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-[var(--color-ink)] font-semibold">
          <td className="py-2">Total</td>
          <td className="py-2 text-right tabular-nums">{formatCents(total.i)}</td>
          <td className="py-2 text-right tabular-nums">{formatCents(total.e)}</td>
          <td className="py-2 text-right tabular-nums">{formatCents(total.n)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function LedgerView({ l }: { l: LedgerReport }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--color-ink-soft)]">
          <tr><th className="py-1 font-medium">Date</th><th className="py-1 font-medium">Description</th><th className="py-1 font-medium text-right">Debit</th><th className="py-1 font-medium text-right">Credit</th><th className="py-1 font-medium text-right">Balance</th></tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--color-line)] text-[var(--color-ink-soft)]"><td className="py-1.5" colSpan={4}>Opening balance</td><td className="py-1.5 text-right tabular-nums">{formatCents(l.openingCents)}</td></tr>
          {l.rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--color-line)]">
              <td className="py-1.5 whitespace-nowrap">{formatDate(r.date)}</td>
              <td className="py-1.5">{r.description}{r.reference ? ` (#${r.reference})` : ""}</td>
              <td className="py-1.5 text-right tabular-nums">{r.debitCents ? formatCents(r.debitCents) : ""}</td>
              <td className="py-1.5 text-right tabular-nums">{r.creditCents ? formatCents(r.creditCents) : ""}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCents(r.balanceCents)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-[var(--color-ink)] font-semibold">
            <td className="py-2" colSpan={2}>Closing balance</td>
            <td className="py-2 text-right tabular-nums">{formatCents(l.totalDebitCents)}</td>
            <td className="py-2 text-right tabular-nums">{formatCents(l.totalCreditCents)}</td>
            <td className="py-2 text-right tabular-nums">{formatCents(l.closingCents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ the page
type Loaded =
  | { id: "income"; data: IncomeStatement }
  | { id: "balance"; data: BalanceSheet }
  | { id: "trial"; data: TrialBalance }
  | { id: "gst"; data: GstReport; registered: boolean }
  | { id: "receivables" | "payables"; data: AgedReport }
  | { id: "cash"; data: CashSummary }
  | { id: "monthly"; data: MonthlyRow[] }
  | { id: "ledger"; data: LedgerReport; account: string };

function csvFor(r: Loaded): CsvCell[][] {
  switch (r.id) {
    case "income": {
      const s = r.data;
      return [...sectionCsv("Revenue", s.revenue, "Total revenue"), ...sectionCsv("Cost of sales", s.costOfSales, "Total cost of sales"), ["Gross profit", money(s.grossProfitCents)], [], ...sectionCsv("Other income", s.otherIncome, "Total other income"), ...sectionCsv("Operating expenses", s.operatingExpenses, "Total operating expenses"), ["Net profit", money(s.netProfitCents)]];
    }
    case "balance": {
      const b = r.data;
      return [...sectionCsv("Current assets", b.currentAssets, "Total current assets"), ...sectionCsv("Non-current assets", b.nonCurrentAssets, "Total non-current assets"), ["Total assets", money(b.totalAssetsCents)], [], ...sectionCsv("Current liabilities", b.currentLiabilities, "Total current liabilities"), ...sectionCsv("Non-current liabilities", b.nonCurrentLiabilities, "Total non-current liabilities"), ["Total liabilities", money(b.totalLiabilitiesCents)], [], ["Net assets", money(b.netAssetsCents)], [], ...sectionCsv("Equity", b.equity, "Total equity")];
    }
    case "trial":
      return [["Code", "Account", "Debit", "Credit"], ...r.data.rows.map((x) => [x.code, x.name, money(x.debitCents), money(x.creditCents)] as CsvCell[]), ["", "Totals", money(r.data.totalDebitCents), money(r.data.totalCreditCents)]];
    case "gst": {
      const g = r.data;
      return [["Item", "Amount"], ["G1 Total sales (including GST)", money(g.g1TotalSalesCents)], ["G3 GST-free sales", money(g.g3GstFreeSalesCents)], ["1A GST on sales", money(g.oneAGstOnSalesCents)], ["G10 Capital purchases (including GST)", money(g.g10CapitalPurchasesCents)], ["G11 Other purchases (including GST)", money(g.g11NonCapitalPurchasesCents)], ["1B GST on purchases", money(g.oneBGstOnPurchasesCents)], [g.netGstCents >= 0 ? "GST payable (1A - 1B)" : "GST refund (1A - 1B)", money(Math.abs(g.netGstCents))]];
    }
    case "receivables":
    case "payables":
      return [["Contact", "Reference", "Description", "Invoice date", "Due date", "Days overdue", "Amount"], ...r.data.rows.map((x) => [x.contactName, x.reference, x.description, x.date.slice(0, 10), x.dueDate.slice(0, 10), Math.max(0, x.daysOverdue), money(x.totalCents)] as CsvCell[]), ["Total", "", "", "", "", "", money(r.data.totalCents)]];
    case "cash":
      return [["Account", "Opening", "Money in", "Money out", "Closing"], ...r.data.accounts.map((a) => [a.name, money(a.openingCents), money(a.moneyInCents), money(a.moneyOutCents), money(a.closingCents)] as CsvCell[]), ["Total", money(r.data.openingCents), money(r.data.moneyInCents), money(r.data.moneyOutCents), money(r.data.closingCents)]];
    case "monthly":
      return [["Month", "Income", "Expenses", "Profit"], ...r.data.map((m) => [m.month, money(m.incomeCents), money(m.expensesCents), money(m.netCents)] as CsvCell[])];
    case "ledger":
      return [["Date", "Description", "Reference", "Debit", "Credit", "Balance"], ["", "Opening balance", "", "", "", money(r.data.openingCents)], ...r.data.rows.map((x) => [x.date.slice(0, 10), x.description, x.reference, money(x.debitCents), money(x.creditCents), money(x.balanceCents)] as CsvCell[]), ["", "Closing balance", "", money(r.data.totalDebitCents), money(r.data.totalCreditCents), money(r.data.closingCents)]];
  }
}

export default function BusinessReportsPage() {
  const { financialYearId } = useFinancialYear();
  const { profile, accounts, loading: basicsLoading } = useBusinessBasics();
  const [id, setId] = useState<ReportId>("income");
  const bounds = useMemo(() => financialYearBounds(financialYearId), [financialYearId]);
  const [from, setFrom] = useState(bounds.start);
  const [to, setTo] = useState(bounds.end);
  const [asAt, setAsAt] = useState(bounds.end < todayIso() ? bounds.end : todayIso());
  const [accountId, setAccountId] = useState("");
  const [result, setResult] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new financial year resets the dates to that year.
  useEffect(() => {
    setFrom(bounds.start);
    setTo(bounds.end);
    setAsAt(bounds.end < todayIso() ? bounds.end : todayIso());
  }, [bounds]);

  const def = REPORTS.find((r) => r.id === id)!;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setError(null);
      if (id === "ledger" && !accountId) {
        setResult(null);
        return;
      }
      setLoading(true);
      try {
        const q = def.mode === "range" ? `from=${from}&to=${to}` : `asAt=${asAt}`;
        let loaded: Loaded;
        if (id === "income") loaded = { id, data: (await api.get<{ statement: IncomeStatement }>(`/business/reports/income-statement?${q}`)).statement };
        else if (id === "balance") loaded = { id, data: (await api.get<{ sheet: BalanceSheet }>(`/business/reports/balance-sheet?${q}`)).sheet };
        else if (id === "trial") loaded = { id, data: (await api.get<{ trialBalance: TrialBalance }>(`/business/reports/trial-balance?${q}`)).trialBalance };
        else if (id === "gst") {
          const res = await api.get<{ report: GstReport; gstRegistered: boolean }>(`/business/reports/gst?${q}`);
          loaded = { id, data: res.report, registered: res.gstRegistered };
        } else if (id === "receivables" || id === "payables") loaded = { id, data: (await api.get<{ report: AgedReport }>(`/business/reports/aged?type=${id}&${q}`)).report };
        else if (id === "cash") loaded = { id, data: (await api.get<{ summary: CashSummary }>(`/business/reports/cash?${q}`)).summary };
        else if (id === "monthly") loaded = { id, data: (await api.get<{ months: MonthlyRow[] }>(`/business/reports/monthly?${q}`)).months };
        else {
          const res = await api.get<{ ledger: LedgerReport; account: { code: string; name: string } }>(`/business/reports/ledger?accountId=${accountId}&${q}`);
          loaded = { id: "ledger", data: res.ledger, account: `${res.account.code} ${res.account.name}` };
        }
        if (!cancelled) setResult(loaded);
      } catch (err) {
        if (!cancelled) {
          setResult(null);
          setError(err instanceof ApiError ? err.message : "We couldn't build this report.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, from, to, asAt, accountId, def.mode]);

  if (basicsLoading || !profile) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;

  const periodText = def.mode === "range" ? `${formatDate(from)} to ${formatDate(to)}` : `As at ${formatDate(asAt)}`;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <SectionHeading title="Reports" subtitle="Financial statements for your business, ready for your accountant or the ATO." />
      </div>

      <div className="print:hidden flex flex-wrap rounded-xl border border-[var(--color-line)] p-1 w-fit max-w-full" role="tablist" aria-label="Reports">
        {REPORTS.map((r) => (
          <button key={r.id} role="tab" aria-selected={id === r.id} onClick={() => setId(r.id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${id === r.id ? "bg-[var(--color-eucalyptus)] text-white" : "text-[var(--color-ink-soft)]"}`}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="print:hidden flex flex-wrap items-end gap-3">
        {def.mode === "range" ? (
          <>
            <label className="text-sm">
              <span className="block text-xs text-[var(--color-ink-soft)] mb-1">From</span>
              <input type="date" aria-label="From date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-[var(--color-ink-soft)] mb-1">To</span>
              <input type="date" aria-label="To date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="text-sm">
            <span className="block text-xs text-[var(--color-ink-soft)] mb-1">As at</span>
            <input type="date" aria-label="As at date" className={inputClass} value={asAt} onChange={(e) => setAsAt(e.target.value)} />
          </label>
        )}
        {id === "ledger" && (
          <label className="text-sm">
            <span className="block text-xs text-[var(--color-ink-soft)] mb-1">Account</span>
            <select aria-label="Account" className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Choose an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex gap-2 ml-auto">
          <Button variant="secondary" disabled={!result} onClick={() => result && downloadCsv(`${profile.businessName.replace(/[^\w]+/g, "-")}-${def.label.replace(/[^\w]+/g, "-")}.csv`, csvFor(result))}>
            Download CSV
          </Button>
          <Button variant="secondary" disabled={!result} onClick={() => window.print()}>
            Print / save as PDF
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}

      <Card>
        <header className="mb-4 pb-3 border-b border-[var(--color-line)]">
          <p className="text-sm text-[var(--color-ink-soft)]">
            {profile.businessName}
            {profile.abnFormatted ? ` · ABN ${profile.abnFormatted}` : ""}
          </p>
          <h3 className="font-display text-xl font-semibold">
            {def.label}
            {result?.id === "ledger" ? ` — ${result.account}` : ""}
          </h3>
          <p className="text-sm text-[var(--color-ink-soft)]">{periodText} · amounts in Australian dollars</p>
        </header>

        {loading && <p className="text-[var(--color-ink-soft)]">Building the report…</p>}
        {!loading && !result && !error && <p className="text-sm text-[var(--color-ink-soft)]">{id === "ledger" ? "Choose an account to see its entries." : def.blurb}</p>}
        {!loading && result?.id === "income" && <IncomeStatementView s={result.data} />}
        {!loading && result?.id === "balance" && <BalanceSheetView b={result.data} />}
        {!loading && result?.id === "trial" && <TrialBalanceView t={result.data} />}
        {!loading && result?.id === "gst" && <GstView g={result.data} registered={result.registered} />}
        {!loading && (result?.id === "receivables" || result?.id === "payables") && <AgedView a={result.data} receivables={result.id === "receivables"} />}
        {!loading && result?.id === "cash" && <CashView c={result.data} />}
        {!loading && result?.id === "monthly" && <MonthlyView months={result.data} />}
        {!loading && result?.id === "ledger" && <LedgerView l={result.data} />}
      </Card>

      <p className="print:hidden text-xs text-[var(--color-ink-soft)]">Built from the sales, expenses and journal entries you've recorded. General information only — not tax or accounting advice.</p>
    </div>
  );
}
