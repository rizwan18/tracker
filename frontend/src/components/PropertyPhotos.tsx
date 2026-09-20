import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { api, ApiError } from "../api/client";
import type { PropertyPhoto } from "../api/types";
import { Button, Card, SectionHeading } from "./ui";
import { Modal } from "./Modal";
import { AuthImage, forgetImage } from "./AuthImage";
import { ImageError, prepareImage } from "../lib/imageResize";

const imagePath = (propertyId: string, photoId: string, size: "thumb" | "full") => `/properties/${propertyId}/photos/${photoId}/image?size=${size}`;

/**
 * Pictures of the property. The first one added becomes its icon (shown beside the name and on the
 * properties list); any picture can be made the main one. Pictures are shrunk in the browser first.
 */
export function PropertyPhotos({ propertyId, propertyName, onChanged }: { propertyId: string; propertyName: string; onChanged: () => void }) {
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);
  const [max, setMax] = useState(12);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [viewing, setViewing] = useState<PropertyPhoto | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ photos: PropertyPhoto[]; max: number }>(`/properties/${propertyId}/photos`);
      setPhotos(res.photos ?? []);
      setMax(res.max ?? 12);
    } catch {
      setErrors(["We couldn't load the pictures."]);
    }
  }, [propertyId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function addFiles(fileList: FileList | File[] | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setErrors([]);
    const room = max - photos.length;
    const problems: string[] = [];
    const chosen = files.slice(0, Math.max(0, room));
    if (files.length > chosen.length) problems.push(`Only ${room > 0 ? room : "no"} more ${room === 1 ? "picture" : "pictures"} fit — a property can have up to ${max}.`);

    for (const [i, file] of chosen.entries()) {
      setBusy(`Adding picture ${i + 1} of ${chosen.length}…`);
      try {
        const prepared = await prepareImage(file);
        const body = new FormData();
        body.append("file", prepared.full, prepared.name);
        if (prepared.thumb) body.append("thumb", prepared.thumb, `thumb-${prepared.name}`);
        await api.upload(`/properties/${propertyId}/photos`, body);
      } catch (err) {
        problems.push(err instanceof ImageError || err instanceof ApiError ? err.message : `We couldn't add “${file.name}”. Please try again.`);
      }
    }
    setBusy(null);
    setErrors(problems);
    if (input.current) input.current.value = "";
    await load();
    onChanged();
  }

  async function makeMain(photo: PropertyPhoto) {
    try {
      await api.post(`/properties/${propertyId}/photos/${photo.id}/primary`);
      setViewing(null);
      await load();
      onChanged();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "We couldn't change the main picture."]);
    }
  }

  async function remove(photo: PropertyPhoto) {
    if (!confirm("Remove this picture? This can't be undone.")) return;
    try {
      await api.delete(`/properties/${propertyId}/photos/${photo.id}`);
      forgetImage(imagePath(propertyId, photo.id, "thumb"));
      forgetImage(imagePath(propertyId, photo.id, "full"));
      setViewing(null);
      await load();
      onChanged();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "We couldn't remove that picture."]);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  const full = photos.length >= max;

  return (
    <section>
      <SectionHeading
        title="Pictures"
        subtitle={photos.length === 0 ? "The first picture you add becomes this property's icon." : `${photos.length} of ${max} · the one marked “Main” is the property's icon.`}
        action={
          <>
            <input ref={input} type="file" accept="image/*" multiple className="sr-only" aria-label="Choose pictures to add" onChange={(e) => addFiles(e.target.files)} />
            <Button size="sm" variant="secondary" disabled={!!busy || full} onClick={() => input.current?.click()}>
              + Add pictures
            </Button>
          </>
        }
      />
      {/* Dropping files anywhere on the card adds them. */}
      <div
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="photo-dropzone"
        className={`rounded-2xl ${dragging ? "ring-2 ring-[var(--color-eucalyptus)]" : ""}`}
      >
      <Card>
        {busy && (
          <p role="status" className="text-sm text-[var(--color-ink-soft)] mb-3">
            {busy}
          </p>
        )}
        {errors.length > 0 && (
          <ul role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2 mb-3 space-y-1">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        {loading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">Loading…</p>
        ) : photos.length === 0 ? (
          <button onClick={() => input.current?.click()} className="w-full rounded-xl border-2 border-dashed border-[var(--color-line)] py-10 text-center hover:border-[var(--color-eucalyptus)]">
            <span className="block text-3xl" aria-hidden>
              📷
            </span>
            <span className="block font-medium mt-2">Add pictures of {propertyName}</span>
            <span className="block text-sm text-[var(--color-ink-soft)]">Choose files or drop them here. JPG, PNG or WebP.</span>
          </button>
        ) : (
          <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {photos.map((p) => (
              <li key={p.id}>
                <button onClick={() => setViewing(p)} className="relative block w-full aspect-square rounded-xl overflow-hidden bg-[var(--color-paper-dim)] focus-visible:outline-2 focus-visible:outline-[var(--color-sky)]" aria-label={`Open picture ${p.fileName}${p.isPrimary ? " (main picture)" : ""}`}>
                  <AuthImage path={imagePath(propertyId, p.id, "thumb")} alt={p.fileName} className="w-full h-full object-cover" />
                  {p.isPrimary && <span className="absolute left-1 top-1 rounded-full bg-[var(--color-eucalyptus)] text-white text-[10px] font-medium px-2 py-0.5">Main</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </div>

      {viewing && (
        <Modal title={viewing.fileName} onClose={() => setViewing(null)}>
          <div className="space-y-4">
            <AuthImage path={imagePath(propertyId, viewing.id, "full")} alt={`${propertyName}: ${viewing.fileName}`} className="w-full max-h-[60vh] object-contain rounded-xl bg-[var(--color-paper-dim)]" />
            <div className="flex flex-wrap justify-between gap-2">
              {viewing.isPrimary ? (
                <span className="text-sm text-[var(--color-eucalyptus-dark)] self-center">This is the property's main picture (its icon).</span>
              ) : (
                <Button variant="secondary" onClick={() => makeMain(viewing)}>
                  Use as main picture
                </Button>
              )}
              <Button variant="danger" onClick={() => remove(viewing)}>
                Remove
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
