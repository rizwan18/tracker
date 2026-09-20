/**
 * Turns what someone typed for a website ("raywhite.com", "www.raywhite.com/hawthorn",
 * "https://…") into a safe https/http link, or null if it isn't a usable web address.
 * Only http and https are allowed, so a link can never run a script or open a local file.
 */
export function normaliseWebsite(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 200 || /\s/.test(raw) || /^[/\\]/.test(raw)) return null; // no protocol-relative "//host" or slashes up front
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : /^[a-z][a-z0-9+.-]*:/i.test(raw) ? "" : `https://${raw}`;
  if (!withScheme) return null; // e.g. "javascript:alert(1)" or "mailto:x"
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null; // needs a dotted name, e.g. example.com.au
  const href = url.href;
  return url.pathname === "/" && !url.search && !url.hash ? href.replace(/\/$/, "") : href;
}
