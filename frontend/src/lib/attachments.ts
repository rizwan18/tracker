import { api, ApiError } from "../api/client";
import type { AttachmentLimits, ExpenseAttachment } from "../api/businessTypes";

/**
 * Helpers for files attached to company expenses. The checks here are only a courtesy so people hear about a problem
 * before waiting for an upload — the server re-checks every file from its actual contents and is the real gate.
 */

/** Used until the server's own limits arrive (they are the same defaults the server uses). */
export const FALLBACK_LIMITS: AttachmentLimits = {
  maxBytes: 4 * 1024 * 1024,
  maxFiles: 20,
  extensions: ["pdf", "jpg", "jpeg", "png", "webp", "gif", "doc", "docx", "xls", "xlsx", "csv"],
  summary: "PDF, JPG, PNG, WebP, GIF, Word (.doc, .docx), Excel (.xls, .xlsx) and CSV files",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LABELS: Record<string, string> = { pdf: "PDF", jpg: "JPG", jpeg: "JPG", png: "PNG", webp: "WebP", gif: "GIF", doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel", csv: "CSV" };

export const extensionOf = (name: string): string => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? "").toLowerCase();
/** A short format label from a file name ("PDF", "Excel"…). */
export const fileLabel = (name: string): string => LABELS[extensionOf(name)] ?? (extensionOf(name).toUpperCase() || "File");

/** A reason this file can't be attached, or null if it looks fine. */
export function problemWith(file: File, limits: AttachmentLimits): string | null {
  if (file.size === 0) return "That file is empty.";
  if (!limits.extensions.includes(extensionOf(file.name))) return `That file type isn't supported. You can attach ${limits.summary}.`;
  if (file.size > limits.maxBytes) return `That file is too large (${formatBytes(file.size)}). The limit is ${formatBytes(limits.maxBytes)} per file.`;
  return null;
}

export type StagedStatus = "ready" | "uploading" | "done" | "failed";
export interface StagedFile {
  key: string;
  file: File;
  status: StagedStatus;
  error?: string;
}

let counter = 0;
/** Turn chosen files into a list to show, skipping ones already chosen and flagging ones that can't be attached. */
export function stageFiles(chosen: File[], existing: StagedFile[], limits: AttachmentLimits, alreadyAttached: number): { staged: StagedFile[]; notes: string[] } {
  const staged = [...existing];
  const notes: string[] = [];
  for (const file of chosen) {
    if (staged.some((s) => s.file.name === file.name && s.file.size === file.size && s.file.lastModified === file.lastModified)) continue;
    const problem = problemWith(file, limits);
    if (problem) {
      notes.push(`“${file.name}”: ${problem}`);
      continue;
    }
    if (alreadyAttached + staged.filter((s) => s.status !== "done").length >= limits.maxFiles) {
      notes.push(`“${file.name}”: an expense can have up to ${limits.maxFiles} files.`);
      continue;
    }
    staged.push({ key: `f${++counter}`, file, status: "ready" });
  }
  return { staged, notes };
}

export async function loadLimits(): Promise<AttachmentLimits> {
  try {
    return await api.get<AttachmentLimits>("/business/attachment-limits");
  } catch {
    return FALLBACK_LIMITS;
  }
}

/**
 * Upload files one after another (the server takes one per request), reporting each file's state as it changes.
 * Files that fail stay in the list so they can be retried. Returns how many went up.
 */
export async function uploadStaged(entryId: string, files: StagedFile[], onChange: (key: string, patch: Partial<StagedFile>) => void): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;
  for (const s of files) {
    if (s.status === "done") continue;
    onChange(s.key, { status: "uploading", error: undefined });
    try {
      const form = new FormData();
      form.append("file", s.file);
      await api.upload(`/business/entries/${entryId}/attachments`, form);
      onChange(s.key, { status: "done" });
      uploaded++;
    } catch (err) {
      failed++;
      // A request over the host's size limit is turned away before the app sees it, so there is no message to show.
      const message = err instanceof ApiError && err.status === 413 ? `That file is too large to upload.` : err instanceof ApiError ? err.message : "The upload didn't finish. Check your connection and try again.";
      onChange(s.key, { status: "failed", error: message });
    }
  }
  return { uploaded, failed };
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const attachmentPath = (a: Pick<ExpenseAttachment, "entryId" | "id">) => `/business/entries/${a.entryId}/attachments/${a.id}/download`;

export async function downloadAttachment(a: ExpenseAttachment) {
  const { blob } = await api.download(attachmentPath(a));
  saveBlob(blob, a.fileName);
}

/**
 * Show a PDF or picture in a new tab. The tab is opened straight away (browsers block pop-ups opened after a wait),
 * then pointed at the file once it has been fetched with the person's sign-in.
 */
export async function openAttachment(a: ExpenseAttachment) {
  const win = window.open("", "_blank");
  try {
    const { blob } = await api.download(`${attachmentPath(a)}?inline=1`);
    const url = URL.createObjectURL(blob);
    if (win) {
      win.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } else {
      saveBlob(blob, a.fileName); // pop-ups blocked: fall back to a download
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    win?.close();
    throw err;
  }
}
