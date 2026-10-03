import { useEffect, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePortfolio } from "../context/PortfolioContext";
import { PortfolioTypeBadge } from "../components/PortfolioTypeBadge";
import { PortfolioDataPanel, type PortfolioScope } from "../components/PortfolioDataPanel";
import { BackupRestoreCard } from "../components/BackupRestoreCard";
import { Card, SectionHeading } from "../components/ui";

const PORTFOLIO_SECTIONS: PortfolioScope[] = ["properties", "investments"];
type Section = PortfolioScope | "backup";

/** Highlights (and scrolls to) the section named in ?section=, e.g. from a dashboard's Import/Export button. */
function Highlight({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  return (
    <section id={id} data-highlighted={active ? "true" : undefined} className="scroll-mt-24">
      <div className={`rounded-2xl transition-shadow ${active ? "ring-2 ring-[var(--color-eucalyptus)] ring-offset-2" : ""}`}>{children}</div>
    </section>
  );
}

/**
 * The one place for importing and exporting data, for every portfolio type (Personal Finance and
 * Company Finance both reach it from their own "Import/Export" menu item). It acts on the portfolio
 * that is open — the server scopes every export and import to the signed-in portfolio — so the page
 * names that portfolio at the top.
 *
 *   1. Portfolio data  — properties and investments as CSV (same file format as the backup)
 *   2. Backup & restore — everything in this portfolio as one CSV, and bring it back
 *   3. Company Finance only — where the accounting records can be downloaded (report CSVs)
 *
 * Deep links: /import-export?section=properties|investments|backup (the old /data page redirects to
 * ?section=backup).
 */
export default function ImportExportPage() {
  const { active } = usePortfolio();
  const [params] = useSearchParams();
  const requested = params.get("section");
  const section: Section | null = requested === "backup" ? "backup" : (PORTFOLIO_SECTIONS.find((s) => s === requested) ?? null);
  const isCompany = active?.type === "COMPANY";

  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(section === "backup" ? "backup-restore" : `${section}-portfolio`);
    // jsdom (and very old browsers) have no scrollIntoView
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [section]);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <SectionHeading title="Import/Export" subtitle="Download your data as CSV files, or bring it back from a file you exported here." />
        {active && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-soft)] -mt-2">
            Working in <span className="font-medium text-[var(--color-ink)]">“{active.name}”</span>
            <PortfolioTypeBadge type={active.type} />
            <span>— nothing here touches your other portfolios.</span>
          </p>
        )}
      </div>

      <div className="space-y-6">
        <h2 className="font-display text-lg font-semibold">Portfolio data</h2>
        <PortfolioDataPanel scope="properties" highlighted={section === "properties"} />
        <PortfolioDataPanel scope="investments" highlighted={section === "investments"} />
      </div>

      <div className="space-y-4">
        <h2 className="font-display text-lg font-semibold">Backup &amp; restore</h2>
        <Highlight id="backup-restore" active={section === "backup"}>
          <BackupRestoreCard />
        </Highlight>
      </div>

      {isCompany && (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold">Accounting records</h2>
          <Card>
            <p className="text-sm text-[var(--color-ink-soft)]">
              Your company's accounting records — sales, expenses, journal entries and the chart of accounts — aren't part of the backup above yet, and can't be imported from a file. To keep a copy, use{" "}
              <span className="font-medium text-[var(--color-ink)]">Download CSV</span> on each report (income statement, balance sheet, trial balance, GST/BAS, general ledger and more).
            </p>
            <div className="mt-3">
              <Link to="/business/reports" className="text-sm font-medium text-[var(--color-sky)] hover:underline">
                Go to Reports →
              </Link>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
