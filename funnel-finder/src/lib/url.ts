export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty URL");

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const u = new URL(withProto);
  u.hash = "";
  return u.toString();
}

export function sameOrigin(a: string, b: string): boolean {
  const ua = new URL(a);
  const ub = new URL(b);
  return ua.protocol === ub.protocol && ua.host === ub.host;
}

export function toAbsoluteUrl(base: string, href: string): string | null {
  const h = (href || "").trim();
  if (!h) return null;
  if (h.startsWith("#")) return null; // "page section" links are not real pages
  if (h.startsWith("mailto:") || h.startsWith("tel:") || h.startsWith("javascript:")) return null;

  try {
    const abs = new URL(h, base);
    abs.hash = "";
    return abs.toString();
  } catch {
    return null;
  }
}

export function stripUtm(url: string): string {
  const u = new URL(url);
  const utmKeys = [
    "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
    "gclid","fbclid","msclkid","ttclid","twclid","li_fat_id","wbraid","gbraid"
  ];
  utmKeys.forEach(k => u.searchParams.delete(k));
  return u.toString();
}
