import { describe, it, expect } from "vitest";
import {
  breakdownByCategory, buildTimeline, computeHolidayTotals, expenseCost, savingsPlan, type HolidayExpenseInput, type HolidayMilestoneInput,
} from "../services/personal/holidays";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function expense(over: Partial<HolidayExpenseInput> & { id: string }): HolidayExpenseInput {
  return { category: "OTHER", description: "Thing", estimatedAmount: 0, actualAmount: null, dueDate: null, paidDate: null, ...over };
}

describe("holiday totals", () => {
  it("uses the real amount when known and the estimate otherwise", () => {
    expect(expenseCost({ estimatedAmount: 800, actualAmount: null })).toBe(800);
    expect(expenseCost({ estimatedAmount: 800, actualAmount: 950 })).toBe(950);
    // A real amount of $0 (e.g. a free upgrade) is still a real amount.
    expect(expenseCost({ estimatedAmount: 800, actualAmount: 0 })).toBe(0);
  });

  it("splits projected cost into paid and outstanding, and compares with the budget", () => {
    const t = computeHolidayTotals(
      [
        expense({ id: "1", estimatedAmount: 2000, actualAmount: 2150, paidDate: d("2026-10-01") }), // flights, paid
        expense({ id: "2", estimatedAmount: 3000 }), // accommodation, unpaid, still an estimate
        expense({ id: "3", estimatedAmount: 500, actualAmount: 450 }), // unpaid, quote received
      ],
      6000,
      2
    );
    expect(t.estimated).toBe(5500);
    expect(t.paid).toBe(2150);
    expect(t.outstanding).toBe(3450);
    expect(t.projected).toBe(5600);
    expect(t.budgetRemaining).toBe(400);
    expect(t.perPerson).toBe(2800);
    expect(t.paidCount).toBe(1);
    expect(t.expenseCount).toBe(3);
  });

  it("reports a negative remainder when over budget and null when there is no budget", () => {
    const list = [expense({ id: "1", estimatedAmount: 1200 })];
    expect(computeHolidayTotals(list, 1000, 1).budgetRemaining).toBe(-200);
    expect(computeHolidayTotals(list, null, 1).budgetRemaining).toBeNull();
  });

  it("keeps floating-point noise out of the sums", () => {
    const t = computeHolidayTotals([expense({ id: "1", estimatedAmount: 0.1 }), expense({ id: "2", estimatedAmount: 0.2 })], null, 1);
    expect(t.projected).toBe(0.3);
  });

  it("handles an empty plan", () => {
    const t = computeHolidayTotals([], 500, 3);
    expect(t.projected).toBe(0);
    expect(t.budgetRemaining).toBe(500);
    expect(t.perPerson).toBe(0);
  });
});

describe("category breakdown", () => {
  it("groups by category, biggest first, and only paid amounts count as paid", () => {
    const rows = breakdownByCategory([
      expense({ id: "1", category: "FOOD", estimatedAmount: 400 }),
      expense({ id: "2", category: "FLIGHTS", estimatedAmount: 1800, actualAmount: 1900, paidDate: d("2026-10-02") }),
      expense({ id: "3", category: "FLIGHTS", estimatedAmount: 300 }),
    ]);
    expect(rows.map((r) => r.category)).toEqual(["FLIGHTS", "FOOD"]);
    expect(rows[0]).toEqual({ category: "FLIGHTS", estimated: 2100, projected: 2200, paid: 1900 });
  });
});

describe("savings plan", () => {
  const today = d("2026-10-01");
  it("spreads what is still unpaid over the months and fortnights left", () => {
    // 90 days out: 3 months, 7 fortnights
    const plan = savingsPlan(3000, d("2026-12-30"), today)!;
    expect(plan.daysLeft).toBe(90);
    expect(plan.perMonth).toBe(1000);
    expect(plan.perFortnight).toBe(428.57);
  });

  it("asks for the whole amount at once when the trip is under a month away", () => {
    expect(savingsPlan(600, d("2026-10-11"), today)!.perMonth).toBe(600);
  });

  it("has no plan when nothing is owing, there is no start date, or the trip has started", () => {
    expect(savingsPlan(0, d("2026-12-30"), today)).toBeNull();
    expect(savingsPlan(500, null, today)).toBeNull();
    expect(savingsPlan(500, d("2026-10-01"), today)).toBeNull();
    expect(savingsPlan(500, d("2026-09-01"), today)).toBeNull();
  });
});

describe("timeline", () => {
  const plan = { name: "Japan", startDate: d("2027-03-10"), endDate: d("2027-03-24") };
  const today = d("2026-10-15");
  const milestones: HolidayMilestoneInput[] = [
    { id: "m1", title: "Renew passport", type: "DOCUMENTS", date: d("2026-10-01"), done: false },
    { id: "m2", title: "Book flights", type: "BOOKING", date: d("2026-11-01"), done: false },
    { id: "m3", title: "Buy insurance", type: "INSURANCE", date: d("2026-09-20"), done: true },
  ];
  const expenses = [
    expense({ id: "e1", description: "Flights deposit", category: "FLIGHTS", estimatedAmount: 500, dueDate: d("2026-11-01") }),
    expense({ id: "e2", description: "Hotel", category: "ACCOMMODATION", estimatedAmount: 2400, actualAmount: 2500, dueDate: d("2026-09-25"), paidDate: d("2026-09-25") }),
    expense({ id: "e3", description: "Souvenirs", category: "SHOPPING", estimatedAmount: 300 }), // no due date: not on the timeline
  ];

  it("merges milestones, payment due dates and the trip dates in date order", () => {
    const items = buildTimeline(plan, expenses, milestones, today);
    expect(items.map((i) => i.title)).toEqual([
      "Buy insurance", "Hotel", "Renew passport", "Flights deposit", "Book flights", "Depart for Japan", "Return home",
    ]);
  });

  it("flags unfinished items whose date has passed as overdue, and never flags finished ones", () => {
    const byTitle = Object.fromEntries(buildTimeline(plan, expenses, milestones, today).map((i) => [i.title, i]));
    expect(byTitle["Renew passport"]!.overdue).toBe(true);
    expect(byTitle["Buy insurance"]!.overdue).toBe(false);
    expect(byTitle["Hotel"]!.done).toBe(true);
    expect(byTitle["Hotel"]!.overdue).toBe(false);
    expect(byTitle["Flights deposit"]!.overdue).toBe(false); // due in the future
  });

  it("does not treat something due today as overdue", () => {
    const items = buildTimeline({ name: "X", startDate: null, endDate: null }, [], [{ id: "m", title: "Today", type: "OTHER", date: today, done: false }], today);
    expect(items[0]!.overdue).toBe(false);
  });

  it("carries the amount on payment rows, using the real amount when known", () => {
    const hotel = buildTimeline(plan, expenses, milestones, today).find((i) => i.title === "Hotel")!;
    expect(hotel.kind).toBe("PAYMENT_DUE");
    expect(hotel.amount).toBe(2500);
  });

  it("marks the trip as done once the dates have passed, and omits missing trip dates", () => {
    const after = buildTimeline(plan, [], [], d("2027-04-01"));
    expect(after.every((i) => i.done)).toBe(true);
    expect(buildTimeline({ name: "TBC", startDate: null, endDate: null }, [], [], today)).toEqual([]);
  });
});
