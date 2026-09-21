import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { StakePreview, StakePreviewHolding } from "../api/types";
import { Button } from "./ui";
import { MARKET_TITLES, formatPrice, formatUnits } from "../lib/holdings";
import { formatDateUtc, formatMoney } from "../lib/format";

const MAX_BYTES = 5 * 1024 * 1024;

const ACTION_LABEL: Record<StakePreviewHolding["action"], string> = { create: "New", update: "Update", unchanged: "Same" };
const ACTION_STYLE: Record<StakePreviewHolding["action"], string> = {
  create: "bg-[var(--color-eucalyptus-tint)] text-[var(--color-eucalyptus-dark)]",
  update: "bg-[var(--color-sky-tint)] text-[#264a5c]",
  unchanged: "bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)]",
};

type Stage = { name: "choose" } | { name: "checking" } | { name: "preview"; file: File; preview: StakePreview } | { name: "importing" } | { name: "done"; preview: StakePreview };

/**
 * Import a Stake "Portfolio Valuation" report (.xlsx). Shows exactly what will be added or updated
 * first; nothing changes until the person confirms.
 */
export function StakeImportModalBody({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const [error, setError] = useState<string | null>(null);
  const [zeroMissing, setZeroMissing] = useState(true);

  async function send(file: File, dryRun: boolean): Promise<StakePreview> {
    const body = new FormData();
    body.append("file", file);
    body.append("dryRun", String(dryRun));
    body.append("zeroMissing", String(zeroMissing));
    return api.upload<StakePreview>("/investments/import/stake", body);
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) return setError("That file is larger than 5 MB, which is too big for a Stake report.");
    if (!/\.xlsx$/i.test(file.name)) return setError("Please choose the Excel (.xlsx) report from Stake.");
    setStage({ name: "checking" });
    try {
      setStage({ name: "preview", file, preview: await send(file, true) });
    } catch (err) {
      setStage({ name: "choose" });
      setError(err instanceof ApiError ? err.message : "We couldn't read that file. Please choose the Portfolio Valuation report from Stake.");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  async function confirm(file: File) {
    setError(null);
    setStage({ name: "importing" });
    try {
      const result = await send(file, false);
      setStage({ name: "done", preview: result });
      onDone();
    } catch (err) {
      setStage({ name: "choose" });
      setError(err instanceof ApiError ? err.message : "The import didn't complete and nothing was changed. Please try again.");
    }
  }

  if (stage.name === "importing") return <p className="text-[var(--color-ink-soft)]">Importing your holdings…</p>;

  if (stage.name === "done") {
    const c = stage.preview.counts;
    return (
      <div className="space-y-4">
        <p role="status" className="text-[var(--color-ink)]">
          Done — <span className="font-semibold">{c.create}</span> added, <span className="font-semibold">{c.update}</span> updated{c.unchanged > 0 ? `, ${c.unchanged} already up to date` : ""}
          {c.zeroed > 0 ? `, ${c.zeroed} set to zero units` : ""}. Values are as at {formatDateUtc(stage.preview.report.statementDate)}.
        </p>
        <div className="flex justify-end">
          <Button onClick={onCancel}>Done</Button>
        </div>
      </div>
    );
  }

  if (stage.name === "preview") {
    const { preview, file } = stage;
    const c = preview.counts;
    const changes = c.create + c.update + (zeroMissing ? c.zeroed : 0);
    const markets = (["ASX", "WALL_ST"] as const).map((m) => ({ m, rows: preview.holdings.filter((h) => h.market === m) })).filter((g) => g.rows.length > 0);
    return (
      <div className="space-y-4">
        <div>
          <p className="font-medium">{preview.report.reportType ?? "Portfolio valuation"}</p>
          <p className="text-sm text-[var(--color-ink-soft)]">
            {file.name} · statement date {formatDateUtc(preview.report.statementDate)}
            {preview.report.ownerName ? ` · ${preview.report.ownerName}` : ""}
          </p>
        </div>

        <p role="status">
          {changes === 0 ? (
            <>Everything in this report is already recorded, so there's nothing to import.</>
          ) : (
            <>
              <span className="font-semibold">{c.create}</span> new, <span className="font-semibold">{c.update}</span> to update{c.unchanged > 0 ? `, ${c.unchanged} unchanged` : ""}.
            </>
          )}
        </p>

        {markets.map(({ m, rows }) => (
          <div key={m}>
            <h4 className="font-display font-semibold mb-1">{MARKET_TITLES[m]}</h4>
            <div className="overflow-x-auto rounded-xl border border-[var(--color-line)]">
              <table className="w-full text-sm min-w-[32rem]">
                <thead className="bg-[var(--color-paper-dim)] text-left text-xs text-[var(--color-ink-soft)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Symbol</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium text-right">Units</th>
                    <th className="px-3 py-2 font-medium text-right">Mkt. Price</th>
                    <th className="px-3 py-2 font-medium text-right">Mkt. Value (A$)</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {rows.map((h) => (
                    <tr key={`${h.market}-${h.symbol}`}>
                      <td className="px-3 py-2 font-medium">{h.symbol}</td>
                      <td className="px-3 py-2">{h.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatUnits(h.units)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPrice(h.marketPrice, h.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(h.marketValueAud)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${ACTION_STYLE[h.action]}`} title={h.existingName ? `Matches “${h.existingName}”` : undefined}>
                          {ACTION_LABEL[h.action]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {preview.missing.length > 0 && (
          <label className="flex items-start gap-2 text-sm rounded-xl bg-[var(--color-ochre-tint)] px-4 py-3">
            <input type="checkbox" checked={zeroMissing} onChange={(e) => setZeroMissing(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[var(--color-eucalyptus)]" />
            <span>
              These earlier Stake holdings aren't in this report: <span className="font-medium">{preview.missing.map((m) => m.ticker ?? m.name).join(", ")}</span>. Set them to zero units as at {formatDateUtc(preview.report.statementDate)} (recommended if you sold them).
            </span>
          </label>
        )}

        {preview.warnings.length > 0 && (
          <details className="rounded-xl bg-[var(--color-paper-dim)] px-4 py-3 text-sm" open>
            <summary className="cursor-pointer font-medium">Things to know ({preview.warnings.length})</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}

        {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {changes === 0 ? "Close" : "Cancel"}
          </Button>
          {changes > 0 && <Button onClick={() => confirm(file)}>Import {c.create + c.update} {c.create + c.update === 1 ? "holding" : "holdings"}</Button>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-ink-soft)]">
        In Stake, download your <span className="font-medium text-[var(--color-ink)]">Portfolio Valuation</span> report as an Excel file, then choose it here. You'll see what will change before anything is saved.
      </p>
      {error && <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{error}</p>}
      <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Choose the Stake report" onChange={(e) => choose(e.target.files?.[0])} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => input.current?.click()} disabled={stage.name === "checking"}>
          {stage.name === "checking" ? "Reading report…" : "Choose Stake report (.xlsx)"}
        </Button>
      </div>
    </div>
  );
}
