import { Link } from "react-router-dom";
import { usePortfolio } from "../context/PortfolioContext";
import { DataBackupCard } from "../components/DataBackupCard";
import { SectionHeading } from "../components/ui";

/** Backup and restore, kept out of the dashboard so it stays uncluttered. */
export default function DataPage() {
  const { active } = usePortfolio();
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link to="/" className="text-sm text-[var(--color-sky)] hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <SectionHeading
        title="Your data"
        subtitle={`Download everything in ${active ? `“${active.name}”` : "this portfolio"} as one CSV file, or bring it back from a file you saved earlier.`}
      />
      {active?.type === "COMPANY" && (
        <p className="text-sm rounded-xl bg-[var(--color-ochre-tint)] text-[#7a4d1a] px-4 py-3">
          Your company's accounting records (sales, expenses, journal entries and the chart of accounts) aren't part of this backup yet. To keep a copy of them, use <span className="font-medium">Download CSV</span> on each report under{" "}
          <Link to="/business/reports" className="underline">
            Reports
          </Link>
          .
        </p>
      )}
      <DataBackupCard />
    </div>
  );
}
