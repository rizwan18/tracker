import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { PortfolioProvider } from "./context/PortfolioContext";
import { FinancialYearProvider } from "./context/FinancialYearContext";
import { RequireAuth } from "./components/RequireAuth";
import { RequirePortfolio } from "./components/RequirePortfolio";
import { AppShell } from "./components/AppShell";

import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OnboardingPage from "./pages/OnboardingPage";
import SelectPortfolioPage from "./pages/SelectPortfolioPage";
import DashboardPage from "./pages/DashboardPage";
import MoneyPage from "./pages/MoneyPage";
import PropertiesPage from "./pages/PropertiesPage";
import PropertyDetailPage from "./pages/PropertyDetailPage";
import InvestmentsPage from "./pages/InvestmentsPage";
import InvestmentDetailPage from "./pages/InvestmentDetailPage";
import BillsPage from "./pages/BillsPage";
import RemindersPage from "./pages/RemindersPage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PortfolioProvider>
        <FinancialYearProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OnboardingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/select-portfolio"
              element={
                <RequireAuth>
                  <SelectPortfolioPage />
                </RequireAuth>
              }
            />
            <Route
              element={
                <RequireAuth>
                  <RequirePortfolio>
                    <AppShell />
                  </RequirePortfolio>
                </RequireAuth>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/money" element={<MoneyPage />} />
              <Route path="/properties" element={<PropertiesPage />} />
              <Route path="/properties/:id" element={<PropertyDetailPage />} />
              <Route path="/investments" element={<InvestmentsPage />} />
              <Route path="/investments/:id" element={<InvestmentDetailPage />} />
              <Route path="/bills" element={<BillsPage />} />
              <Route path="/reminders" element={<RemindersPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </FinancialYearProvider>
        </PortfolioProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
