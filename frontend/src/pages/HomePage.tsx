import { usePortfolio } from "../context/PortfolioContext";
import DashboardPage from "./DashboardPage";
import BusinessDashboardPage from "./business/BusinessDashboardPage";

/** The dashboard depends on the kind of portfolio that is open. */
export default function HomePage() {
  const { active } = usePortfolio();
  return active?.type === "COMPANY" ? <BusinessDashboardPage /> : <DashboardPage />;
}
