import type { ReactNode } from "react";

export interface DonutSegment {
  key: string;
  value: number;
  colour: string;
}

/** A ring split into coloured parts, with room in the middle for a number or a picture. */
export function Donut({ segments, size = 168, thickness = 22, label, children }: { segments: DonutSegment[]; size?: number; thickness?: number; label: string; children?: ReactNode }) {
  const parts = segments.filter((s) => s.value > 0);
  const total = parts.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let used = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-paper-dim)" strokeWidth={thickness} />
        {parts.map((s) => {
          const length = (s.value / total) * circumference;
          const circle = <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.colour} strokeWidth={thickness} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-used} />;
          used += length;
          return circle;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">{children}</div>
    </div>
  );
}
