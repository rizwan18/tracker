import { describe, it, expect } from "vitest";
import { computeGst } from "../services/business/gst";
import { businessEntrySchema } from "../lib/validation";
import { buildGstReport, type GstEntry } from "../services/business/reports";
import { basMonthPeriod, basQuarterPeriod, resolveBasPeriod } from "../services/business/basPeriods";
import { journalsForEntry, PostingError, type PostingAccounts } from "../services/business/posting";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dollars = (n: number) => Math.round(n * 100);
const acct: PostingAccounts = { receivable: "1100", payable: "2000", gstCollected: "2200", gstPaid: "1400" };

/** The payload the form sends for an expense where the person types the GST themselves. */
const payload = (over: Record<string, unknown> = {}) => ({
  kind: "EXPENSE", date: "2026-09-15", description: "Office Supplies", accountId: "6010", amountCents: dollars(110), gstMode: "MANUAL", gstCents: dollars(10),
  status: "UNPAID", ...over,
});

describe("manual GST amount", () => {
  it("treats the amount as the total and the typed GST as a part of it: $110 with $10 GST", () => {
    expect(computeGst(dollars(110), "MANUAL", true, dollars(10))).toEqual({ totalCents: 11000, gstCents: 1000, netCents: 10000 });
  });
  it("treats a blank GST as zero", () => {
    expect(computeGst(dollars(25), "MANUAL", true, null)).toEqual({ totalCents: 2500, gstCents: 0, netCents: 2500 });
    expect(computeGst(dollars(25), "MANUAL", true)).toEqual({ totalCents: 2500, gstCents: 0, netCents: 2500 });
  });
  it("never estimates GST as amount ÷ 11 when the GST is entered manually", () => {
    // $110 with an entered GST of $0 stays $0, even though 1/11 of it would be $10.
    expect(computeGst(dollars(110), "MANUAL", true, 0).gstCents).toBe(0);
  });
  it("is zero when the business isn't registered for GST, whatever was typed", () => {
    expect(computeGst(dollars(110), "MANUAL", false, dollars(10))).toEqual({ totalCents: 11000, gstCents: 0, netCents: 11000 });
  });
  it("leaves the existing modes exactly as they were, and ignores a manual figure for them", () => {
    expect(computeGst(11000, "INCLUSIVE", true)).toEqual({ totalCents: 11000, gstCents: 1000, netCents: 10000 });
    expect(computeGst(10000, "EXCLUSIVE", true)).toEqual({ totalCents: 11000, gstCents: 1000, netCents: 10000 });
    expect(computeGst(5000, "FREE", true)).toEqual({ totalCents: 5000, gstCents: 0, netCents: 5000 });
    expect(computeGst(11000, "INCLUSIVE", true, 99999).gstCents).toBe(1000);
  });
});

