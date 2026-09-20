import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { usePortfolio } from "../context/PortfolioContext";

/** Business accounting pages only exist in Company Finance portfolios. */
export function RequireCompany({ children }: { children: ReactNode }) {
  const { active } = usePortfolio();
  if (active?.type !== "COMPANY") return <Navigate to="/" replace />;
  return <>{children}</>;
}
