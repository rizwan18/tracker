import { useState } from "react";
import type { ContactType } from "../../api/businessTypes";
import { CONTACT_TYPE_LABELS, mailtoHref, telHref, whatsappHref } from "../../lib/contacts";

export function TypeBadges({ types }: { types: ContactType[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {types.map((t) => (
        <span key={t} className="rounded-full bg-[var(--color-eucalyptus-tint)] px-2 py-0.5 text-xs font-medium text-[var(--color-eucalyptus-dark)]">{CONTACT_TYPE_LABELS[t]}</span>
      ))}
    </span>
  );
}

const chip = "inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-paper-dim)]";

/**
 * Email / Call / WhatsApp / WeChat shortcuts. Each only appears when there is something to use. Email opens the person's
 * mail app and Call their phone app (on devices that have one); WhatsApp opens WhatsApp; WeChat has no web link, so its ID is copied.
 */
export function QuickActions({ email, phone, mobile, whatsapp, wechat }: { email?: string | null; phone?: string | null; mobile?: string | null; whatsapp?: string | null; wechat?: string | null }) {
  const [copied, setCopied] = useState(false);
  const call = mobile || phone;
  const wa = whatsapp ? whatsappHref(whatsapp) : null;
  async function copyWeChat() {
    try {
      await navigator.clipboard.writeText(wechat ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("WeChat ID", wechat ?? "");
    }
  }
  if (!email && !call && !wa && !wechat) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {email && <a className={chip} href={mailtoHref(email)}>✉️ Email</a>}
      {call && <a className={chip} href={telHref(call)}>📞 Call</a>}
      {wa && <a className={chip} href={wa} target="_blank" rel="noreferrer noopener">💬 WhatsApp</a>}
      {wechat && <button type="button" className={chip} onClick={() => void copyWeChat()}>{copied ? "✓ WeChat ID copied" : "🟢 Copy WeChat"}</button>}
    </div>
  );
}
