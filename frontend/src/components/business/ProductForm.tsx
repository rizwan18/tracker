import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { ProductDetail } from "../../api/businessTypes";
import { Button, Field, inputClass } from "../ui";

/** Create or edit a product/SKU. The picture and the sourcing orders are added from the product's own page. */
export function ProductForm({ initial, onSaved, onCancel }: { initial?: ProductDetail; onSaved: (product: ProductDetail) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return setError("Please enter the product name.");
    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), sku: sku.trim() || null, description: description.trim() || null };
      const saved = initial ? await api.put<ProductDetail>(`/business/products/${initial.id}`, body) : await api.post<ProductDetail>("/business/products", body);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save that product. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Product name" htmlFor="pr-name">
        <input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required maxLength={150} placeholder="e.g. VELTI Shower Filter" autoFocus />
      </Field>
      <Field label="SKU (optional)" htmlFor="pr-sku" hint="Your own code for this product. Each SKU can be used by one product only.">
        <input id="pr-sku" value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} maxLength={60} placeholder="e.g. VELTI-SF-001" />
      </Field>
      <Field label="Description (optional)" htmlFor="pr-desc">
        <textarea id="pr-desc" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} rows={3} maxLength={2000} />
      </Field>
      {error && <p role="alert" className="text-sm text-[var(--color-brick)]">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : initial ? "Save changes" : "Add product"}</Button>
      </div>
    </form>
  );
}
