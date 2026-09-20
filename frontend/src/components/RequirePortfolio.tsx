import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { usePortfolio } from "../context/PortfolioContext";

/** Sends people who have several portfolios to the selection page until they've picked one. */
export function RequirePortfolio({ children }: { children: ReactNode }) {
  const { loading, needsSelection } = usePortfolio();
  const location = useLocation();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--color-ink-soft)]">Loading…</div>;
  }
  if (needsSelection) {
    return <Navigate to="/select-portfolio" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
