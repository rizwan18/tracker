import type { PortfolioType } from "../api/types";

export const PORTFOLIO_TYPES: PortfolioType[] = ["PERSONAL", "COMPANY", "TRUST", "OTHER"];

interface PortfolioTypeInfo {
  label: string;
  description: string;
  icon: string;
  badge: string;
}

export const PORTFOLIO_TYPE_INFO: Record<PortfolioType, PortfolioTypeInfo> = {
  PERSONAL: {
    label: "Personal Finance",
    description: "Your own income and spending, home, investments and bills.",
    icon: "👤",
    badge: "bg-[var(--color-sky-tint)] text-[#264a5c]",
  },
  COMPANY: {
    label: "Company Finance",
    description: "Income, expenses, property and investments of a company or business.",
    icon: "🏢",
    badge: "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]",
  },
  TRUST: {
    label: "Trust Finance",
    description: "A family, unit or investment trust's income, expenses and assets.",
    icon: "🏛️",
    badge: "bg-[var(--color-ochre-tint)] text-[#7a4d1a]",
  },
  OTHER: {
    label: "Other Type",
    description: "Anything else — a club, partnership, self-managed fund or project.",
    icon: "📁",
    badge: "bg-[var(--color-paper-dim)] text-[var(--color-ink)]",
  },
};

export function defaultPortfolioName(type: PortfolioType): string {
  return PORTFOLIO_TYPE_INFO[type].label;
}
