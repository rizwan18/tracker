import { describe, it, expect } from "vitest";
import { brokerAccountSchema, CREDENTIAL_FIELD_PATTERN, investmentTransactionSchema, shareSaleSchema } from "../lib/validation";
import { sameAccountKey } from "../services/brokerAccounts";

describe("brokerAccountSchema", () => {
  const ok = { brokerName: "CommSec", accountName: "Joint investing", loginEmail: "me@example.com" };

  it("accepts a broker name, account nickname and login e-mail, and trims them", () => {
    expect(brokerAccountSchema.parse({ brokerName: "  CommSec ", accountName: " Joint ", loginEmail: " me@example.com " })).toEqual({ brokerName: "CommSec", accountName: "Joint", loginEmail: "me@example.com" });
  });
  it.each([
    [{ ...ok, brokerName: "" }, "broker"],
    [{ ...ok, accountName: "  " }, "account"],
    [{ ...ok, loginEmail: "" }, "e-mail"],
    [{ ...ok, loginEmail: "not-an-email" }, "valid e-mail"],
  ])("rejects bad input %#", (input, word) => {
    const r = brokerAccountSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message.toLowerCase()).toContain(word.split(" ").pop()!);
  });
  it("has no password/token field — extra keys are dropped, never kept", () => {
    const parsed = brokerAccountSchema.parse({ ...ok, password: "hunter2", token: "abc" });
    expect(Object.keys(parsed).sort()).toEqual(["accountName", "brokerName", "loginEmail"]);
  });
  it("flags credential-looking field names so the route can refuse them", () => {
    for (const k of ["password", "Password", "brokerPassword", "token", "apiKey", "secret", "pin", "otp"]) expect(CREDENTIAL_FIELD_PATTERN.test(k)).toBe(true);
    for (const k of ["brokerName", "accountName", "loginEmail"]) expect(CREDENTIAL_FIELD_PATTERN.test(k)).toBe(false);
  });
});

describe("sameAccountKey — several accounts may share one broker, but not the same name", () => {
  it("treats the same broker + account name as the same account, ignoring case and spaces", () => {
    expect(sameAccountKey({ brokerName: "Stake", accountName: "Main" }, { brokerName: " stake ", accountName: "MAIN" })).toBe(true);
  });
  it("allows two accounts with the same broker and different names", () => {
    expect(sameAccountKey({ brokerName: "Stake", accountName: "Main" }, { brokerName: "Stake", accountName: "Kids" })).toBe(false);
  });
});

describe("broker account on trades is optional (older trades have none)", () => {
  const base = { type: "BUY", date: "2026-01-01", quantity: 1, pricePerUnit: 1 };
  it("a transaction without a broker account is still valid", () => {
    expect(investmentTransactionSchema.parse(base).brokerAccountId).toBeUndefined();
    expect(investmentTransactionSchema.parse({ ...base, brokerAccountId: null }).brokerAccountId).toBeNull();
  });
  it("a transaction and a sale can carry a broker account id", () => {
    expect(investmentTransactionSchema.parse({ ...base, brokerAccountId: "abc" }).brokerAccountId).toBe("abc");
    expect(shareSaleSchema.parse({ quantity: 1, pricePerShare: 2, saleDate: "2026-02-01", brokerAccountId: "abc" }).brokerAccountId).toBe("abc");
  });
  it("an empty broker account id is rejected rather than silently ignored", () => {
    expect(investmentTransactionSchema.safeParse({ ...base, brokerAccountId: "" }).success).toBe(false);
  });
});
