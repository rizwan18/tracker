import { useRef, useState, type RefObject } from "react";
import { api, ApiError } from "../api/client";
import type { ImportResult } from "../api/types";
import { Button } from "./ui";
import { Modal } from "./Modal";

// Vercel rejects request bodies above ~4.5 MB.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * What a CSV export/import covers. "all" is the whole "Your data" backup; the other two are the
 * portfolio dashboards. They all use the same file format and the same server routes — the scope
 * only chooses which sections are written or read.
 */
export type CsvScope = "all" | "properties" | "investments";

export const CSV_FILE_NAMES: Record<CsvScope, () => string> = {
  all: () => `revenue-expense-tracker-${new Date().toISOString().slice(0, 10)}.csv`,
  properties: () => "property_portfolio.csv",
  investments: () => "investment_portfolio.csv",
};

export type CsvStage =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "preview"; csv: string; fileName: string; result: ImportResult }
  | { name: "importing" }
  | { name: "done"; result: ImportResult };

/**
 * Download and import of a CSV, shared by "Your data" and the portfolio dashboards.
 * Importing always shows what it will do first (a dry run), adds only what's missing and
 * never changes what is already there.
 */
export function useCsvTransfer({ scope = "all", onImported }: { scope?: CsvScope; onImported?: () => void } = {}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [stage, setStage] = useState<CsvStage>({ name: "idle" });
  const [importError, setImportError] = useState<string | null>(null);
  const [includeProfile, setIncludeProfile] = useState(true);
  // Only portfolio imports name their scope, so the "Your data" requests are exactly what they always were.
  const scopeBody = scope === "all" ? {} : { scope };

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const blob = await api.get<Blob>(scope === "all" ? "/data/export" : `/data/export?scope=${scope}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = CSV_FILE_NAMES[scope]();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "We couldn't prepare your download. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    if (file.size > MAX_FILE_BYTES) {
      setImportError("That file is larger than 4 MB, which is more than can be imported in one go. If it's a full export, try splitting it by removing older years.");
      return;
    }
    setStage({ name: "checking" });
    try {
      const csv = await file.text();
      const result = await api.post<ImportResult>("/data/import", { csv, dryRun: true, includeProfile, ...scopeBody });
      setStage({ name: "preview", csv, fileName: file.name, result });
    } catch (err) {
      setStage({ name: "idle" });
      setImportError(err instanceof ApiError ? err.message : "We couldn't read that file. Please choose the CSV you downloaded from this app.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function confirmImport(csv: string) {
    setStage({ name: "importing" });
    setImportError(null);
    try {
      const result = await api.post<ImportResult>("/data/import", { csv, dryRun: false, includeProfile, ...scopeBody });
      setStage({ name: "done", result });
      onImported?.();
    } catch (err) {
      setStage({ name: "idle" });
      setImportError(err instanceof ApiError ? err.message : "The import didn't complete and nothing was changed. Please try again.");
    }
  }

  const close = () => setStage({ name: "idle" });
  const chooseFile = () => fileInput.current?.click();

  return { fileInput: fileInput as RefObject<HTMLInputElement>, exporting, exportError, stage, importError, includeProfile, setIncludeProfile, handleExport, handleFile, confirmImport, close, chooseFile };
}

export type CsvTransfer = ReturnType<typeof useCsvTransfer>;

/** The review-before-importing and import-complete dialogs. */
export function ImportDialogs({ transfer }: { transfer: CsvTransfer }) {
  const { stage, includeProfile, setIncludeProfile, confirmImport, close } = transfer;
  return (
    <>
      {(stage.name === "preview" || stage.name === "importing") && (
        <Modal title="Review before importing" onClose={close}>
          {stage.name === "importing" ? (
            <p className="text-[var(--color-ink-soft)]">Importing your data…</p>
          ) : (
            <Preview
              fileName={stage.fileName}
              result={stage.result}
              includeProfile={includeProfile}
              onIncludeProfile={setIncludeProfile}
              onConfirm={() => confirmImport(stage.csv)}
              onCancel={close}
            />
          )}
        </Modal>
      )}

      {stage.name === "done" && (
        <Modal title="Import complete" onClose={close}>
          <Done result={stage.result} onClose={close} />
        </Modal>
      )}
    </>
  );
}

function sumOf(result: ImportResult, key: "toAdd" | "alreadyThere" | "skipped") {
  return result.sections.filter((s) => s.key !== "profile").reduce((n, s) => n + s[key], 0);
}

function Preview({
  fileName,
  result,
  includeProfile,
  onIncludeProfile,
  onConfirm,
  onCancel,
}: {
  fileName: string;
  result: ImportResult;
  includeProfile: boolean;
  onIncludeProfile: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const toAdd = sumOf(result, "toAdd");
  const already = sumOf(result, "alreadyThere");
  const skipped = sumOf(result, "skipped");
  const hasProfile = result.sections.some((s) => s.key === "profile");
  const profileChange = includeProfile && !!result.profile;
  const nothingToDo = toAdd === 0 && !profileChange;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-ink-soft)]">
        <span className="font-medium text-[var(--color-ink)]">{fileName}</span>
      </p>

      <p className="text-[var(--color-ink)]" role="status">
        {nothingToDo ? (
          <>Everything in this file is already in your account, so there's nothing to import.</>
        ) : (
          <>
            <span className="font-semibold">{toAdd.toLocaleString("en-AU")}</span> {toAdd === 1 ? "item" : "items"} will be added.
            {already > 0 && <> {already.toLocaleString("en-AU")} already exist and will stay exactly as they are.</>}
          </>
        )}
      </p>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-line)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-paper-dim)] text-left text-[var(--color-ink-soft)]">
            <tr>
              <th className="px-3 py-2 font-medium">What</th>
              <th className="px-3 py-2 font-medium text-right">In file</th>
              <th className="px-3 py-2 font-medium text-right">New</th>
              <th className="px-3 py-2 font-medium text-right">Already there</th>
              <th className="px-3 py-2 font-medium text-right">Skipped</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {result.sections
              .filter((s) => s.key !== "profile")
              .map((s) => (
                <tr key={s.key}>
                  <td className="px-3 py-2">{s.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.inFile}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-[var(--color-eucalyptus)]">{s.toAdd}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-ink-soft)]">{s.alreadyThere}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${s.skipped > 0 ? "text-[var(--color-brick)] font-medium" : "text-[var(--color-ink-soft)]"}`}>{s.skipped}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {hasProfile && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={includeProfile} onChange={(e) => onIncludeProfile(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[var(--color-eucalyptus)]" />
          <span>
            Also update my name, timezone and display settings from the file
            {result.profile?.fullName && includeProfile && <span className="text-[var(--color-ink-soft)]"> (name will become “{result.profile.fullName}”)</span>}
          </span>
        </label>
      )}

      {skipped > 0 && (
        <p className="text-sm text-[var(--color-ink-soft)]">
          {skipped.toLocaleString("en-AU")} {skipped === 1 ? "row has" : "rows have"} a problem and will be skipped — details below. Everything else can still be imported.
        </p>
      )}

      <Messages title="Problems" tone="error" items={result.errors} total={result.errorCount} />
      <Messages title="Things to know" tone="warning" items={result.warnings} total={result.warningCount} />

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          {nothingToDo ? "Close" : "Cancel"}
        </Button>
        {!nothingToDo && <Button onClick={onConfirm}>Import {toAdd > 0 ? `${toAdd.toLocaleString("en-AU")} ${toAdd === 1 ? "item" : "items"}` : "now"}</Button>}
      </div>
    </div>
  );
}

