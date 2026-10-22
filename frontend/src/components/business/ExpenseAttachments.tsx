import { useCallback, useEffect, useId, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { api, ApiError } from "../../api/client";
import type { AttachmentLimits, ExpenseAttachment } from "../../api/businessTypes";
import { Button, Card } from "../ui";
import { formatDate } from "../../lib/format";
import { FALLBACK_LIMITS, downloadAttachment, fileLabel, formatBytes, loadLimits, openAttachment, stageFiles, uploadStaged, type StagedFile } from "../../lib/attachments";

/** A small pill with the format ("PDF", "Excel"…), in the same style as the other status pills in Company Finance. */
function FormatPill({ name }: { name: string }) {
  return <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)] shrink-0">{fileLabel(name)}</span>;
}

/**
 * The files for one expense: a drop zone (or the normal file picker), the files chosen but not yet uploaded
 * (each can be cancelled), and — for an expense that already exists — the files already attached.
 *
 * The chosen files live in the parent (`staged`) so the expense form can upload them right after it saves the expense.
 */
export function ExpenseAttachments({
  entryId,
  staged,
  setStaged,
  disabled = false,
  reloadKey = 0,
  onSavedChange,
}: {
  entryId: string | null;
  staged: StagedFile[];
  setStaged: Dispatch<SetStateAction<StagedFile[]>>;
  disabled?: boolean;
  /** Change this to make the saved list reload (after an upload). */
  reloadKey?: number;
  /** Called after a saved file is removed, so a list showing counts can refresh. */
  onSavedChange?: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [limits, setLimits] = useState<AttachmentLimits>(FALLBACK_LIMITS);
  const [saved, setSaved] = useState<ExpenseAttachment[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(!!entryId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLimits().then((l) => !cancelled && setLimits(l));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSaved = useCallback(async () => {
    if (!entryId) return;
    try {
      const res = await api.get<{ items: ExpenseAttachment[] }>(`/business/entries/${entryId}/attachments`);
      setSaved(res.items);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "We couldn't load the attached files.");
    } finally {
      setLoadingSaved(false);
    }
  }, [entryId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server is synchronising with an external system
    loadSaved();
  }, [loadSaved, reloadKey]);

  function addFiles(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const result = stageFiles(Array.from(list), staged, limits, saved.length);
    setStaged(result.staged);
    setNotes(result.notes);
    if (input.current) input.current.value = ""; // so choosing the same file again works
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function act(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const remove = (a: ExpenseAttachment) =>
    act(a.id, async () => {
      if (!confirm(`Remove “${a.fileName}” from this expense? The file will be deleted. This can't be undone.`)) return;
      await api.delete(`/business/entries/${a.entryId}/attachments/${a.id}`);
      await loadSaved();
      onSavedChange?.();
    });

  const maxMb = formatBytes(limits.maxBytes);

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`block rounded-xl border-2 border-dashed px-4 py-4 text-center text-sm cursor-pointer focus-within:ring-2 focus-within:ring-[var(--color-eucalyptus)] ${
          dragging ? "border-[var(--color-eucalyptus)] bg-[var(--color-eucalyptus-tint)]" : "border-[var(--color-line)]"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <input ref={input} id={inputId} type="file" multiple disabled={disabled} className="sr-only" accept={limits.extensions.map((e) => `.${e}`).join(",")} aria-describedby={hintId} onChange={(e) => addFiles(e.target.files)} />
        <span className="font-medium text-[var(--color-eucalyptus)]">Choose files</span> <span className="text-[var(--color-ink-soft)]">or drop them here</span>
        <span id={hintId} className="block text-xs text-[var(--color-ink-soft)] mt-1">
          Invoices, receipts and other paperwork — {limits.summary}. Up to {maxMb} each.
        </span>
      </label>

      <div aria-live="polite">
        {notes.length > 0 && (
          <ul className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2 space-y-1" role="alert">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      {staged.length > 0 && (
        <ul className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)]" aria-label="Files ready to upload">
          {staged.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <FormatPill name={s.file.name} />
              <span className="flex-1 min-w-[8rem] truncate" title={s.file.name}>
                {s.file.name}
              </span>
              <span className="text-xs text-[var(--color-ink-soft)] shrink-0">{formatBytes(s.file.size)}</span>
              {s.status === "uploading" && (
                <span className="text-xs text-[var(--color-ink-soft)] inline-flex items-center gap-1.5" role="status">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-[var(--color-eucalyptus)] border-t-transparent animate-spin" aria-hidden />
                  Uploading…
                </span>
              )}
              {s.status === "done" && <span className="text-xs text-[var(--color-eucalyptus-dark)]">✓ Uploaded</span>}
              {s.status === "ready" && <span className="text-xs text-[var(--color-ink-soft)]">Ready</span>}
              {(s.status === "ready" || s.status === "failed") && (
                <button type="button" aria-label={`Cancel ${s.file.name}`} className="text-[var(--color-ink-soft)] hover:text-[var(--color-brick)] leading-none px-1" onClick={() => setStaged((cur) => cur.filter((x) => x.key !== s.key))}>
                  ✕
                </button>
              )}
              {s.status === "failed" && s.error && (
                <p role="alert" className="basis-full text-xs text-[var(--color-brick)]">
                  Didn't upload: {s.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {entryId && (
        <div>
          {loadError && (
            <p role="alert" className="text-sm text-[var(--color-brick)]">
              {loadError}{" "}
              <button type="button" className="underline" onClick={loadSaved}>
                Try again
              </button>
            </p>
          )}
          {actionError && (
            <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2 mb-2">
              {actionError}
            </p>
          )}
          {loadingSaved ? (
            <p className="text-sm text-[var(--color-ink-soft)]">Loading files…</p>
          ) : saved.length === 0 ? (
            !loadError && <p className="text-sm text-[var(--color-ink-soft)]">No files attached yet.</p>
          ) : (
            <Card className="p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]" aria-label="Attached files">
                {saved.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <FormatPill name={a.fileName} />
                    <div className="flex-1 min-w-[8rem]">
                      <p className="truncate font-medium" title={a.fileName}>
                        {a.fileName}
                      </p>
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {formatBytes(a.sizeBytes)} · Added {formatDate(a.uploadedAt)}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {a.previewable && (
                        <Button size="sm" variant="ghost" disabled={busyId === a.id} onClick={() => act(a.id, () => openAttachment(a))}>
                          Open
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => act(a.id, () => downloadAttachment(a))}>
                        Download
                      </Button>
                      <Button size="sm" variant="danger" disabled={busyId === a.id} onClick={() => remove(a)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/** The standalone dialog opened from an expense in the list: add files, then upload them straight away. */
export function ExpenseAttachmentsDialog({ entryId, description, onChanged, onClose }: { entryId: string; description: string; onChanged: () => void; onClose: () => void }) {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = staged.filter((s) => s.status !== "done");

  async function upload() {
    setUploading(true);
    setMessage(null);
    const patch = (key: string, p: Partial<StagedFile>) => setStaged((cur) => cur.map((s) => (s.key === key ? { ...s, ...p } : s)));
    const { uploaded, failed } = await uploadStaged(entryId, pending, patch);
    setUploading(false);
    setStaged((cur) => cur.filter((s) => s.status !== "done"));
    if (uploaded > 0) {
      setReloadKey((k) => k + 1);
      onChanged();
    }
    setMessage(failed === 0 ? `${uploaded} ${uploaded === 1 ? "file" : "files"} uploaded.` : uploaded > 0 ? `${uploaded} uploaded. ${failed} didn't — see below.` : "Nothing was uploaded — see below.");
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-ink-soft)]">{description}</p>
      <ExpenseAttachments entryId={entryId} staged={staged} setStaged={setStaged} disabled={uploading} reloadKey={reloadKey} onSavedChange={onChanged} />
      <p role="status" className="text-sm text-[var(--color-eucalyptus-dark)] min-h-5">
        {message}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button onClick={upload} disabled={uploading || pending.length === 0}>
          {uploading ? "Uploading…" : pending.length > 0 ? `Upload ${pending.length} ${pending.length === 1 ? "file" : "files"}` : "Upload"}
        </Button>
      </div>
    </div>
  );
}
