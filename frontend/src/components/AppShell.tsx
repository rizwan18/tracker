import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { PortfolioTypeBadge } from "./PortfolioTypeBadge";
import { FinancialYearSwitcher } from "./FinancialYearSwitcher";

const PRIMARY_NAV = [
  { to: "/", label: "Dashboard", icon: "🏠", end: true },
  { to: "/money", label: "Money", icon: "💷" },
  { to: "/properties", label: "Properties", icon: "🏘" },
  { to: "/investments", label: "Investments", icon: "📈" },
  { to: "/bills", label: "Bills", icon: "🧾" },
  { to: "/reminders", label: "Reminders", icon: "🔔" },
  { to: "/reports", label: "Reports", icon: "📊" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

// A shorter set for the mobile bottom bar (section 5: "simplified navigation").
const MOBILE_NAV = [
  { to: "/", label: "Home", icon: "🏠", end: true },
  { to: "/money", label: "Money", icon: "💷" },
  { to: "/investments", label: "Invest", icon: "📈" },
  { to: "/reminders", label: "Remind", icon: "🔔" },
  { to: "/settings", label: "More", icon: "⚙️" },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const { active, portfolios } = usePortfolio();
  const canSwitch = portfolios.length > 1;

  return (
    <div className={`min-h-screen flex ${user?.easyViewEnabled ? "easy-view" : ""}`}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3 focus:rounded-lg focus:m-2">
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-60 border-r border-[var(--color-line)] bg-white px-4 py-6 shrink-0">
        <div className="font-display text-lg font-semibold text-[var(--color-eucalyptus)] px-2 mb-4">Revenue Expense Tracker</div>
        {active && (
          <div className="mx-2 mb-6 rounded-xl bg-[var(--color-paper-dim)] px-3 py-2">
            <p className="text-sm font-medium text-[var(--color-ink)] truncate" title={active.name}>
              {active.name}
            </p>
            <div className="mt-1">
              <PortfolioTypeBadge type={active.type} />
            </div>
            {canSwitch && (
              <Link to="/select-portfolio" className="block mt-2 text-xs text-[var(--color-sky)] hover:underline">
                Switch portfolio
              </Link>
            )}
          </div>
        )}
        <nav className="flex flex-col gap-1 flex-1" aria-label="Primary">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${
                  isActive ? "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]" : "text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-dim)]"
                }`
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[var(--color-line)] pt-4 mt-4">
          <p className="text-sm font-medium text-[var(--color-ink)] px-2 truncate">{user?.fullName}</p>
          <button onClick={logout} className="mt-2 w-full text-left px-2 py-2 text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-brick)]">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] bg-white px-4 md:px-8 py-4">
          <div className="md:hidden min-w-0">
            <div className="font-display text-lg font-semibold text-[var(--color-eucalyptus)] leading-tight">Revenue Expense Tracker</div>
            {active && (
              <p className="text-xs text-[var(--color-ink-soft)] truncate">
                {active.name}
                {canSwitch && (
                  <>
                    {" · "}
                    <Link to="/select-portfolio" className="text-[var(--color-sky)]">
                      Switch
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
          <div className="ml-auto">
            <FinancialYearSwitcher />
          </div>
        </header>

        <main id="main-content" className="flex-1 px-4 md:px-8 py-6 pb-24 md:pb-6 max-w-6xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--color-line)] flex justify-around py-2 z-20"
        aria-label="Primary"
      >
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 px-2 py-1 text-xs ${isActive ? "text-[var(--color-eucalyptus)]" : "text-[var(--color-ink-soft)]"}`}
          >
            <span aria-hidden className="text-lg leading-none">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
