import { describe, it, expect } from "vitest";
import { holidayPlanSchema, holidayExpenseSchema, holidayMilestoneSchema } from "../lib/validation";

describe("holiday plan validation", () => {
  it("accepts a minimal plan and fills in sensible defaults", () => {
    const plan = holidayPlanSchema.parse({ name: "  Bali  " });
    expect(plan.name).toBe("Bali");
    expect(plan.status).toBe("PLANNING");
    expect(plan.travellers).toBe(1);
    expect(plan.destination).toBeNull();
  });

  it("accepts null for optional dates and budget (what the form sends when they're blank)", () => {
    const plan = holidayPlanSchema.parse({ name: "Bali", startDate: null, endDate: null, budget: null });
    expect(plan.startDate).toBeNull();
    expect(plan.budget).toBeNull();
  });

  it("rejects a return date before the departure date", () => {
    const r = holidayPlanSchema.safeParse({ name: "Bali", startDate: "2027-03-10", endDate: "2027-03-01" });
    expect(r.success).toBe(false);
  });

  it("rejects a blank name, zero travellers, and negative budgets", () => {
    expect(holidayPlanSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(holidayPlanSchema.safeParse({ name: "x", travellers: 0 }).success).toBe(false);
    expect(holidayPlanSchema.safeParse({ name: "x", budget: -5 }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(holidayPlanSchema.safeParse({ name: "x", status: "MAYBE" }).success).toBe(false);
  });
});

describe("holiday expense validation", () => {
  it("defaults the category and estimate", () => {
    const e = holidayExpenseSchema.parse({ description: "Snorkelling" });
    expect(e.category).toBe("OTHER");
    expect(e.estimatedAmount).toBe(0);
    expect(e.actualAmount ?? null).toBeNull();
  });

  it("keeps a real amount of zero rather than treating it as missing", () => {
    expect(holidayExpenseSchema.parse({ description: "Upgrade", actualAmount: 0 }).actualAmount).toBe(0);
  });

  it("rejects negative amounts and unknown categories", () => {
    expect(holidayExpenseSchema.safeParse({ description: "x", estimatedAmount: -1 }).success).toBe(false);
    expect(holidayExpenseSchema.safeParse({ description: "x", category: "BOATS" }).success).toBe(false);
  });
});

describe("holiday milestone validation", () => {
  it("requires a title and a date", () => {
    expect(holidayMilestoneSchema.safeParse({ title: "Book flights" }).success).toBe(false);
    expect(holidayMilestoneSchema.safeParse({ date: "2026-11-01" }).success).toBe(false);
    const m = holidayMilestoneSchema.parse({ title: "Book flights", date: "2026-11-01" });
    expect(m.done).toBe(false);
    expect(m.type).toBe("OTHER");
  });
});
