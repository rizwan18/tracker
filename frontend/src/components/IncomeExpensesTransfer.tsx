import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { IncomeExpensesImportResult } from "../api/types";
import { Button, Card } from "./ui";
import { Modal } from "./Modal";
import { MAX_FILE_BYTES } from "./CsvTransfer";

type Stage =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "preview"; csv: string; fileName: string; result: IncomeExpensesImportResult }
  | { name: "importing" }
  | { name: "done"; result: IncomeExpensesImportResult };

const STATUS_STYLE = {
  ready: { label: "Ready", cls: "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]" },
  duplicate: { label: "Possible duplicate", cls: "bg-[var(--color-ochre-tint)] text-[#7a4d1a]" },
  error: { label: "Needs attention", cls: "bg-[var(--color-brick-tint)] text-[var(--color-brick)]" },
} as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;

/**
 * The simple way to get income & expenses out of the app and back in: a plain spreadsheet with readable column
 * headings. Export, edit in Excel or Google Sheets, import it again — it shows what it found before anything is saved.
 */
export function IncomeExpensesTransfer({ business }: { business: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "template" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  const title = business ? "Sales & expenses" : "Income & expenses";
  const noun = business ? "sales and expenses" : "income and expenses";
  const prefix = business ? "business-sales-and-expenses" : "personal-income-and-expenses";

  async function download(kind: "export" | "template") {
    setError(null);
    setBusy(kind);
    try {
      const blob = await api.get<Blob>(`/data/income-expenses/${kind}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "export" ? `${prefix}-${new Date().toISOString().slice(0, 10)}.csv` : `${prefix}-template.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't prepare your download. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function chooseFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_BYTES) return setError("That file is larger than 4 MB. Please import it in smaller parts.");
    setStage({ name: "checking" });
    try {
      const csv = await file.text();
      const result = await api.post<IncomeExpensesImportResult>("/data/income-expenses/import", { csv, dryRun: true });
      setIncludeDuplicates(false);
      setStage({ name: "preview", csv, fileName: file.name, result });
    } catch (err) {
      setStage({ name: "idle" });
      setError(err instanceof ApiError ? err.message : "We couldn't read that file. Please choose a CSV file.");
    }
  }

  async function confirm(csv: string) {
    setStage({ name: "importing" });
    try {
      const result = await api.post<IncomeExpensesImportResult>("/data/income-expenses/import", { csv, dryRun: false, importDuplicates: includeDuplicates });
      setStage({ name: "done", result });
    } catch (err) {
      setStage({ name: "idle" });
      setError(err instanceof ApiError ? err.message : "The import didn't complete and nothing was changed. Please try again.");
    }
  }

  const close = () => setStage({ name: "idle" });

  return (
    <Card>
      <h3 className="font-display font-semibold">{title}</h3>
      <p className="text-sm text-[var(--color-ink-soft)] mt-1">
        Download your {noun} as a spreadsheet, edit or add rows in Excel or Google Sheets, then import it back. The columns are plain English{business ? ", with the GST on each row" : ""} — no codes or IDs.
      </p>
      <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" aria-label={`${title} CSV file`} onChange={(e) => void chooseFile(e.target.files?.[0])} />
      <div className="flex flex-wrap gap-2 mt-4">
        <Button onClick={() => void download("export")} disabled={busy !== null}>{busy === "export" ? "Preparing…" : "Export CSV"}</Button>
        <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={stage.name === "checking"}>{stage.name === "checking" ? "Checking file…" : "Import CSV"}</Button>
        <Button variant="ghost" onClick={() => void download("template")} disabled={busy !== null}>{busy === "template" ? "Preparing…" : "Download CSV template"}</Button>
      </div>
      <p className="text-xs text-[var(--color-ink-soft)] mt-3">
        Dates are day/month/year, like 25/10/2026. Importing shows you what it found first, skips anything you already have, and never changes existing records.
      </p>
      {error && <p role="alert" className="text-sm text-[var(--color-brick)] mt-3">{error}</p>}

      {stage.name === "preview" && <PreviewDialog stage={stage} includeDuplicates={includeDuplicates} setIncludeDuplicates={setIncludeDuplicates} onConfirm={() => void confirm(stage.csv)} onClose={close} />}
      {stage.name === "importing" && (
        <Modal title="Importing…" onClose={() => undefined}>
          <p className="text-sm text-[var(--color-ink-soft)]">Adding your {noun}. Please keep this page open.</p>
        </Modal>
      )}
      {stage.name === "done" && (
        <Modal title="Import complete" onClose={close}>
          <p className="text-[var(--color-ink)]" role="status">
            <span className="font-semibold">{plural(stage.result.imported ?? 0, stage.result.noun)}</span> added.
          </p>
          {stage.result.totals.errors > 0 && (
            <p className="text-sm text-[var(--color-ink-soft)] mt-2">
              {plural(stage.result.totals.errors, "row")} needing attention {stage.result.totals.errors === 1 ? "was" : "were"} skipped. Fix {stage.result.totals.errors === 1 ? "it" : "them"} in your file and import it again — rows you've already imported are recognised and skipped.
            </p>
          )}
          <div className="flex justify-end mt-5">
            <Button onClick={close}>Done</Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function PreviewDialog({
  stage, includeDuplicates, setIncludeDuplicates, onConfirm, onClose,
}: {
  stage: Extract<Stage, { name: "preview" }>;
  includeDuplicates: boolean;
  setIncludeDuplicates: (v: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { result } = stage;
  const t = result.totals;
  const willImport = t.ready + (includeDuplicates ? t.duplicates : 0);
  const problems = result.rows.filter((r) => r.messages.length > 0);

  return (
    <div className="fixed inset-0 z-30 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Review before importing" className="w-full md:max-w-4xl bg-white rounded-t-2xl md:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-line)] sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-display text-lg font-semibold">Review before importing</h2>
            <p className="text-xs text-[var(--color-ink-soft)]">{stage.fileName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] text-xl leading-none px-2">×</button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <p className="text-lg font-semibold text-[var(--color-ink)]">{plural(t.found, result.noun)} found</p>
            <ul className="mt-2 grid sm:grid-cols-3 gap-2 text-sm">
              <li className="rounded-xl px-3 py-2 bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]"><span className="font-semibold">{t.ready.toLocaleString("en-AU")}</span> ready to import</li>
              <li className="rounded-xl px-3 py-2 bg-[var(--color-ochre-tint)] text-[#7a4d1a]"><span className="font-semibold">{t.duplicates.toLocaleString("en-AU")}</span> possible {t.duplicates === 1 ? "duplicate" : "duplicates"}</li>
              <li className={`rounded-xl px-3 py-2 ${t.errors > 0 ? "bg-[var(--color-brick-tint)] text-[var(--color-brick)]" : "bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]"}`}><span className="font-semibold">{t.errors.toLocaleString("en-AU")}</span> {t.errors === 1 ? "row needs" : "rows need"} attention</li>
            </ul>
          </div>

          {result.ignoredColumns.length > 0 && (
            <p className="text-sm text-[var(--color-ink-soft)]">
              These columns aren't used and were ignored: {result.ignoredColumns.map((c) => `“${c}”`).join(", ")}.
            </p>
          )}

          {problems.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-ink)] mb-2">Things to know</h3>
              <ul className="space-y-1.5 text-sm" aria-label="Problems and notes">
                {problems.slice(0, 100).flatMap((r) =>
                  r.messages.map((m, i) => (
                    <li key={`${r.rowNumber}-${i}`} className={m.level === "error" ? "text-[var(--color-brick)]" : m.level === "warning" ? "text-[#7a4d1a]" : "text-[var(--color-ink-soft)]"}>
                      <span className="font-medium">Row {r.rowNumber}:</span> {m.text}
                    </li>
                  ))
                )}
              </ul>
              {problems.length > 100 && <p className="text-xs text-[var(--color-ink-soft)] mt-1">…and {problems.length - 100} more rows with notes.</p>}
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-ink)] mb-2">What will be imported</h3>
            <div className="overflow-x-auto rounded-xl border border-[var(--color-line)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-paper-dim)] text-left text-xs text-[var(--color-ink-soft)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    {result.columns.map((c) => <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">{c}</th>)}
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {result.rows.map((r) => (
                    <tr key={r.rowNumber} className={r.status === "error" ? "bg-[var(--color-brick-tint)]/40" : undefined}>
                      <td className="px-3 py-2 text-[var(--color-ink-soft)]">{r.rowNumber}</td>
                      {r.cells.map((cell, i) => <td key={i} className="px-3 py-2 max-w-[16rem] truncate">{cell}</td>)}
                      <td className="px-3 py-2 whitespace-nowrap"><span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_STYLE[r.status].cls}`}>{STATUS_STYLE[r.status].label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.hiddenReadyRows > 0 && <p className="text-xs text-[var(--color-ink-soft)] mt-2">…and {plural(result.hiddenReadyRows, "more ready row")} not shown.</p>}
          </div>

          {t.duplicates > 0 && (
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
              <span>
                Also import the {plural(t.duplicates, "possible duplicate")}. <span className="text-[var(--color-ink-soft)]">They match something you already have, so they're skipped unless you tick this.</span>
              </span>
            </label>
          )}
          {t.errors > 0 && (
            <p className="text-sm text-[var(--color-ink-soft)]">
              {plural(t.errors, "row")} with a problem will be skipped. Fix {t.errors === 1 ? "it" : "them"} in your file and import again — rows already imported are recognised and skipped.
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={onConfirm} disabled={willImport === 0}>{willImport === 0 ? "Nothing to import" : `Import ${plural(willImport, result.noun)}`}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
