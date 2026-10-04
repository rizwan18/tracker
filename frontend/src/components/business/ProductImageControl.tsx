import { useRef, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { ProductDetail } from "../../api/businessTypes";
import { Button } from "../ui";
import { forgetImage } from "../AuthImage";
import { ImageError, prepareImage } from "../../lib/imageResize";
import { productImagePath } from "../../lib/sourcing";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Upload / change / remove the product's picture. The picture is shrunk in the browser first (a full-size copy and a
 * thumbnail), checked on the server, and belongs to the product — not to any one sourcing order.
 */
export function ProductImageControl({ product, onChanged }: { product: ProductDetail; onChanged: (next: ProductDetail) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const forgetCurrent = () => (["thumb", "full"] as const).forEach((s) => forgetImage(productImagePath(product, s)));

  async function choose(file: File | undefined) {
    if (input.current) input.current.value = "";
    if (!file) return;
    setError(null);
    if (!ALLOWED.includes(file.type)) return setError("Please choose a JPG, PNG or WebP picture.");
    setBusy("Uploading…");
    try {
      const prepared = await prepareImage(file);
      const body = new FormData();
      body.append("file", prepared.full, prepared.name);
      if (prepared.thumb) body.append("thumb", prepared.thumb, `thumb-${prepared.name}`);
      const next = await api.upload<ProductDetail>(`/business/products/${product.id}/image`, body);
      forgetCurrent();
      onChanged(next);
    } catch (err) {
      setError(err instanceof ImageError || err instanceof ApiError ? err.message : "We couldn't upload that picture. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Remove this product's picture? The product and its orders are not affected.")) return;
    setError(null);
    setBusy("Removing…");
    try {
      const next = await api.delete<ProductDetail>(`/business/products/${product.id}/image`);
      forgetCurrent();
      onChanged(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't remove that picture. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept={ALLOWED.join(",")} className="sr-only" aria-label="Product image file" onChange={(e) => void choose(e.target.files?.[0])} />
      <div className="flex flex-wrap gap-2">
        {product.hasImage ? (
          <>
            <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => input.current?.click()}>Change Image</Button>
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void remove()}>Remove Image</Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => input.current?.click()}>Upload Product Image</Button>
        )}
      </div>
      {busy && <p className="text-xs text-[var(--color-ink-soft)]" role="status">{busy}</p>}
      {error && <p role="alert" className="text-xs text-[var(--color-brick)]">{error}</p>}
      {!product.hasImage && !busy && <p className="text-xs text-[var(--color-ink-soft)]">JPG, PNG or WebP. Helps you spot this product at a glance.</p>}
    </div>
  );
}
