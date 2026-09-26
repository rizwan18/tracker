/**
 * Market-hours engine for the two exchanges this app supports (see Investment.market).
 *
 * Used to decide, server-side and *before* calling the market-data provider, whether a
 * security's exchange is currently trading — see services/marketPriceRefresh.ts. The
 * point of checking this locally first is to avoid ever calling the provider at all
 * outside trading hours (weekends included), not just to label the result afterwards.
 *
 * Deliberately uses the same Intl.DateTimeFormat-in-a-timezone approach as
 * lib/financialYear.ts, so a date is always interpreted in the *exchange's* local time
 * regardless of the server's own timezone.
 *
 * Known limitation: this models the regular weekday trading session only. It does not
 * account for exchange public holidays (ASX/NYSE holiday calendars aren't modelled
 * anywhere else in this app either) — on a public holiday this will incorrectly report
 * the market as open during normal trading hours. A holiday-aware version would need a
 * maintained holiday calendar per exchange, which is a reasonable follow-up but out of
 * scope for "reuse the app's existing architecture".
 */

export type Market = "ASX" | "WALL_ST";

interface TradingWindow {
  /** IANA timezone the exchange's trading hours are defined in. */
  timeZone: string;
  /** Minutes after local midnight the regular session opens. */
  openMinutes: number;
  /** Minutes after local midnight the regular session closes. */
  closeMinutes: number;
}

// ASX: continuous trading 10:00-16:00 Sydney time. NYSE/Nasdaq: 9:30am-4:00pm New York time.
const TRADING_WINDOWS: Record<Market, TradingWindow> = {
  ASX: { timeZone: "Australia/Sydney", openMinutes: 10 * 60, closeMinutes: 16 * 60 },
  WALL_ST: { timeZone: "America/New_York", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
};

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The weekday (0=Sun..6=Sat) and minutes-since-midnight of `date`, as seen in `timeZone`. */
function getLocalWeekdayAndMinutes(date: Date, timeZone: string): { weekday: number; minutesSinceMidnight: number } {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const weekday = WEEKDAY_INDEX[get("weekday") ?? ""] ?? -1;
  const hour = Number(get("hour") ?? "0") % 24; // hourCycle h23 can still print "24" for midnight in some engines
  const minute = Number(get("minute") ?? "0");
  return { weekday, minutesSinceMidnight: hour * 60 + minute };
}

/**
 * True if `market`'s exchange is in its regular trading session right now (or at `now`,
 * for tests). Saturday and Sunday (in the exchange's own timezone) are always closed.
 */
export function isMarketOpen(market: Market, now: Date = new Date()): boolean {
  const window = TRADING_WINDOWS[market];
  const { weekday, minutesSinceMidnight } = getLocalWeekdayAndMinutes(now, window.timeZone);
  if (weekday === 0 || weekday === 6) return false; // Sunday, Saturday
  return minutesSinceMidnight >= window.openMinutes && minutesSinceMidnight < window.closeMinutes;
}

/** Same fallback rule the frontend uses (lib/holdings.ts marketOf): no/unknown market = ASX. */
export function toMarket(rawMarket: string | null | undefined): Market {
  return rawMarket === "WALL_ST" ? "WALL_ST" : "ASX";
}
