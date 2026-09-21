import { Button, Card } from "./ui";
import { ImportDialogs, useCsvTransfer } from "./CsvTransfer";

/**
 * "Your data": download everything as one CSV, and bring it back from that same
 * file later. Importing shows what it will do first, adds only what's missing
 * (so importing the same file twice changes nothing) and never overwrites what
 * is already there.
 */
export function DataBackupCard({ onImported }: { onImported?: () => void }) {
  const transfer = useCsvTransfer({ scope: "all", onImported });
  const { fileInput, exporting, exportError, stage, importError, handleExport, handleFile, chooseFile } = transfer;

  return (
    <Card>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-display font-semibold">Download all my data</h3>
          <p className="text-sm text-[var(--color-ink-soft)] mt-1">
            One CSV file with everything you've entered: your details, accounts, income and expenses, properties, investments, dividends, bills and reminders. Keep it somewhere safe as a backup — it opens in Excel or Google Sheets.
          </p>
          <div className="mt-3">
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? "Preparing…" : "Download my data (CSV)"}
            </Button>
          </div>
          {exportError && <p role="alert" className="text-sm text-[var(--color-brick)] mt-2">{exportError}</p>}
        </div>

        <div>
          <h3 className="font-display font-semibold">Import my data</h3>
          <p className="text-sm text-[var(--color-ink-soft)] mt-1">
            Choose a file you downloaded here and everything in it comes back. You'll see a summary first. Only missing items are added — nothing you already have is changed, so it's safe to import the same file again.
          </p>
          <div className="mt-3">
            <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose a CSV file to import" onChange={(e) => handleFile(e.target.files?.[0])} />
            <Button variant="secondary" onClick={chooseFile} disabled={stage.name === "checking"}>
              {stage.name === "checking" ? "Reading file…" : "Import from a CSV file"}
            </Button>
          </div>
          {importError && <p role="alert" className="text-sm text-[var(--color-brick)] mt-2">{importError}</p>}
        </div>
      </div>
      <p className="text-xs text-[var(--color-ink-soft)] mt-4 border-t border-[var(--color-line)] pt-3">
        Your password is never included, and importing never changes your email address or password. Uploaded document files stay where they are — the file keeps links to them. The CSV holds all of your financial information, so store it securely.
      </p>

      <ImportDialogs transfer={transfer} />
    </Card>
  );
}
