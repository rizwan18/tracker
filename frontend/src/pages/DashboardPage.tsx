import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFinancialYear } from "../context/FinancialYearContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import type { DashboardResponse } from "../api/types";
import { Card, SectionHeading, Alert, Button, HelpText } from "../components/ui";
import { formatCurrency, formatCurrencySigned, formatDateShort, daysUntil } from "../lib/format";
import { PropertyChart } from "../components/dashboard/PropertyChart";
import { WealthBar } from "../components/dashboard/WealthBar";

const MAX_ALERTS = 3;
const MAX_LIST = 4;

/**
 * The home screen, kept deliberately short: how the year is going, a picture of
 * your property and where your money sits, what's coming up, and what just happened.
 * Everything else is one click away (or tucked under "More numbers").
 */
export default function DashboardPage() {
  const { financialYearId } = useFinancialYear();
  const { user } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<DashboardResponse>(`/dashboard?financialYear=${financialYearId}`)
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError("We couldn't load your dashboard. Please try again."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [financialYearId]);

  if (loading) return <DashboardSkeleton />;
  if (error || !data) return <Alert severity="warning" message={error ?? "No data available."} />;

  const s = data.snapshot;
  const hasAnyData = s.totalIncome > 0 || s.totalExpenses > 0 || data.propertySnapshot.numberOfProperties > 0 || data.investmentSnapshot.totalInvestmentValue > 0;
  const firstName = user?.fullName?.split(" ")[0];
  const alerts = showAllAlerts ? data.alerts : data.alerts.slice(0, MAX_ALERTS);
  const leftOver = s.netIncome;

  return (
    <div className="space-y-8">
      {/* Header: where you are, and what you can do next */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-ink-soft)]">
            Good {timeOfDayGreeting()}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="font-display text-3xl font-semibold text-[var(--color-ink)]">{data.financialYear.label}</h1>
          <p className="text-[var(--color-ink-soft)]">
            {formatDateShort(data.financialYear.startDate)} – {formatDateShort(data.financialYear.endDate)} · {data.financialYear.daysRemaining} days to go
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/money">
            <Button>+ Add income or expense</Button>
          </Link>
          <Link to="/data">
            <Button variant="secondary">Your data</Button>
          </Link>
        </div>
      </div>

      {data.alerts.length > 0 && (
        <div className="space-y-2" aria-label="Things that need your attention">
          {alerts.map((a) => (
            <Alert key={a.id} message={a.message} severity={a.severity} />
          ))}
          {data.alerts.length > MAX_ALERTS && (
            <button onClick={() => setShowAllAlerts((v) => !v)} className="text-sm text-[var(--color-sky)] hover:underline">
              {showAllAlerts ? "Show fewer" : `Show ${data.alerts.length - MAX_ALERTS} more`}
            </button>
          )}
        </div>
      )}

      {!hasAnyData ? (
        <Card className="text-center py-10">
          <h2 className="font-display text-xl font-semibold mb-2">Let's get your first year set up</h2>
          <p className="text-[var(--color-ink-soft)] mb-5 max-w-md mx-auto">Add a property, an investment, or your everyday income and expenses to see your dashboard come to life.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/properties">
              <Button>Add a property</Button>
            </Link>
            <Link to="/investments">
              <Button variant="secondary">Add an investment</Button>
            </Link>
            <Link to="/money">
              <Button variant="secondary">Record income or an expense</Button>
            </Link>
            <Link to="/data">
              <Button variant="secondary">Import my data</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/* Your year so far: the three numbers that matter, in plain words */}
          <section aria-labelledby="year-heading">
            <SectionHeading title="Your year so far" subtitle={leftOver >= 0 ? `You've brought in ${formatCurrency(s.totalIncome)} and spent ${formatCurrency(s.totalExpenses)} — ${formatCurrency(leftOver)} left over.` : `You've brought in ${formatCurrency(s.totalIncome)} and spent ${formatCurrency(s.totalExpenses)} — ${formatCurrency(-leftOver)} more going out than coming in.`} />
            <div className="grid grid-cols-3 gap-3">
              <BigNumber label="Money in" value={formatCurrency(s.totalIncome)} tone="positive" to="/money" />
              <BigNumber label="Money out" value={formatCurrency(s.totalExpenses)} tone="negative" to="/money" />
              <BigNumber label={leftOver >= 0 ? "Left over" : "Shortfall"} value={formatCurrency(Math.abs(leftOver))} tone={leftOver >= 0 ? "positive" : "negative"} />
            </div>
          </section>

          {/* The picture of your portfolio */}
          <div className="grid lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2">
              <SectionHeading title="Property snapshot" subtitle="How much each property is worth, and how much of it is yours." action={<Link to="/properties" className="text-sm text-[var(--color-eucalyptus)] font-medium">All properties</Link>} />
              <Card>
                {data.properties.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-[var(--color-ink-soft)] mb-4">No properties yet. Add one to see what you own and what you owe at a glance.</p>
                    <Link to="/properties">
                      <Button variant="secondary">Add a property</Button>
                    </Link>
                  </div>
                ) : (
                  <>
                    <PropertyChart properties={data.properties} />
                    {data.propertySnapshot.investmentCount > 0 && (
                      <p className="mt-4 text-sm rounded-xl bg-[var(--color-paper-dim)] px-4 py-3">
                        <HelpText term="Net Rental Income">
                          <span>Net rent</span>
                        </HelpText>{" "}
                        this year from your investment properties:{" "}
                        <span className={`font-semibold ${data.propertySnapshot.netRentalIncome >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{formatCurrencySigned(data.propertySnapshot.netRentalIncome)}</span>{" "}
                        <span className="text-[var(--color-ink-soft)]">
                          ({formatCurrency(data.propertySnapshot.totalRentalIncome)} rent − {formatCurrency(data.propertySnapshot.totalPropertyExpenses)} costs)
                        </span>
                      </p>
                    )}
                  </>
                )}
              </Card>
            </section>

            <section>
              <SectionHeading title="Where your money is" subtitle="Your home and investments, side by side." />
              <Card>
                <WealthBar
                  parts={[
                    { key: "home", label: "Your home", value: data.propertySnapshot.ppr.value, colour: "var(--color-sky)" },
                    { key: "property", label: "Investment property", value: data.investmentSnapshot.propertyValue, colour: "var(--color-eucalyptus)" },
                    { key: "shares", label: "Shares & ETFs", value: data.investmentSnapshot.shareValue, colour: "var(--color-ochre)" },
                    { key: "other", label: "Other investments", value: data.investmentSnapshot.otherValue, colour: "var(--color-ink-soft)" },
                  ]}
                />
                <p className="text-xs text-[var(--color-ink-soft)] mt-4">
                  Estimates from the values you've entered — not live market prices.{" "}
                  <Link to="/investments" className="text-[var(--color-sky)] hover:underline">
                    Investments
                  </Link>
                </p>
              </Card>
            </section>
          </div>

          {/* What's next, and what just happened */}
          <div className="grid md:grid-cols-2 gap-6">
            <section>
              <SectionHeading title="Coming up" action={<Link to="/bills" className="text-sm text-[var(--color-eucalyptus)] font-medium">All bills</Link>} />
              <Card className="p-0 overflow-hidden">
                {data.upcomingPayments.length === 0 ? (
                  <p className="p-5 text-sm text-[var(--color-ink-soft)]">Nothing due in the next 30 days. 🎉</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-line)]">
                    {data.upcomingPayments.slice(0, MAX_LIST).map((p) => (
                      <li key={p.id} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <p className="font-medium text-[var(--color-ink)]">{p.name}</p>
                          <p className="text-xs text-[var(--color-ink-soft)]">
                            {p.property ? `${p.property} · ` : ""}
                            due {formatDateShort(p.dueDate)}
                            {daysUntil(p.dueDate) <= 3 ? " · soon" : ""}
                          </p>
                        </div>
                        <span className="font-medium">{formatCurrency(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            <section>
              <SectionHeading title="Latest activity" action={<Link to="/money" className="text-sm text-[var(--color-eucalyptus)] font-medium">All activity</Link>} />
              <Card className="p-0 overflow-hidden">
                {data.recentActivity.length === 0 ? (
                  <p className="p-5 text-sm text-[var(--color-ink-soft)]">Nothing recorded yet.</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-line)]">
                    {data.recentActivity.slice(0, MAX_LIST).map((t) => (
                      <li key={t.id} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <p className="font-medium text-[var(--color-ink)]">{t.description}</p>
                          <p className="text-xs text-[var(--color-ink-soft)]">
                            {t.category ?? "Uncategorised"} · {formatDateShort(t.date)}
                          </p>
                        </div>
                        <span className={`font-medium ${t.amount >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{formatCurrencySigned(t.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </div>

          {/* The rest of the numbers, out of the way until you want them */}
          <details className="rounded-2xl border border-[var(--color-line)] bg-white">
            <summary className="cursor-pointer px-5 py-4 font-display font-semibold select-none">More numbers</summary>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 px-5 pb-5 text-sm">
              <Detail label="Investment income" value={formatCurrency(s.investmentIncome)} />
              <Detail label="Property income" value={formatCurrency(s.propertyIncome)} />
              <Detail label="Dividends" value={formatCurrency(s.dividends)} />
              <Detail label="Capital gains this year" value={formatCurrencySigned(data.investmentSnapshot.capitalGains.net)} />
              <Detail label="Total investment value" value={formatCurrency(data.investmentSnapshot.totalInvestmentValue)} />
              <Detail label="Upcoming bills" value={String(s.upcomingBillsCount)} />
              <Detail label="Outstanding bills" value={String(s.outstandingBillsCount)} warn={s.outstandingBillsCount > 0} />
              <Detail label="Home equity" value={data.propertySnapshot.pprCount > 0 ? formatCurrency(data.propertySnapshot.ppr.equity) : "—"} />
            </dl>
          </details>
        </>
      )}
    </div>
  );
}

function BigNumber({ label, value, tone, to }: { label: string; value: string; tone: "positive" | "negative"; to?: string }) {
  const body = (
    <div className="rounded-2xl border border-[var(--color-line)] bg-white p-4 md:p-5 h-full">
      <p className="text-sm text-[var(--color-ink-soft)]">{label}</p>
      <p className={`font-display text-2xl md:text-3xl font-semibold mt-1 ${tone === "positive" ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{value}</p>
    </div>
  );
  return to ? (
    <Link to={to} className="block hover:shadow-md transition-shadow rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className={`font-medium ${warn ? "text-[var(--color-brick)]" : ""}`}>{value}</dd>
    </div>
  );
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-10 w-64 bg-[var(--color-paper-dim)] rounded-lg" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-[var(--color-paper-dim)] rounded-2xl" />
        ))}
      </div>
      <div className="h-64 bg-[var(--color-paper-dim)] rounded-2xl" />
    </div>
  );
}
