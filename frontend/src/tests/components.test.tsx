import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PnlSummaryCards } from "../components/PnlSummaryCards";
import { SecurityPriceCheckPanel, type PriceCheckState } from "../components/SecurityPriceCheckPanel";
import type { PnlSummary } from "../lib/pnl";

const bucket = (amount = 0, costBase = 0, holdings = 0) => ({ amount, costBase, holdings });
const pnl = (o: Partial<PnlSummary> = {}): PnlSummary => ({
  realised: { AUD: bucket(), USD: bucket() },
  unrealised: { AUD: bucket(), USD: bucket() },
  awaitingPrice: 0,
  noCostBase: 0,
  recordedPriceOnly: 0,
  ...o,
});
const cards = (p: PnlSummary) => renderToStaticMarkup(<MemoryRouter><PnlSummaryCards pnl={p} /></MemoryRouter>);

describe("PnlSummaryCards", () => {
  it("labels the two cards Realised P&L and Unrealised P&L and links to the sales list", () => {
    const html = cards(pnl());
    expect(html).toContain("Unrealised P&amp;L");
    expect(html).toContain("Realised P&amp;L");
    expect(html).toContain('href="/investments/realised"');
  });
  it("shows a gain with a percentage", () => {
    const html = cards(pnl({ unrealised: { AUD: bucket(180, 1020, 1), USD: bucket() } }));
    expect(html).toContain("+$180");
    expect(html).toContain("+17.65%");
    expect(html).toContain("Gain");
  });
  it("shows a loss as negative", () => {
    const html = cards(pnl({ realised: { AUD: bucket(-100, 1000, 1), USD: bucket() } }));
    expect(html).toContain("-$100");
    expect(html).toContain("Loss");
    expect(html).toContain("-10.00%");
  });
  it("shows a pending-price state instead of a number when nothing can be valued", () => {
    const html = cards(pnl({ awaitingPrice: 2 }));
    expect(html).toContain("Price pending");
    expect(html).toContain("2 holdings are waiting for a market price");
  });
  it("says so when there are no sales and no holdings (empty history)", () => {
    const html = cards(pnl());
    expect(html).toContain("No shares sold yet.");
    expect(html).toContain("No open holdings to value.");
  });
  it("shows a US$ line separately when Wall St holdings exist", () => {
    const html = cards(pnl({ unrealised: { AUD: bucket(100, 1000, 1), USD: bucket(500, 1500, 1) } }));
    expect(html).toContain("+$100");
    expect(html).toContain("+US$500.00");
  });
});

const panel = (state: PriceCheckState, o: { busy?: boolean; latest?: string | null; unpriced?: number; noTicker?: number } = {}) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <SecurityPriceCheckPanel state={state} busy={o.busy ?? false} onRefresh={() => {}} latestPriceAt={o.latest ?? null} unpricedCount={o.unpriced ?? 0} noTickerCount={o.noTicker ?? 0} />
    </MemoryRouter>
  );

describe("SecurityPriceCheckPanel", () => {
  it("is a blue feature panel with its own heading, and keeps the lookup page behind it", () => {
    const html = panel({ status: "idle" });
    expect(html).toContain("bg-[var(--brand-blue)]");
    expect(html).toContain("Check Security Price");
    expect(html).toContain('href="/investments/price-lookup"');
  });
  it("disables the refresh button and announces progress while running (blocks repeat clicks)", () => {
    const html = panel({ status: "running" }, { busy: true });
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Checking prices…");
  });
  it("reports success with the date of the latest saved price", () => {
    const html = panel({ status: "updated", count: 3 }, { latest: "2026-10-26T01:00:00Z" });
    expect(html).toContain("Updated 3 holdings");
    expect(html).toContain("Latest saved price:");
  });
  it("does not present unchanged prices as freshly refreshed", () => {
    const html = panel({ status: "unchanged", marketsClosed: true }, { latest: "2026-10-23T06:00:00Z" });
    expect(html).not.toContain("Updated");
    expect(html).toContain("Nothing newer to fetch");
  });
  it("reports a failure as an alert and keeps the last saved prices in view", () => {
    const html = panel({ status: "error", message: "Too many requests right now. Please try again shortly." }, { latest: "2026-10-26T01:00:00Z" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Too many requests");
    expect(html).toContain("Showing the last saved prices");
  });
  it("flags holdings with no price or no ticker", () => {
    const html = panel({ status: "idle" }, { unpriced: 1, noTicker: 2 });
    expect(html).toContain("1 holding has no price yet");
    expect(html).toContain("2 holdings have no ticker code");
  });
  it("says plainly when no price has ever been saved", () => {
    expect(panel({ status: "idle" })).toContain("No market price has been saved yet.");
  });
});
