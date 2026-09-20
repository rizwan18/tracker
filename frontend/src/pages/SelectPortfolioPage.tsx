import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { PORTFOLIO_TYPE_INFO } from "../lib/portfolioType";
import { PortfolioTypeBadge } from "../components/PortfolioTypeBadge";
import { PortfolioAddForm } from "../components/PortfolioAddForm";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui";

/**
 * Shown before the dashboard, only to people who have created more than one
 * portfolio. Each portfolio keeps its own accounts, properties, investments and reports.
 */
export default function SelectPortfolioPage() {
  const { user, logout } = useAuth();
  const { portfolios, loading, select } = usePortfolio();
  const navigate = useNavigate();
  const location = useLocation();
  const [adding, setAdding] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[var(--color-ink-soft)]">Loading…</div>;
  // One portfolio (or none) means there is nothing to choose.
  if (portfolios.length <= 1) return <Navigate to="/" replace />;

  function open(id: string) {
    select(id);
    navigate(from, { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)] px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="font-display text-3xl font-semibold text-[var(--color-eucalyptus)] text-center mb-1">Revenue Expense Tracker</h1>
        <p className="text-center text-[var(--color-ink-soft)] mb-8">Hello{user ? `, ${user.fullName}` : ""}.</p>

        <div className="bg-white rounded-2xl border border-[var(--color-line)] p-6 md:p-8">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">Which portfolio would you like to open?</h2>
          <p className="text-[var(--color-ink-soft)] mt-1 mb-6">Each portfolio keeps its own accounts, properties, investments and reports.</p>

          <ul className="grid sm:grid-cols-2 gap-3">
            {portfolios.map((p) => {
              const info = PORTFOLIO_TYPE_INFO[p.type] ?? PORTFOLIO_TYPE_INFO.OTHER;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => open(p.id)}
                    className="w-full h-full text-left rounded-2xl border-2 border-[var(--color-line)] p-4 hover:border-[var(--color-eucalyptus)] hover:bg-[var(--color-eucalyptus-tint)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-sky)]"
                  >
                    <span className="text-3xl" aria-hidden>
                      {info.icon}
                    </span>
                    <span className="block font-display text-lg font-semibold mt-2">{p.name}</span>
                    <span className="block mt-1">
                      <PortfolioTypeBadge type={p.type} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--color-line)]">
            <Button variant="secondary" onClick={() => setAdding(true)}>
              + Add another portfolio
            </Button>
            <button onClick={logout} className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-brick)]">
              Sign out
            </button>
          </div>
        </div>
      </div>

      {adding && (
        <Modal title="Add another portfolio" onClose={() => setAdding(false)}>
          <PortfolioAddForm onCancel={() => setAdding(false)} onAdded={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  );
}
