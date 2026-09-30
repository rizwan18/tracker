import { describe, it, expect } from "vitest";
import { isPriceRefreshDue } from "../lib/priceRefreshPolicy";

// 2026-09-30 is a Wednesday. Sydney is UTC+10 (AEST) until 4 Oct, then UTC+11 (AEDT).
const at = (iso: string) => new Date(iso);
const ASX_OPEN = at("2026-09-30T02:00:00Z"); // Wed 12:00 Sydney
const ASX_NIGHT = at("2026-09-30T10:00:00Z"); // Wed 20:00 Sydney (closed)
const ASX_SATURDAY = at("2026-10-03T02:00:00Z"); // Sat 12:00 Sydney (closed)

describe("price refresh policy", () => {
  it("always fetches a holding that has never had a price, even when the market is closed", () => {
    expect(isPriceRefreshDue("ASX", null, ASX_NIGHT)).toBe(true);
    expect(isPriceRefreshDue("ASX", null, ASX_SATURDAY)).toBe(true);
  });

  it("while the market is open, allows a refresh once a minute", () => {
    expect(isPriceRefreshDue("ASX", new Date(ASX_OPEN.getTime() - 30_000), ASX_OPEN)).toBe(false);
    expect(isPriceRefreshDue("ASX", new Date(ASX_OPEN.getTime() - 61_000), ASX_OPEN)).toBe(true);
  });

  it("on a weekday night, does not refetch a price saved within the last 24 hours", () => {
    const savedThisAfternoon = at("2026-09-30T05:00:00Z");
    expect(isPriceRefreshDue("ASX", savedThisAfternoon, ASX_NIGHT)).toBe(false);
  });

  it("on a weekday night, refetches once the saved price is 24 hours old", () => {
    const savedYesterday = new Date(ASX_NIGHT.getTime() - 24 * 60 * 60 * 1000);
    expect(isPriceRefreshDue("ASX", savedYesterday, ASX_NIGHT)).toBe(true);
    expect(isPriceRefreshDue("ASX", new Date(savedYesterday.getTime() + 1000), ASX_NIGHT)).toBe(false);
  });

  it("over a weekend, also allows one refetch per 24 hours", () => {
    expect(isPriceRefreshDue("ASX", at("2026-10-02T02:00:00Z"), ASX_SATURDAY)).toBe(true); // Fri lunchtime, 24h+ ago
    expect(isPriceRefreshDue("ASX", at("2026-10-03T00:00:00Z"), ASX_SATURDAY)).toBe(false); // this morning
  });

  it("judges each exchange by its own hours", () => {
    // Wed 12:00 Sydney is Tue 22:00 New York: ASX open, Wall St closed.
    const savedTenMinutesAgo = new Date(ASX_OPEN.getTime() - 10 * 60_000);
    expect(isPriceRefreshDue("ASX", savedTenMinutesAgo, ASX_OPEN)).toBe(true);
    expect(isPriceRefreshDue("WALL_ST", savedTenMinutesAgo, ASX_OPEN)).toBe(false);
  });
});
