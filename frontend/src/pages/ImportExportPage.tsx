import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PortfolioDataPanel, type PortfolioScope } from "../components/PortfolioDataPanel";
import { SectionHeading } from "../components/ui";

const SECTIONS: PortfolioScope[] = ["properties", "investments"];

/**
 * The one place for portfolio CSV export and import. The Properties and Investments dashboards
 * link here with ?section=properties|investments, which highlights (and scrolls to) that part.
 */
export default function ImportExportPage() {
  const [params] = useSearchParams();
  const requested = params.get("section");
  const section = SECTIONS.find((s) => s === requested) ?? null;

  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(`${section}-portfolio`);
    // jsdom (and very old browsers) have no scrollIntoView
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [section]);

  return (
    <div className="space-y-6 max-w-4xl">
      <SectionHeading title="Import / Export" subtitle="Download your portfolios as CSV files, or bring them back from a file you exported here." />

      <PortfolioDataPanel scope="properties" highlighted={section === "properties"} />
      <PortfolioDataPanel scope="investments" highlighted={section === "investments"} />

      <p className="text-sm text-[var(--color-ink-soft)]">
        Want a backup of everything — income and expenses, bills, reminders and your details too? Use{" "}
        <Link to="/data" className="text-[var(--color-sky)] hover:underline">
          Your data
        </Link>
        .
      </p>
    </div>
  );
}
