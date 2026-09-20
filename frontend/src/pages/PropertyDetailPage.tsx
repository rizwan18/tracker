import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useFinancialYear } from "../context/FinancialYearContext";
import { api } from "../api/client";
import type { PropertySummary } from "../api/types";
import { Button, Card, SectionHeading, StatTile, HelpText, Tabs, TabPanel } from "../components/ui";
import { Modal } from "../components/Modal";
import { PropertyForm } from "../components/PropertyForm";
import { LinkedTransactions } from "../components/LinkedTransactions";
import { RentalSchedule } from "../components/RentalSchedule";
import { PropertyBills } from "../components/PropertyBills";
import { PropertyUpcomingPayments } from "../components/PropertyUpcomingPayments";
import { PropertyTypeBadge } from "../components/PropertyTypeBadge";
import { PropertyIcon } from "../components/PropertyIcon";
import { PropertyPhotos } from "../components/PropertyPhotos";
import { PropertyManagerTab } from "../components/PropertyManagerTab";
import { PROPERTY_TYPE_INFO, propertyTypeOf } from "../lib/propertyType";
import { formatCurrency, formatDate } from "../lib/format";

// Costs that typically come with owning the home you live in.
const PPR_QUICK_ADD = {
  INCOME: [] as string[],
  EXPENSE: ["Council Rates", "Water Rates", "Insurance", "Repairs & Maintenance", "Mortgage Interest", "Body Corporate", "Strata"],
};

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "income-expense", label: "Income/Expense" },
  { id: "manager", label: "Property manager" },
  { id: "bills-reminders", label: "Bills & reminders" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { financialYearId } = useFinancialYear();
  const [summary, setSummary] = useState<PropertySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  // Bumped whenever an entry is added/changed so the schedule and the entries list stay in step.
  const [version, setVersion] = useState(0);

  // The chosen tab lives in the URL (?tab=…) so it survives a refresh and can be linked to.
  const requestedTab = searchParams.get("tab");
  function selectTab(next: TabId) {
    setSearchParams(next === "summary" ? {} : { tab: next }, { replace: true });
  }

  // Refreshes the summary tiles without blanking the page (used after adding/editing entries).
  const refreshSummary = useCallback(() => {
    if (!id) return Promise.resolve();
    return api.get<PropertySummary>(`/properties/${id}/summary?financialYear=${financialYearId}`).then(setSummary);
  }, [id, financialYearId]);

  useEffect(() => {
    setLoading(true);
    refreshSummary().finally(() => setLoading(false));
  }, [refreshSummary]);

  async function handleDelete() {
    if (!id || !confirm("Remove this property? Its transactions will remain but lose their property link.")) return;
    await api.delete(`/properties/${id}`);
    navigate("/properties");
  }

  if (loading || !summary) return <p className="text-[var(--color-ink-soft)]">Loading…</p>;

  const { property } = summary;
  const type = propertyTypeOf(property);
  const isPpr = type === "PPR";
  // Your own home doesn't have a managing agent, so that tab is only for investment properties.
  const visibleTabs = TABS.filter((t) => !(isPpr && t.id === "manager"));
  const tab: TabId = visibleTabs.some((t) => t.id === requestedTab) ? (requestedTab as TabId) : "summary";

  function handleEntriesChanged() {
    setVersion((v) => v + 1);
    refreshSummary();
  }

  return (
    <div>
      <SectionHeading
        title={
          <span className="flex flex-wrap items-center gap-3">
            <PropertyIcon property={property} size={56} />
            {property.name}
            <PropertyTypeBadge type={type} full />
          </span>
        }
        subtitle={property.address ?? undefined}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowEdit(true)}>
              Edit
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Remove
            </Button>
          </div>
        }
      />

      <Tabs tabs={[...visibleTabs]} active={tab} onChange={selectTab} />

      {tab === "summary" && (
        <TabPanel id="summary">
          <PropertyPhotos propertyId={property.id} propertyName={property.name} onChanged={refreshSummary} />

          {isPpr ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Running costs this year" value={formatCurrency(summary.expenses)} tone="negative" />
              <StatTile label="Estimated value" value={property.currentEstimatedValue != null ? formatCurrency(property.currentEstimatedValue) : "Not recorded"} tone="neutral" />
              <StatTile label="Loan balance" value={property.loanBalance != null ? formatCurrency(property.loanBalance) : "Not recorded"} tone="neutral" />
              <StatTile
                label="Estimated equity"
                value={summary.estimatedEquity != null ? formatCurrency(summary.estimatedEquity) : "Not enough information"}
                tone="positive"
                help="Estimated value minus loan balance."
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Rental income" value={formatCurrency(summary.rentalIncome)} tone="positive" />
              <StatTile label="Expenses" value={formatCurrency(summary.expenses)} tone="negative" />
              <StatTile
                label="Net rental income"
                value={formatCurrency(summary.netRentalIncome)}
                tone={summary.netRentalIncome >= 0 ? "positive" : "negative"}
                help="Rent received minus property expenses."
              />
              <StatTile label="Annualised rental income" value={formatCurrency(summary.annualisedRentalIncome)} tone="neutral" help="Estimated full-year rent based on the current rate." />
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <h3 className="font-display font-semibold mb-3">
                {isPpr ? (
                  "Property details"
                ) : (
                  <HelpText term="Rental Yield">
                    <span>Property details</span>
                  </HelpText>
                )}
              </h3>
              <dl className="space-y-2 text-sm">
                <Row label="Estimated value" value={property.currentEstimatedValue != null ? formatCurrency(property.currentEstimatedValue) : "Not recorded"} />
                <Row label="Loan balance" value={property.loanBalance != null ? formatCurrency(property.loanBalance) : "Not recorded"} />
                <Row label="Estimated equity" value={summary.estimatedEquity != null ? formatCurrency(summary.estimatedEquity) : "Not enough information"} />
                {!isPpr && <Row label="Rental yield" value={summary.rentalYield != null ? `${summary.rentalYield.toFixed(1)}%` : "Not enough information"} />}
                <Row label="Purchase date" value={property.purchaseDate ? formatDate(property.purchaseDate) : "Not recorded"} />
                {!isPpr && <Row label="Rental agent" value={property.rentalAgent || "Not recorded"} />}
                {!isPpr && <Row label="Tenant" value={property.tenantName || "Not recorded"} />}
              </dl>
              <p className="text-xs text-[var(--color-ink-soft)] mt-3">Estimated value, equity and yield are calculated from figures you enter — treat them as estimates, not valuations.</p>
            </Card>

            <Card>
              <h3 className="font-display font-semibold mb-3">{isPpr ? "Biggest running costs this financial year" : "Major expenses this financial year"}</h3>
              {summary.majorExpenses.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-soft)]">
                  No expenses recorded yet for this financial year. Add them on the{" "}
                  <button onClick={() => selectTab("income-expense")} className="text-[var(--color-sky)] hover:underline">
                    Income/Expense
                  </button>{" "}
                  tab.
                </p>
              ) : (
                <ul className="space-y-2">
                  {summary.majorExpenses.map((e) => (
                    <li key={e.category} className="flex justify-between text-sm">
                      <span className="text-[var(--color-ink-soft)]">{e.category}</span>
                      <span className="font-medium">{formatCurrency(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabPanel>
      )}

      {tab === "income-expense" && (
        <TabPanel id="income-expense">
          {isPpr ? (
            <>
              <p className={`text-sm rounded-xl px-4 py-3 text-[#264a5c] ${PROPERTY_TYPE_INFO.PPR.badge}`}>
                This is your principal place of residence, so there's no rental schedule. Record running costs like rates, insurance and maintenance here — they're kept separate from your rental figures.
              </p>
              <LinkedTransactions
                scope={{ kind: "property", id: property.id, name: property.name }}
                financialYearId={financialYearId}
                title="Running costs"
                quickAdd={PPR_QUICK_ADD}
                allowIncome={false}
                emptyMessage="Nothing recorded yet for this financial year. Add rates, insurance, maintenance or loan interest using the buttons above."
                reloadToken={version}
                onChanged={handleEntriesChanged}
              />
            </>
          ) : (
            <>
              <RentalSchedule propertyId={property.id} propertyName={property.name} financialYearId={financialYearId} reloadToken={version} onChanged={handleEntriesChanged} />
              <LinkedTransactions
                scope={{ kind: "property", id: property.id, name: property.name }}
                financialYearId={financialYearId}
                title="All entries"
                showQuickAdd={false}
                reloadToken={version}
                onChanged={handleEntriesChanged}
              />
            </>
          )}
        </TabPanel>
      )}

      {tab === "manager" && !isPpr && (
        <TabPanel id="manager">
          <PropertyManagerTab key={property.id} property={property} onSaved={refreshSummary} />
        </TabPanel>
      )}

      {tab === "bills-reminders" && (
        <TabPanel id="bills-reminders">
          <PropertyBills propertyId={property.id} />
          <PropertyUpcomingPayments propertyId={property.id} />
        </TabPanel>
      )}

      {showEdit && (
        <Modal title="Edit property" onClose={() => setShowEdit(false)}>
          <PropertyForm
            initial={property}
            onCancel={() => setShowEdit(false)}
            onSaved={() => {
              setShowEdit(false);
              refreshSummary();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
