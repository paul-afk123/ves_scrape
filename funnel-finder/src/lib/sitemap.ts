import { XMLParser } from "fast-xml-parser";

type Parsed = { urls: string[]; childSitemaps: string[] };

async function fetchText(url: string, headers: HeadersInit): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow", headers });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseSitemapXml(xml: string): Parsed {
  const parser = new XMLParser({ ignoreAttributes: true });
  let obj: { urlset?: { url?: unknown }; sitemapindex?: { sitemap?: unknown } };
  try {
    obj = parser.parse(xml) as typeof obj;
  } catch {
    return { urls: [], childSitemaps: [] };
  }

  const urls: string[] = [];
  const childSitemaps: string[] = [];

  if (obj?.urlset?.url) {
    const items = Array.isArray(obj.urlset.url) ? obj.urlset.url : [obj.urlset.url];
    for (const it of items) {
      const item = it as { loc?: string };
      if (typeof item?.loc === "string") urls.push(item.loc.trim());
    }
  }

  if (obj?.sitemapindex?.sitemap) {
    const items = Array.isArray(obj.sitemapindex.sitemap) ? obj.sitemapindex.sitemap : [obj.sitemapindex.sitemap];
    for (const it of items) {
      const item = it as { loc?: string };
      if (typeof item?.loc === "string") childSitemaps.push(item.loc.trim());
    }
  }

  return { urls, childSitemaps };
}

export async function discoverSitemapUrls(baseUrl: string, extraSitemaps: string[], headers: HeadersInit) {
  const base = new URL(baseUrl);
  const defaults = [`${base.protocol}//${base.host}/sitemap.xml`];

  const queue = Array.from(new Set([...defaults, ...extraSitemaps]));
  const foundSitemaps: string[] = [];
  const urls: string[] = [];

  const seenSm = new Set<string>();
  const maxSitemapsToFetch = 20; // safety

  while (queue.length && foundSitemaps.length < maxSitemapsToFetch) {
    const sm = queue.shift()!;
    if (seenSm.has(sm)) continue;
    seenSm.add(sm);

    const text = await fetchText(sm, headers);
    if (!text) continue;

    foundSitemaps.push(sm);

    const parsed = parseSitemapXml(text);
    urls.push(...parsed.urls);

    // enqueue child sitemaps
    for (const child of parsed.childSitemaps) {
      if (!seenSm.has(child)) queue.push(child);
    }
  }

  return {
    urls: Array.from(new Set(urls)),
    foundSitemaps: Array.from(new Set(foundSitemaps)),
  };
}