describe("expense GST validation", () => {
  it("creates an expense with GST", () => {
    const e = businessEntrySchema.parse(payload());
    expect(e.gstMode).toBe("MANUAL");
    expect(e.gstCents).toBe(1000);
  });
  it("creates an expense without GST — the field is optional (omitted, null or $0)", () => {
    expect(businessEntrySchema.safeParse(payload({ gstCents: undefined })).success).toBe(true);
    expect(businessEntrySchema.safeParse(payload({ gstCents: null })).success).toBe(true);
    expect(businessEntrySchema.parse(payload({ gstCents: 0 })).gstCents).toBe(0);
  });
  it("edits the GST: the same payload with a new figure is accepted and gives the new GST", () => {
    const edited = businessEntrySchema.parse(payload({ gstCents: dollars(8) }));
    expect(computeGst(edited.amountCents, edited.gstMode, true, edited.gstCents ?? null).gstCents).toBe(800);
  });
  it("accepts GST equal to the amount, but rejects GST greater than the expense amount", () => {
    expect(businessEntrySchema.safeParse(payload({ gstCents: dollars(110) })).success).toBe(true);
    const over = businessEntrySchema.safeParse(payload({ gstCents: dollars(110) + 1 }));
    expect(over.success).toBe(false);
    if (!over.success) {
      expect(over.error.issues[0]!.message).toMatch(/more than the amount/);
      expect(over.error.issues[0]!.path).toEqual(["gstCents"]);
    }
  });
  it("rejects negative GST", () => {
    const r = businessEntrySchema.safeParse(payload({ gstCents: -1 }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(/negative/);
  });
  it("only allows whole cents (decimals go in as cents, e.g. $10.55 → 1055)", () => {
    expect(businessEntrySchema.safeParse(payload({ gstCents: 1055 })).success).toBe(true);
    expect(businessEntrySchema.safeParse(payload({ gstCents: 10.5 })).success).toBe(false);
  });
  it("still accepts entries from before this field existed (no gstCents, original modes)", () => {
    const legacy = { ...payload(), gstMode: "INCLUSIVE" } as Record<string, unknown>;
    delete legacy.gstCents;
    const e = businessEntrySchema.parse(legacy);
    expect(e.gstMode).toBe("INCLUSIVE");
    expect(businessEntrySchema.parse({ ...legacy, gstMode: undefined }).gstMode).toBe("INCLUSIVE"); // default unchanged
  });
  it("the ledger refuses GST above the total even if validation were bypassed", () => {
    expect(() =>
      journalsForEntry({ kind: "EXPENSE", date: D("2026-09-15"), description: "x", accountId: "6010", totalCents: 1000, gstCents: 1001, status: "UNPAID" }, acct)
    ).toThrow(PostingError);
  });
  it("posts the typed GST to GST Paid and still balances", () => {
    const [j] = journalsForEntry({ kind: "EXPENSE", date: D("2026-09-15"), description: "Office", accountId: "6010", totalCents: 11000, gstCents: 1000, status: "UNPAID" }, acct);
    const dr = j!.lines.reduce((s, l) => s + l.debitCents, 0);
    const cr = j!.lines.reduce((s, l) => s + l.creditCents, 0);
    expect(dr).toBe(cr);
    expect(j!.lines.find((l) => l.accountId === "1400")!.debitCents).toBe(1000);
  });
});

/** Builds an unpaid-or-paid expense the way the route stores it. */
function expense(date: string, total: number, gst: number, extra: Partial<GstEntry> = {}): GstEntry {
  return { kind: "EXPENSE", date: D(date), status: "PAID", paidDate: D(date), totalCents: dollars(total), gstCents: dollars(gst), accountId: "6010", ...extra };
}
const fixed = new Set<string>();

describe("GST on expenses — totals", () => {
  const three = [expense("2026-09-10", 110, 10), expense("2026-09-12", 55, 5), expense("2026-09-14", 25, 0)];

  it("totals $190 of expenses and $15 of GST (the spec's worked example)", () => {
    const r = buildGstReport(three, "ACCRUAL", D("2026-07-01"), D("2026-09-30"), fixed);
    expect(r.g10CapitalPurchasesCents + r.g11NonCapitalPurchasesCents).toBe(dollars(190));
    expect(r.oneBGstOnPurchasesCents).toBe(dollars(15));
    expect(r.purchaseCount).toBe(3);
  });
  it("counts an expense with no GST (and old records with GST 0) as $0 GST", () => {
    const r = buildGstReport([expense("2026-09-14", 25, 0)], "ACCRUAL", D("2026-07-01"), D("2026-09-30"), fixed);
    expect(r.oneBGstOnPurchasesCents).toBe(0);
    expect(r.g11NonCapitalPurchasesCents).toBe(dollars(25));
  });
  it("uses the GST entered on each expense and doesn't estimate any", () => {
    // $110 recorded with $0 GST must not become $10.
    const r = buildGstReport([expense("2026-09-10", 110, 0)], "ACCRUAL", D("2026-07-01"), D("2026-09-30"), fixed);
    expect(r.oneBGstOnPurchasesCents).toBe(0);
  });
  it("nets GST credits against GST on sales: payable when sales GST is higher, refund when lower", () => {
    const sale: GstEntry = { kind: "INCOME", date: D("2026-09-01"), status: "PAID", paidDate: D("2026-09-01"), totalCents: dollars(330), gstCents: dollars(30), accountId: "4000" };
    expect(buildGstReport([sale, ...three], "ACCRUAL", D("2026-07-01"), D("2026-09-30"), fixed).netGstCents).toBe(dollars(15));
    expect(buildGstReport([...three], "ACCRUAL", D("2026-07-01"), D("2026-09-30"), fixed).netGstCents).toBe(-dollars(15));
  });
});

describe("BAS periods", () => {
  const entries = [
    expense("2026-06-30", 110, 10), // last day of the previous quarter
    expense("2026-07-01", 11, 1), // first day of Q1
    expense("2026-09-30", 22, 2), // last day of Q1
    expense("2026-10-01", 33, 3), // first day of Q2
    expense("2026-12-31", 44, 4), // last day of Q2
    expense("2027-01-01", 55, 5), // first day of Q3
  ];
  const gstFor = (p: { from: Date; to: Date }) => buildGstReport(entries, "ACCRUAL", p.from, p.to, fixed).oneBGstOnPurchasesCents;

  it("quarterly: Q1 is 1 Jul – 30 Sep, and includes both boundary days but nothing either side", () => {
    const q1 = basQuarterPeriod("2026-27", 1)!;
    expect(q1.from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(q1.to.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(gstFor(q1)).toBe(dollars(1 + 2));
  });
  it("quarterly: an entry stamped late on the last day still counts, one stamped on the next day doesn't", () => {
    const q1 = basQuarterPeriod("2026-27", 1)!;
    const late = expense("2026-09-30", 11, 1, { date: new Date("2026-09-30T23:59:59.000Z") });
    const next = expense("2026-10-01", 11, 1);
    expect(buildGstReport([late, next], "ACCRUAL", q1.from, q1.to, fixed).purchaseCount).toBe(1);
  });
  it("quarterly: all four quarters of FY2026–27 cover the year with no gaps or overlaps", () => {
    const qs = [1, 2, 3, 4].map((q) => basQuarterPeriod("2026-27", q)!);
    expect(qs.map((q) => [q.from.toISOString().slice(0, 10), q.to.toISOString().slice(0, 10)])).toEqual([
      ["2026-07-01", "2026-09-30"], ["2026-10-01", "2026-12-31"], ["2027-01-01", "2027-03-31"], ["2027-04-01", "2027-06-30"],
    ]);
    for (let i = 1; i < 4; i++) expect(qs[i]!.from.getTime() - qs[i - 1]!.to.getTime()).toBe(1);
  });
  it("quarterly: Q2 and Q3 pick up their own entries", () => {
    expect(gstFor(basQuarterPeriod("2026-27", 2)!)).toBe(dollars(3 + 4));
    expect(gstFor(basQuarterPeriod("2026-27", 3)!)).toBe(dollars(5));
  });
  it("monthly: September 2026 is 1–30 Sep; February respects leap years; December ends 31 Dec", () => {
    const sep = basMonthPeriod("2026-09")!;
    expect([sep.from.toISOString().slice(0, 10), sep.to.toISOString().slice(0, 10)]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(gstFor(sep)).toBe(dollars(2));
    expect(basMonthPeriod("2028-02")!.to.toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(basMonthPeriod("2027-02")!.to.toISOString().slice(0, 10)).toBe("2027-02-28");
    expect(basMonthPeriod("2026-12")!.to.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(gstFor(basMonthPeriod("2026-10")!)).toBe(dollars(3));
  });
  it("custom range: any from/to, inclusive at both ends", () => {
    expect(gstFor({ from: D("2026-09-30"), to: new Date("2026-10-01T23:59:59.999Z") })).toBe(dollars(2 + 3));
    expect(gstFor({ from: D("2026-07-02"), to: D("2026-09-29") })).toBe(0);
  });
  it("on a cash basis an expense belongs to the period it was paid in, and unpaid ones aren't counted", () => {
    const e = [
      expense("2026-09-28", 110, 10, { paidDate: D("2026-10-05") }), // billed in Q1, paid in Q2
      expense("2026-09-29", 55, 5, { status: "UNPAID", paidDate: null }),
    ];
    const q1 = basQuarterPeriod("2026-27", 1)!;
    const q2 = basQuarterPeriod("2026-27", 2)!;
    expect(buildGstReport(e, "ACCRUAL", q1.from, q1.to, fixed).oneBGstOnPurchasesCents).toBe(dollars(15));
    expect(buildGstReport(e, "CASH", q1.from, q1.to, fixed).oneBGstOnPurchasesCents).toBe(0);
    expect(buildGstReport(e, "CASH", q2.from, q2.to, fixed).oneBGstOnPurchasesCents).toBe(dollars(10));
  });
  it("rejects malformed months, quarters and financial years", () => {
    expect(basMonthPeriod("2026-13")).toBeNull();
    expect(basMonthPeriod("2026-9")).toBeNull();
    expect(basMonthPeriod("September")).toBeNull();
    expect(basQuarterPeriod("2026-27", 0)).toBeNull();
    expect(basQuarterPeriod("2026-27", 5)).toBeNull();
    expect(basQuarterPeriod("2026-27", 1.5)).toBeNull();
    expect(basQuarterPeriod("2026-28", 1)).toBeNull();
    expect(basQuarterPeriod("FY2026", 1)).toBeNull();
  });
  it("resolves a request's month or quarter, and leaves custom ranges to the caller", () => {
    expect(resolveBasPeriod({ period: "quarter", financialYear: "2026-27", quarter: "2" })!.from.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(resolveBasPeriod({ period: "month", month: "2026-09" })!.label).toBe("Sep 2026");
    expect(resolveBasPeriod({ from: "2026-07-01", to: "2026-09-30" })).toBeNull();
    expect(resolveBasPeriod({ period: "quarter", financialYear: "2026-27", quarter: "9" })).toBeNull();
  });
});
