import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFinancialYear } from "../context/FinancialYearContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import type { DashboardResponse } from "../api/types";
import { Card, SectionHeading, Alert, Button } from "../components/ui";
import { formatCurrency, formatCurrencySigned, formatDateShort, formatDateUtc, daysUntil } from "../lib/format";
import { PropertyChart } from "../components/dashboard/PropertyChart";
import { WealthBar } from "../components/dashboard/WealthBar";
import { YearDonut } from "../components/dashboard/YearDonut";

const MAX_LIST = 3;

/**
 * The home screen, kept as light as possible: pictures and rings first, a few words each.
 * Details live one click away on their own pages and in Reports.
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
  const alerts = showAllAlerts ? data.alerts : data.alerts.slice(0, 1);

  return (
    <div className="space-y-6">
      {/* What you can do now (left) — and, quietly, which year this is (right) */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold text-[var(--color-ink)]">
            Good {timeOfDayGreeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/money">
              <Button>+ Add income or expense</Button>
            </Link>
            <Link to="/data">
              <Button variant="secondary">Your data</Button>
            </Link>
          </div>
        </div>
        <YearProgress fy={data.financialYear} />
      </div>

      {data.alerts.length > 0 && (
        <div className="space-y-2" aria-label="Things that need your attention">
          {alerts.map((a) => (
            <Alert key={a.id} message={a.message} severity={a.severity} />
          ))}
          {data.alerts.length > 1 && (
            <button onClick={() => setShowAllAlerts((v) => !v)} className="text-sm text-[var(--color-sky)] hover:underline">
              {showAllAlerts ? "Show fewer" : `Show ${data.alerts.length - 1} more`}
            </button>
          )}
        </div>
      )}

      {!hasAnyData ? (
        <Card className="text-center py-10">
          <p className="text-5xl mb-3" aria-hidden>
            🌱
          </p>
          <h2 className="font-display text-xl font-semibold mb-2">Let's get your first year set up</h2>
          <p className="text-[var(--color-ink-soft)] mb-6 max-w-md mx-auto">Add something and your dashboard fills with pictures of how you're doing.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
            <StartTile to="/properties" icon="🏘️" label="Add a property" />
            <StartTile to="/investments" icon="📈" label="Add an investment" />
            <StartTile to="/money" icon="💷" label="Record income or an expense" />
            <StartTile to="/data" icon="💾" label="Import my data" />
          </div>
        </Card>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-6">
            <section>
              <SectionHeading title="Your year so far" />
              <Card>
                <YearDonut income={s.totalIncome} expenses={s.totalExpenses} />
              </Card>
            </section>

            <section>
              <SectionHeading title="Where your money is" />
              <Card>
                <WealthBar
                  parts={[
                    { key: "home", label: "Your home", icon: "🏠", value: data.propertySnapshot.ppr.value, colour: "var(--color-sky)" },
                    { key: "property", label: "Investment property", icon: "🏘️", value: data.investmentSnapshot.propertyValue, colour: "var(--color-eucalyptus)" },
                    { key: "shares", label: "Shares & ETFs", icon: "📈", value: data.investmentSnapshot.shareValue, colour: "var(--color-ochre)" },
                    { key: "other", label: "Other investments", icon: "💼", value: data.investmentSnapshot.otherValue, colour: "var(--color-ink-soft)" },
                  ]}
                />
              </Card>
            </section>
          </div>

          <section>
            <SectionHeading title="Property snapshot" action={<Link to="/properties" className="text-sm text-[var(--color-eucalyptus)] font-medium">All properties</Link>} />
            <Card>
              {data.properties.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-4xl mb-2" aria-hidden>
                    🏡
                  </p>
                  <p className="text-[var(--color-ink-soft)] mb-4">No properties yet. Add one to see what you own and what you owe.</p>
                  <Link to="/properties">
                    <Button variant="secondary">Add a property</Button>
                  </Link>
                </div>
              ) : (
                <>
                  <PropertyChart properties={data.properties} />
                  {data.propertySnapshot.investmentCount > 0 && (
                    <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
                      Rent this year, after costs:{" "}
                      <span className={`font-semibold ${data.propertySnapshot.netRentalIncome >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{formatCurrencySigned(data.propertySnapshot.netRentalIncome)}</span>
                    </p>
                  )}
                </>
              )}
            </Card>
          </section>

          <div className="grid md:grid-cols-2 gap-6">
            <section>
              <SectionHeading title="Coming up" action={<Link to="/bills" className="text-sm text-[var(--color-eucalyptus)] font-medium">All bills</Link>} />
              <Card className="p-0 overflow-hidden">
                {data.upcomingPayments.length === 0 ? (
                  <p className="p-5 text-sm text-[var(--color-ink-soft)]">Nothing due soon. 🎉</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-line)]">
                    {data.upcomingPayments.slice(0, MAX_LIST).map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                        <span className="text-xl" aria-hidden>
                          🧾
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[var(--color-ink)] truncate">{p.name}</p>
                          <p className="text-xs text-[var(--color-ink-soft)]">
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
                      <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                        <span className="text-xl" aria-hidden>
                          {t.amount >= 0 ? "💰" : "🛒"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[var(--color-ink)] truncate">{t.description}</p>
                          <p className="text-xs text-[var(--color-ink-soft)]">{formatDateShort(t.date)}</p>
                        </div>
                        <span className={`font-medium ${t.amount >= 0 ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-brick)]"}`}>{formatCurrencySigned(t.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </div>

          <p className="text-center">
            <Link to="/reports" className="text-sm text-[var(--color-sky)] hover:underline">
              See full reports →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

/** Which financial year this is and how far through it you are — small and quiet, on the right. */
function YearProgress({ fy }: { fy: DashboardResponse["financialYear"] }) {
  const start = new Date(fy.startDate).getTime();
  const end = new Date(fy.endDate).getTime();
  const pct = Math.max(0, Math.min(100, ((Date.now() - start) / (end - start)) * 100));
  return (
    <div className="w-full sm:w-48 sm:text-right text-xs text-[var(--color-ink-soft)] opacity-80">
      <p>Financial year {fy.label}</p>
      <div role="progressbar" aria-label="How much of the financial year has passed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="mt-1.5 h-1 rounded-full bg-[var(--color-paper-dim)] overflow-hidden">
        <div className="h-full rounded-full bg-[var(--color-ink-soft)]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1">
        {fy.daysRemaining} days to go · ends {formatDateUtc(fy.endDate)}
      </p>
    </div>
  );
}

function StartTile({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <Link to={to} className="rounded-2xl border border-[var(--color-line)] bg-white px-3 py-5 hover:shadow-md transition-shadow flex flex-col items-center gap-2">
      <span className="text-3xl" aria-hidden>
        {icon}
      </span>
      <span className="text-sm font-medium text-center">{label}</span>
    </Link>
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
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-64 bg-[var(--color-paper-dim)] rounded-lg" />
      <div className="grid md:grid-cols-2 gap-6">
        <div className="h-52 bg-[var(--color-paper-dim)] rounded-2xl" />
        <div className="h-52 bg-[var(--color-paper-dim)] rounded-2xl" />
      </div>
      <div className="h-64 bg-[var(--color-paper-dim)] rounded-2xl" />
    </div>
  );
}
