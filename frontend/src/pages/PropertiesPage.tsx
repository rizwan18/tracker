import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Property } from "../api/types";
import { Button, Card, EmptyState, SectionHeading } from "../components/ui";
import { Modal } from "../components/Modal";
import { PropertyForm } from "../components/PropertyForm";
import { PropertyTypeBadge, PropertyTypeLegend } from "../components/PropertyTypeBadge";
import { PropertyIcon } from "../components/PropertyIcon";
import { PortfolioDataPanel } from "../components/PortfolioDataPanel";
import { PROPERTY_TYPE_INFO, propertyTypeOf } from "../lib/propertyType";
import { formatCurrency } from "../lib/format";

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<Property[]>("/properties")
      .then(setProperties)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="space-y-6">
      <SectionHeading title="Properties" subtitle="Track your investment properties and your home (principal place of residence)." action={<Button onClick={() => setShowForm(true)}>+ Add property</Button>} />

      {loading ? (
        <p className="text-[var(--color-ink-soft)]">Loading…</p>
      ) : properties.length === 0 ? (
        <EmptyState
          title="No properties yet"
          description="Add an investment property to track rental income and expenses, or your home (PPR) to keep its costs and equity in one place."
          action={<Button onClick={() => setShowForm(true)}>Add property</Button>}
        />
      ) : (
        <>
          <PropertyTypeLegend />
          <div className="grid md:grid-cols-2 gap-4">
            {properties.map((p) => {
              const type = propertyTypeOf(p);
              const info = PROPERTY_TYPE_INFO[type];
              return (
                <Link key={p.id} to={`/properties/${p.id}`}>
                  <Card className={`hover:shadow-md transition-shadow h-full ${info.accent}`}>
                    <div className="flex items-start gap-3">
                      <PropertyIcon property={p} size={48} />
                      <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                        <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                        <PropertyTypeBadge type={type} />
                      </div>
                    </div>
                    {p.address && <p className="text-sm text-[var(--color-ink-soft)]">{p.address}</p>}
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                      {p.currentEstimatedValue != null && (
                        <div>
                          <p className="text-[var(--color-ink-soft)]">Estimated value</p>
                          <p className="font-medium">{formatCurrency(p.currentEstimatedValue)}</p>
                        </div>
                      )}
                      {type === "PPR" && p.loanBalance != null && (
                        <div>
                          <p className="text-[var(--color-ink-soft)]">Loan balance</p>
                          <p className="font-medium">{formatCurrency(p.loanBalance)}</p>
                        </div>
                      )}
                      {type === "INVESTMENT" && p.rentAmount != null && (
                        <div>
                          <p className="text-[var(--color-ink-soft)]">Rent</p>
                          <p className="font-medium">
                            {formatCurrency(p.rentAmount)} / {p.rentFrequency?.toLowerCase()}
                          </p>
                        </div>
                      )}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <PortfolioDataPanel scope="properties" onImported={load} />

      {showForm && (
        <Modal title="Add a property" onClose={() => setShowForm(false)}>
          <PropertyForm
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
