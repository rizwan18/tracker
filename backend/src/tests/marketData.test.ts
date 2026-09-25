import { describe, it, expect } from "vitest";
import { isPlausibleTicker, normaliseTicker } from "../lib/marketData";

describe("market data ticker helpers", () => {
  it("normalises whitespace and casing", () => {
    expect(normaliseTicker("  bhp.ax  ")).toBe("BHP.AX");
    expect(normaliseTicker(undefined)).toBe("");
    expect(normaliseTicker(null)).toBe("");
  });

  it("accepts plausible ASX and US-style tickers", () => {
    expect(isPlausibleTicker("BHP.AX")).toBe(true);
    expect(isPlausibleTicker("CBA.AX")).toBe(true);
    expect(isPlausibleTicker("AAPL")).toBe(true);
    expect(isPlausibleTicker("MSFT")).toBe(true);
    expect(isPlausibleTicker("BRK-B")).toBe(true);
  });

  it("rejects empty or implausible tickers", () => {
    expect(isPlausibleTicker("")).toBe(false);
    expect(isPlausibleTicker("$$$")).toBe(false);
    expect(isPlausibleTicker("HAS SPACE")).toBe(false);
    expect(isPlausibleTicker("WAYTOOLONGFORATICKERSYMBOL")).toBe(false);
  });
});