function Messages({ title, tone, items, total }: { title: string; tone: "error" | "warning"; items: string[]; total: number }) {
  if (total === 0) return null;
  return (
    <details className={`rounded-xl px-4 py-3 text-sm ${tone === "error" ? "bg-[var(--color-brick-tint)]" : "bg-[var(--color-ochre-tint)]"}`} open={tone === "error"}>
      <summary className="cursor-pointer font-medium">
        {title} ({total})
      </summary>
      <ul className="mt-2 space-y-1 list-disc pl-5 max-h-48 overflow-y-auto">
        {items.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
        {total > items.length && <li>…and {total - items.length} more.</li>}
      </ul>
    </details>
  );
}

function Done({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const added = result.added ?? {};
  const rows = result.sections.filter((s) => s.key !== "profile" && (added[s.key] ?? 0) > 0);
  const total = rows.reduce((n, s) => n + (added[s.key] ?? 0), 0);
  return (
    <div className="space-y-4">
      <p role="status" className="text-[var(--color-ink)]">
        {total > 0 ? (
          <>
            <span className="font-semibold">{total.toLocaleString("en-AU")}</span> {total === 1 ? "item was" : "items were"} added to your account.
          </>
        ) : (
          <>Nothing new needed adding.</>
        )}
        {added.profile ? " Your profile settings were updated too." : ""}
      </p>
      {rows.length > 0 && (
        <ul className="text-sm space-y-1">
          {rows.map((s) => (
            <li key={s.key} className="flex justify-between">
              <span className="text-[var(--color-ink-soft)]">{s.label}</span>
              <span className="font-medium tabular-nums">{added[s.key]}</span>
            </li>
          ))}
        </ul>
      )}
      {result.errorCount > 0 && <p className="text-sm text-[var(--color-ink-soft)]">{result.errorCount} {result.errorCount === 1 ? "row was" : "rows were"} skipped because of problems.</p>}
      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
