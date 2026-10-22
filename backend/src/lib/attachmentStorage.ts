import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { del, get, put } from "@vercel/blob";

/**
 * Where expense attachments are kept: Vercel Blob (the app's existing file storage).
 *
 * Two modes, chosen by configuration:
 *  - PRIVATE (recommended): set ATTACHMENTS_READ_WRITE_TOKEN to the token of a *private* Blob store. Files then have no
 *    public address at all and can only be read with that server-side token.
 *  - PUBLIC (default, no extra setup): files go in the app's existing Blob store (BLOB_READ_WRITE_TOKEN) under an
 *    unguessable path (random UUID + Vercel's random suffix). Like every other file in this app, the address is never
 *    sent to the browser; files are only served by the authenticated route in routes/businessAttachments.ts.
 *
 * What is saved in the database (`storageKey`) says which mode a file is in — a blob URL (public) or a pathname
 * (private) — so switching mode later never strands files that were saved earlier.
 */

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PUBLIC_BLOB_HOST = /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i;

const privateToken = (): string | undefined => process.env.ATTACHMENTS_READ_WRITE_TOKEN?.trim() || undefined;

export const storageMode = (): "private" | "public" => (privateToken() ? "private" : "public");

const isPublicKey = (key: string) => /^https:\/\//i.test(key);

/**
 * A new, unguessable storage path. Built only from ids and a random UUID — never from the uploaded file's name — so
 * a hostile name can't traverse folders or collide with another file.
 */
export function newStoragePath(householdId: string, entryId: string, extension: string): string {
  if (!SAFE_ID.test(householdId) || !SAFE_ID.test(entryId) || !/^[a-z0-9]{1,8}$/.test(extension)) {
    throw new Error("Refusing to build a storage path from unexpected values.");
  }
  return `business-attachments/${householdId}/${entryId}/${randomUUID()}.${extension}`;
}

/** Store the file and return the key to remember it by. Throws if storage rejects it. */
export async function saveFile(pathname: string, bytes: Buffer, contentType: string): Promise<string> {
  const token = privateToken();
  if (token) {
    const blob = await put(pathname, bytes, { access: "private", token, contentType, addRandomSuffix: true });
    return blob.pathname;
  }
  const blob = await put(pathname, bytes, { access: "public", contentType, addRandomSuffix: true });
  return blob.url;
}

/** The stored file as a stream, or null when it can't be found (removed, or storage unavailable for it). */
export async function openFile(key: string): Promise<Readable | null> {
  if (isPublicKey(key)) {
    // The key comes from our own database, but never fetch anything that isn't a Vercel Blob address.
    let host: string;
    try {
      host = new URL(key).hostname;
    } catch {
      return null;
    }
    if (!PUBLIC_BLOB_HOST.test(host)) return null;
    const res = await fetch(key);
    if (!res.ok || !res.body) return null;
    return Readable.fromWeb(res.body as never);
  }
  const token = privateToken();
  if (!token) return null; // saved in a private store that is no longer configured
  const result = await get(key, { access: "private", token });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Readable.fromWeb(result.stream as never);
}

/** Delete one stored file. Throws if storage could not be reached, so the caller can decide what that means. */
export async function removeFile(key: string): Promise<void> {
  if (isPublicKey(key)) return del(key);
  const token = privateToken();
  if (!token) throw new Error("The private attachments store is not configured, so this file can't be removed.");
  return del(key, { token });
}

/**
 * Delete many files without ever throwing (used after the database record is already gone). A failure is logged with
 * the storage key — never the file's contents or any token — so a stray file can be cleaned up by hand.
 */
export async function removeFilesQuietly(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      removeFile(key).catch((err) => {
        console.error(`Could not remove stored attachment ${key}:`, err instanceof Error ? err.message : err);
      })
    )
  );
}
