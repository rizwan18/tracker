import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card } from "./ui";
import { ImportDialogs, useCsvTransfer } from "./CsvTransfer";

export type PortfolioScope = "properties" | "investments";

const COPY = {
  properties: {
    title: "Property Portfolio",
    what: "property portfolio",
    text: "Export your property portfolio to a CSV file, or import properties from a CSV you exported here. Each property comes with its ownership, rental schedule lines, yearly rental details, manager details and picture links.",
    footnote: "Rent and expense entries and bills aren't part of this file — they're in “Your data”.",
    exportLabel: "Export property portfolio CSV",
    importLabel: "Import property portfolio CSV",
    viewTo: "/properties",
    viewLabel: "View your property portfolio",
  },
  investments: {
    title: "Shares, ETFs & Other Investments",
    what: "investment portfolio",
    text: "Export your shares, ETFs and other investments to a CSV file, or import them from a CSV you exported here. It includes each holding's type, market, units and prices, buys and sells, dividends and capital gains disposals.",
    footnote: "To bring in a Stake statement (.xlsx), use “Import from Stake” on the Shares and ETFs page.",
    exportLabel: "Export investment portfolio CSV",
    importLabel: "Import investment portfolio CSV",
    viewTo: "/investments",
    viewLabel: "View your investments",
  },
} as const;

/**
 * Export/import of one portfolio. It is the same download/import as "Your data" (same file format,
 * same review-before-importing step, same rules: only missing items are added and nothing existing
 * is changed) limited to that portfolio. The single home for this UI is the Import / Export page;
 * the Properties and Investments dashboards only link to it.
 */
export function PortfolioDataPanel({ scope, highlighted = false, onImported }: { scope: PortfolioScope; highlighted?: boolean; onImported?: () => void }) {
  const copy = COPY[scope];
  const [imported, setImported] = useState(false);
  const transfer = useCsvTransfer({
    scope,
    onImported: () => {
      setImported(true);
      onImported?.();
    },
  });
  const { fileInput, exporting, exportError, stage, importError, handleExport, handleFile, chooseFile } = transfer;

  return (
    <section id={`${scope}-portfolio`} aria-labelledby={`portfolio-data-${scope}`} data-highlighted={highlighted ? "true" : undefined} className="scroll-mt-24">
      <div className={`rounded-2xl transition-shadow ${highlighted ? "ring-2 ring-[var(--color-eucalyptus)] ring-offset-2" : ""}`}>
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <h2 id={`portfolio-data-${scope}`} className="font-display text-lg font-semibold">
                {copy.title}
              </h2>
              <p className="text-sm text-[var(--color-ink-soft)] mt-1">{copy.text} Only new items are added — nothing you already have is changed, so it's safe to import the same file again.</p>
              <p className="text-xs text-[var(--color-ink-soft)] mt-2">{copy.footnote}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleExport} disabled={exporting} aria-label={copy.exportLabel}>
                {exporting ? "Preparing…" : "Export CSV"}
              </Button>
              <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" aria-label={`Choose a ${copy.what} CSV file to import`} onChange={(e) => handleFile(e.target.files?.[0])} />
              <Button variant="secondary" onClick={chooseFile} disabled={stage.name === "checking"} aria-label={copy.importLabel}>
                {stage.name === "checking" ? "Reading file…" : "Import CSV"}
              </Button>
            </div>
          </div>
          {exportError && (
            <p role="alert" className="text-sm text-[var(--color-brick)] mt-3">
              {exportError}
            </p>
          )}
          {importError && (
            <p role="alert" className="text-sm text-[var(--color-brick)] mt-3">
              {importError}
            </p>
          )}
          {imported && stage.name === "idle" && (
            <p aria-live="polite" className="text-sm text-[var(--color-eucalyptus-dark)] mt-3">
              Import finished.{" "}
              <Link to={copy.viewTo} className="font-medium underline">
                {copy.viewLabel} →
              </Link>
            </p>
          )}
          <ImportDialogs transfer={transfer} />
        </Card>
      </div>
    </section>
  );
}
