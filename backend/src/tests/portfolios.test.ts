import { describe, it, expect } from "vitest";
import { chooseHousehold, canHavePpr, defaultPortfolioName } from "../lib/portfolios";
import { portfolioSchema, portfolioSetupSchema, portfolioRenameSchema } from "../lib/validation";

describe("chooseHousehold (which portfolio a request works on)", () => {
  const member = (ids: string[]) => async (id: string) => ids.includes(id);

  it("uses the default portfolio when the browser doesn't ask for one", async () => {
    expect(await chooseHousehold(undefined, "hDefault", member([]))).toEqual({ householdId: "hDefault" });
    expect(await chooseHousehold("", "hDefault", member([]))).toEqual({ householdId: "hDefault" });
  });

  it("accepts a portfolio the person is a member of", async () => {
    expect(await chooseHousehold("hCompany", "hDefault", member(["hCompany"]))).toEqual({ householdId: "hCompany" });
  });

  it("refuses a portfolio the person doesn't belong to — never falls back silently", async () => {
    expect(await chooseHousehold("someoneElses", "hDefault", member(["hCompany"]))).toEqual({ forbidden: true });
  });

  it("doesn't look anything up when the requested portfolio is the default", async () => {
    let asked = false;
    await chooseHousehold("hDefault", "hDefault", async () => ((asked = true), true));
    expect(asked).toBe(false);
  });
});

describe("portfolio types", () => {
  it("only personal portfolios can have a principal place of residence", () => {
    expect(canHavePpr("PERSONAL")).toBe(true);
    for (const t of ["COMPANY", "TRUST", "OTHER"]) expect(canHavePpr(t)).toBe(false);
  });

  it("suggests a readable name for each type", () => {
    expect(defaultPortfolioName("PERSONAL")).toBe("Personal Finance");
    expect(defaultPortfolioName("COMPANY")).toBe("Company Finance");
    expect(defaultPortfolioName("TRUST")).toBe("Trust Finance");
    expect(defaultPortfolioName("OTHER")).toBe("Other Type");
  });
});

describe("portfolio validation", () => {
  it("accepts the four types and rejects anything else", () => {
    for (const type of ["PERSONAL", "COMPANY", "TRUST", "OTHER"]) expect(portfolioSchema.safeParse({ type, name: "X" }).success).toBe(true);
    expect(portfolioSchema.safeParse({ type: "HOLIDAY", name: "X" }).success).toBe(false);
    expect(portfolioSchema.safeParse({ type: "TRUST", name: "   " }).success).toBe(false);
  });

  it("setup takes one or more portfolios, each type at most once", () => {
    expect(portfolioSetupSchema.safeParse({ portfolios: [{ type: "PERSONAL", name: "Me" }] }).success).toBe(true);
    expect(portfolioSetupSchema.safeParse({ portfolios: [{ type: "PERSONAL", name: "Me" }, { type: "COMPANY", name: "Co" }, { type: "TRUST", name: "T" }, { type: "OTHER", name: "Club" }] }).success).toBe(true);
    expect(portfolioSetupSchema.safeParse({ portfolios: [] }).success).toBe(false);
    expect(portfolioSetupSchema.safeParse({ portfolios: [{ type: "COMPANY", name: "A" }, { type: "COMPANY", name: "B" }] }).success).toBe(false);
  });

  it("renaming needs a name", () => {
    expect(portfolioRenameSchema.safeParse({ name: "My Trust" }).success).toBe(true);
    expect(portfolioRenameSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
