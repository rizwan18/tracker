import { Link } from "react-router-dom";
import { formatDateTime } from "../lib/format";

export type PriceCheckState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "updated"; count: number }
  | { status: "unchanged"; marketsClosed: boolean }
  | { status: "error"; message: string };

const ACTION_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-medium transition-colors w-full sm:w-auto whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed";

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "Check Security Price" as its own feature: a solid blue panel (the fixed --brand-blue, so it looks the same in every
 * theme) with the existing price lookup page behind its main action, plus a manual run of the existing price refresh.
 * The refresh itself is throttled by the server (see priceRefreshPolicy.ts), so the status line says what actually happened.
 */
export function SecurityPriceCheckPanel({
  state,
  busy,
  onRefresh,
  latestPriceAt,
  unpricedCount,
  noTickerCount,
}: {
  state: PriceCheckState;
  busy: boolean;
  onRefresh: () => void;
  /** Newest successful price refresh across the holdings, or null if none has ever succeeded. */
  latestPriceAt: string | null;
  /** Holdings with a ticker that still have no saved price. */
  unpricedCount: number;
  /** Holdings with no ticker, which can't be priced at all. */
  noTickerCount: number;
}) {
  const asAt = latestPriceAt ? `Latest saved price: ${formatDateTime(latestPriceAt)}.` : "No market price has been saved yet.";
  let message: string | null = null;
  let isError = false;
  if (state.status === "running") message = "Checking prices…";
  else if (state.status === "updated") message = `Updated ${state.count} ${state.count === 1 ? "holding" : "holdings"}. ${asAt}`;
  else if (state.status === "unchanged")
    message = state.marketsClosed
      ? `Markets are closed, so prices refresh once a day. Nothing newer to fetch. ${asAt}`
      : `No newer prices yet — they refresh at most once a minute while markets are open. ${asAt}`;
  else if (state.status === "error") {
    message = `${state.message} Showing the last saved prices. ${asAt}`;
    isError = true;
  }
  const notes: string[] = [];
  if (state.status !== "running" && unpricedCount > 0) notes.push(`${unpricedCount} ${unpricedCount === 1 ? "holding has" : "holdings have"} no price yet (the price service may be busy or the code not recognised).`);
  if (noTickerCount > 0) notes.push(`${noTickerCount} ${noTickerCount === 1 ? "holding has" : "holdings have"} no ticker code, so can’t be priced.`);

  return (
    <section aria-labelledby="price-check-heading" className="on-brand-blue rounded-2xl bg-[var(--brand-blue)] text-white p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <span className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M15 7h6v6" />
            </svg>
          </span>
          <div>
            <h3 id="price-check-heading" className="font-display text-lg font-semibold">
              Check Security Price
            </h3>
            <p className="text-sm text-white/90 mt-0.5">Look up the latest price of any share or ETF, or refresh the market prices of your holdings.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
          <Link to="/investments/price-lookup" className={`${ACTION_BASE} bg-white text-[var(--brand-blue)] hover:bg-[var(--brand-blue-tint)]`}>
            Look up a price
          </Link>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            aria-busy={busy}
            className={`${ACTION_BASE} border border-white/70 text-white hover:bg-[var(--brand-blue-dark)]`}
          >
            {busy && <Spinner />}
            {busy ? "Checking…" : "Refresh my prices"}
          </button>
        </div>
      </div>
      <div className="mt-3 text-sm space-y-1" aria-live="polite">
        {message ? (
          <p className={isError ? "rounded-lg bg-white text-[var(--color-brick)] px-3 py-2 font-medium" : state.status === "updated" ? "font-medium" : "text-white/90"} role={isError ? "alert" : undefined}>
            {state.status === "updated" && <span aria-hidden="true">✓ </span>}
            {message}
          </p>
        ) : (
          <p className="text-white/90">{asAt}</p>
        )}
        {notes.map((n) => (
          <p key={n} className="text-white/90">
            {n}
          </p>
        ))}
      </div>
    </section>
  );
}
