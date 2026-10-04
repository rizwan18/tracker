import type { SourcingProductRef } from "../../api/businessTypes";
import { AuthImage } from "../AuthImage";
import { productImagePath } from "../../lib/sourcing";

/**
 * The product's picture — a small square thumbnail in lists, or a larger framed image on the product page.
 * Without a picture (or if it can't be loaded) it shows a tidy "No image" placeholder, never a broken image.
 * The picture is fetched through the signed-in API, never from a public link.
 */
export function ProductImage({ product, size = 48, large = false }: { product: Pick<SourcingProductRef, "id" | "name" | "hasImage" | "imageVersion">; size?: number; large?: boolean }) {
  const box = { width: size, height: size };
  const placeholder = (
    <div className="rounded-xl flex flex-col items-center justify-center shrink-0 bg-[var(--color-paper-dim)] text-[var(--color-ink-soft)] border border-dashed border-[var(--color-line)]" style={box} role="img" aria-label={`No image for ${product.name}`}>
      <span aria-hidden style={{ fontSize: Math.max(16, size * (large ? 0.3 : 0.45)) }}>📦</span>
      {large && <span className="text-xs mt-1">No image</span>}
    </div>
  );
  if (!product.hasImage) return placeholder;
  return (
    <div className="rounded-xl overflow-hidden shrink-0 bg-[var(--color-paper-dim)] border border-[var(--color-line)]" style={box}>
      <AuthImage
        path={productImagePath(product, large ? "full" : "thumb")}
        alt={`Picture of ${product.name}`}
        className={large ? "w-full h-full object-contain" : "w-full h-full object-cover"}
        fallback={placeholder}
      />
    </div>
  );
}
