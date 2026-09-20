/** Longest side of the stored picture and of its small version, in pixels. */
const FULL_SIDE = 1600;
const THUMB_SIDE = 360;
/** Requests are limited to about 4.5 MB, so a picture we can't shrink must fit under this. */
export const MAX_UNRESIZED_BYTES = 3_500_000;
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export interface PreparedImage {
  full: Blob;
  thumb: Blob | null;
  name: string;
}

export class ImageError extends Error {}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageError("We couldn't prepare that picture."))), "image/jpeg", quality));
}

async function scaled(bitmap: ImageBitmap, longestSide: number, quality: number): Promise<Blob> {
  const ratio = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("We couldn't prepare that picture.");
  ctx.fillStyle = "#fff"; // transparent PNGs become white rather than black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return toBlob(canvas, quality);
}

/**
 * Shrinks a photo in the browser before it's uploaded: a full-size copy (max 1600px) and a small
 * one (max 360px) for icons and thumbnails. Phone photos are often 5–10 MB, so this keeps uploads
 * fast and well inside the request size limit. If the browser can't resize, the original is sent
 * as long as it's small enough.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new ImageError(`“${file.name}” isn't a picture. Please choose a JPG, PNG or WebP image.`);
  if (file.size > MAX_SOURCE_BYTES) throw new ImageError(`“${file.name}” is too large (over 30 MB).`);
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const [full, thumb] = await Promise.all([scaled(bitmap, FULL_SIDE, 0.85), scaled(bitmap, THUMB_SIDE, 0.8)]);
      bitmap.close?.();
      return { full, thumb, name };
    } catch {
      // fall through to sending the original
    }
  }
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= MAX_UNRESIZED_BYTES) {
    return { full: file, thumb: null, name: file.name };
  }
  throw new ImageError(`We couldn't read “${file.name}”. Please try a JPG or PNG under 3.5 MB.`);
}
