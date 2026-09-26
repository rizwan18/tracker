import { describe, it, expect } from "vitest";
import { isMarketOpen, toMarket } from "../lib/marketHours";

// Each Date is written with an explicit UTC offset for the exchange's local time, so these
// don't depend on getting daylight-saving arithmetic right by hand. AEST (Sydney, standard
// time, Apr-Oct) is UTC+10; EDT (New York, daylight time, Mar-Nov) is UTC-4.
describe("isMarketOpen — ASX", () => {
  it("is open on a weekday within 10:00-16:00 Sydney time", () => {
    // Tue 2026-09-29 12:00 AEST
    expect(isMarketOpen("ASX", new Date("2026-09-29T12:00:00+10:00"))).toBe(true);
  });

  it("is closed before the open", () => {
    // Tue 2026-09-29 09:59 AEST
    expect(isMarketOpen("ASX", new Date("2026-09-29T09:59:00+10:00"))).toBe(false);
  });

  it("is closed at/after the close", () => {
    // Tue 2026-09-29 16:00 AEST (close is exclusive)
    expect(isMarketOpen("ASX", new Date("2026-09-29T16:00:00+10:00"))).toBe(false);
  });

  it("is closed on Saturday and Sunday even during trading hours", () => {
    // Sat 2026-09-26 12:00 AEST
    expect(isMarketOpen("ASX", new Date("2026-09-26T12:00:00+10:00"))).toBe(false);
    // Sun 2026-09-27 12:00 AEST
    expect(isMarketOpen("ASX", new Date("2026-09-27T12:00:00+10:00"))).toBe(false);
  });
});

describe("isMarketOpen — WALL_ST", () => {
  it("is open on a weekday within 9:30am-4:00pm New York time", () => {
    // Mon 2026-09-28 12:00 EDT
    expect(isMarketOpen("WALL_ST", new Date("2026-09-28T12:00:00-04:00"))).toBe(true);
  });

  it("is closed before 9:30am New York time", () => {
    // Mon 2026-09-28 09:00 EDT
    expect(isMarketOpen("WALL_ST", new Date("2026-09-28T09:00:00-04:00"))).toBe(false);
  });

  it("is closed on the weekend", () => {
    // Sun 2026-09-27 12:00 EDT
    expect(isMarketOpen("WALL_ST", new Date("2026-09-27T12:00:00-04:00"))).toBe(false);
  });
});

describe("toMarket", () => {
  it("maps WALL_ST through and defaults everything else to ASX", () => {
    expect(toMarket("WALL_ST")).toBe("WALL_ST");
    expect(toMarket("ASX")).toBe("ASX");
    expect(toMarket(null)).toBe("ASX");
    expect(toMarket(undefined)).toBe("ASX");
    expect(toMarket("")).toBe("ASX");
  });
});
