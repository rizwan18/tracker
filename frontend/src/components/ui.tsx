import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[var(--color-line)] bg-white p-5 ${className}`}>{children}</div>;
}

export function SectionHeading({ title, subtitle, action }: { title: ReactNode; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">{title}</h2>
        {subtitle && <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
  size = "md",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sizeCls = size === "sm" ? "px-3 py-2 text-sm" : "px-4 py-3 text-[15px]";
  const variantCls: Record<ButtonVariant, string> = {
    primary: "bg-[var(--color-eucalyptus)] text-white hover:bg-[var(--color-eucalyptus-dark)]",
    secondary: "bg-[var(--color-paper-dim)] text-[var(--color-ink)] border border-[var(--color-line)] hover:bg-[var(--color-line)]",
    ghost: "text-[var(--color-eucalyptus)] hover:bg-[var(--color-eucalyptus-tint)]",
    danger: "bg-[var(--color-brick-tint)] text-[var(--color-brick)] hover:bg-[#efd0c6]",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizeCls} ${variantCls[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="text-center py-14 px-6 rounded-2xl border-2 border-dashed border-[var(--color-line)]">
      <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">{title}</h3>
      <p className="text-[var(--color-ink-soft)] mt-2 max-w-md mx-auto">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Plain-English tooltip for unavoidable financial jargon (section 2 of the brief). */
export function HelpText({ term, children }: { term: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center gap-1">
      {children}
      <span
        tabIndex={0}
        aria-label={`What does "${term}" mean?`}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--color-sky-tint)] text-[var(--color-sky)] text-xs cursor-help focus:outline-none"
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-0 top-full z-10 mt-1 w-64 rounded-lg border border-[var(--color-line)] bg-white p-3 text-xs text-[var(--color-ink-soft)] shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        {GLOSSARY[term] ?? term}
      </span>
    </span>
  );
}

const GLOSSARY: Record<string, string> = {
  "Capital Gains": "Profit or loss when you sell an investment for more or less than you paid.",
  "Franking Credit": "Tax already paid by an Australian company on your behalf, credited back to you.",
  "Unrealised Gain/Loss": "The change in value of something you still own — not a real profit or loss until you sell.",
  "Realised Gain/Loss": "The profit or loss locked in by shares you have already sold: sale proceeds (after selling fees) minus the cost base of the shares sold.",
  "Cost Base": "What an investment cost you in total, including brokerage.",
  "Net Rental Income": "Rent received minus property expenses.",
  "Rental Yield": "Annual rent as a percentage of the property's value — a quick way to compare properties.",
  "Estimated Equity": "What the property is worth minus what's still owed on the loan.",
};

export function StatTile({
  label,
  value,
  tone = "neutral",
  help,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral" | "accent";
  help?: string;
}) {
  const toneCls: Record<string, string> = {
    positive: "bg-[var(--color-eucalyptus-tint)]",
    negative: "bg-[var(--color-brick-tint)]",
    accent: "bg-[var(--color-ochre-tint)]",
    neutral: "bg-[var(--color-paper-dim)]",
  };
  return (
    <div className={`rounded-2xl p-4 ${toneCls[tone]}`}>
      <p className="text-sm text-[var(--color-ink-soft)]">{label}</p>
      <p className="font-display text-2xl font-semibold text-[var(--color-ink)] mt-1">{value}</p>
      {help && <p className="text-xs text-[var(--color-ink-soft)] mt-1">{help}</p>}
    </div>
  );
}

export function Alert({ message, severity }: { message: string; severity: "info" | "warning" }) {
  return (
    <div
      className={`rounded-xl px-4 py-3 text-sm flex items-start gap-2 ${
        severity === "warning" ? "bg-[var(--color-ochre-tint)] text-[#7a4d1a]" : "bg-[var(--color-sky-tint)] text-[#264a5c]"
      }`}
    >
      <span aria-hidden>{severity === "warning" ? "⚠" : "ℹ"}</span>
      <span>{message}</span>
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--color-ink)] mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--color-ink-soft)] mt-1">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2.5 text-[15px] text-[var(--color-ink)] focus:border-[var(--color-eucalyptus)] focus:ring-1 focus:ring-[var(--color-eucalyptus)]";

/** Accessible tab strip. Pair each tab with a <TabPanel> that has the same id. */
export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: Array<{ id: T; label: string }>; active: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-[var(--color-line)] overflow-x-auto">
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`px-4 py-3 text-[15px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              selected ? "border-[var(--color-eucalyptus)] text-[var(--color-eucalyptus-dark)]" : "border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="space-y-6 pt-6">
      {children}
    </div>
  );
}
