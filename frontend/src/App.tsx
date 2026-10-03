import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import HomePage from "./pages/HomePage";
import ImportExportPage from "./pages/ImportExportPage";
import { RequireCompany } from "./components/RequireCompany";
import BusinessEntriesPage from "./pages/business/BusinessEntriesPage";
import BusinessAccountsPage from "./pages/business/BusinessAccountsPage";
import BusinessJournalPage from "./pages/business/BusinessJournalPage";
import BusinessReportsPage from "./pages/business/BusinessReportsPage";
import SourcingPage from "./pages/business/SourcingPage";
import SourcingDetailPage from "./pages/business/SourcingDetailPage";
import MoneyPage from "./pages/MoneyPage";
import PropertiesPage from "./pages/PropertiesPage";
import PropertyDetailPage from "./pages/PropertyDetailPage";
import InvestmentsPage from "./pages/InvestmentsPage";
import CryptoManagedFundsPage from "./pages/CryptoManagedFundsPage";
import InvestmentDetailPage from "./pages/InvestmentDetailPage";
import SecurityPriceLookupPage from "./pages/SecurityPriceLookupPage";
import RealisedTransactionsPage from "./pages/RealisedTransactionsPage";
import BillsPage from "./pages/BillsPage";
import HolidaysPage from "./pages/HolidaysPage";
import HolidayDetailPage from "./pages/HolidayDetailPage";
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
              <Route path="/" element={<HomePage />} />
              <Route path="/business/sales" element={<RequireCompany><BusinessEntriesPage kind="INCOME" /></RequireCompany>} />
              <Route path="/business/expenses" element={<RequireCompany><BusinessEntriesPage kind="EXPENSE" /></RequireCompany>} />
              <Route path="/business/sourcing" element={<RequireCompany><SourcingPage /></RequireCompany>} />
              <Route path="/business/sourcing/:id" element={<RequireCompany><SourcingDetailPage /></RequireCompany>} />
              <Route path="/business/reports" element={<RequireCompany><BusinessReportsPage /></RequireCompany>} />
              <Route path="/business/accounts" element={<RequireCompany><BusinessAccountsPage /></RequireCompany>} />
              <Route path="/business/journal" element={<RequireCompany><BusinessJournalPage /></RequireCompany>} />
              <Route path="/money" element={<MoneyPage />} />
              <Route path="/properties" element={<PropertiesPage />} />
              <Route path="/properties/:id" element={<PropertyDetailPage />} />
              <Route path="/investments" element={<InvestmentsPage />} />
              <Route path="/crypto-managed-funds" element={<CryptoManagedFundsPage />} />
              <Route path="/investments/realised" element={<RealisedTransactionsPage />} />
              <Route path="/investments/price-lookup" element={<SecurityPriceLookupPage />} />
              <Route path="/investments/:id" element={<InvestmentDetailPage />} />
              <Route path="/bills" element={<BillsPage />} />
              <Route path="/holidays" element={<HolidaysPage />} />
              <Route path="/holidays/:id" element={<HolidayDetailPage />} />
              <Route path="/reminders" element={<RemindersPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/import-export" element={<ImportExportPage />} />
              {/* The old "Your data" page now lives on Import/Export (Backup & restore), so existing links and bookmarks still land somewhere useful. */}
              <Route path="/data" element={<Navigate to="/import-export?section=backup" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </FinancialYearProvider>
        </PortfolioProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
