export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** Largest single image accepted (the browser resizes photos well below this first). */
export const MAX_PHOTO_BYTES = 3_500_000;
export const MAX_THUMB_BYTES = 600_000;
export const MAX_PHOTOS_PER_PROPERTY = 12;

/**
 * Works out what an uploaded image really is from its first bytes, ignoring the name
 * and the type the browser claimed — so something that isn't a picture (a web page,
 * a script) can never be stored and served back as one.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 //   "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export const EXTENSION_FOR: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A safe, short file name for storage and download (no path pieces or odd characters). */
export function safeFileName(original: string, type: ImageType): string {
  const base = original.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._ -]+/g, "").replace(/\.{2,}/g, ".").replace(/^\.+/, "").trim().slice(0, 60) || "photo";
  return `${base}.${EXTENSION_FOR[type]}`;
}
