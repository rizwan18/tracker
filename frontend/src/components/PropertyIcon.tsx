import type { Property } from "../api/types";
import { propertyTypeOf } from "../lib/propertyType";
import { AuthImage } from "./AuthImage";

/**
 * The property's icon: its main picture when it has one, otherwise a house symbol
 * in the property type's colour (green = investment, blue = PPR).
 */
export function PropertyIcon({ property, size = 48 }: { property: Pick<Property, "id" | "name" | "propertyType" | "primaryPhotoId">; size?: number }) {
  const type = propertyTypeOf(property);
  const box = { width: size, height: size };
  const placeholder = (
    <div
      className={`rounded-xl flex items-center justify-center shrink-0 ${type === "PPR" ? "bg-[var(--color-sky-tint)]" : "bg-[var(--color-eucalyptus-tint)]"}`}
      style={{ ...box, fontSize: size * 0.5 }}
      role="img"
      aria-label={`${property.name} icon`}
    >
      <span aria-hidden>{type === "PPR" ? "🏠" : "🏘️"}</span>
    </div>
  );
  if (!property.primaryPhotoId) return placeholder;
  return (
    <div className="rounded-xl overflow-hidden shrink-0 bg-[var(--color-paper-dim)]" style={box}>
      <AuthImage path={`/properties/${property.id}/photos/${property.primaryPhotoId}/image?size=thumb`} alt={`Main picture of ${property.name}`} className="w-full h-full object-cover" fallback={placeholder} />
    </div>
  );
}
