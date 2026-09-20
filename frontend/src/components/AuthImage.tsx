import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";

// Pictures are only ever served through the signed-in API (never a public link), so they can't be used
// directly in an <img src>. They're fetched with the person's token and shown from a temporary local URL.
const cache = new Map<string, Promise<string>>();

function loadImage(path: string): Promise<string> {
  let pending = cache.get(path);
  if (!pending) {
    pending = api.get<Blob>(path).then((blob) => URL.createObjectURL(blob));
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
  }
  return pending;
}

/** Forget every loaded picture (used when signing out). */
export function clearImageCache() {
  for (const pending of cache.values()) pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  cache.clear();
}

/** Forget one picture, e.g. after it has been deleted. */
export function forgetImage(path: string) {
  const pending = cache.get(path);
  cache.delete(path);
  pending?.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
}

export function AuthImage({ path, alt, className = "", fallback }: { path: string | null; alt: string; className?: string; fallback?: ReactNode }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    if (!path) return;
    loadImage(path)
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path || failed) return <>{fallback ?? null}</>;
  if (!src) return <div className={`${className} animate-pulse bg-[var(--color-paper-dim)]`} aria-hidden />;
  return <img src={src} alt={alt} className={className} />;
}
