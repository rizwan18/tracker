import type { PortfolioType } from "../api/types";
import { PORTFOLIO_TYPE_INFO } from "../lib/portfolioType";

export function PortfolioTypeBadge({ type }: { type: PortfolioType }) {
  const info = PORTFOLIO_TYPE_INFO[type] ?? PORTFOLIO_TYPE_INFO.OTHER;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${info.badge}`}>
      <span aria-hidden>{info.icon}</span>
      {info.label}
    </span>
  );
}
