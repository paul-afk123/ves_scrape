import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { chromium, Browser } from "playwright";
import { fetchRobots, isAllowedByRobots, RobotsRules } from "./robots";
import { discoverSitemapUrls } from "./sitemap";
import { normalizeUrl, sameOrigin, stripUtm, toAbsoluteUrl } from "./url";

export type PageFinding = {
  url: string;
  finalUrl: string;
  status: number;
  score: number;
  reasons: string[];
  title?: string;
  ctaLinks: string[];    // strongest "next step" edges
  allOutLinks: string[]; // internal links
};

export type FunnelPath = {
  landing: string;
  steps: string[];
  conversion: string;
  confidence: number; // derived from scores + conversion-ness
};

export type ScrapeResult = {
  inputUrl: string;
  baseUrl: string;
  robots: { disallowCount: number; sitemapCount: number };
  discovered: { fromSitemaps: number; fromCrawl: number; totalUnique: number };
  kept: { checked: number; valid: number; adLike: number; funnels: number };
  outputText: string; // <-- the ONE copy/paste container content
  adLikePages: PageFinding[];
  funnels: FunnelPath[];
  excludedSamples: string[];
};

const EXCLUDE_KEYWORDS = [
  "faq","faqs","blog","posts","article","news",
  "privacy","terms","legal","policy","cookies",
  "contact","about","team","careers","jobs","support","help",
  "refund","returns","shipping","track-order",
  "documentation","docs","knowledge-base"
];

const FUNNEL_URL_HINTS = [
  "lp","landing","offer","vsl","webinar","quiz",
  "apply","book","call","schedule",
  "pricing","checkout","order","pay","cart",
  "thank","success","confirm","complete"
];

const CTA_TEXT_HINTS = [
  "book","apply","get started","start","sign up","join",
  "buy","purchase","continue","checkout","pay","claim","reserve","submit"
];

const CONVERSION_HINTS = [
  "checkout","order","pay","cart","thank","success","confirm","complete"
];

const TRACKING_HINTS = [
  "googletagmanager.com", "gtm-", "gtag(", "google-analytics.com",
  "fbq(", "connect.facebook.net", "pixel", "tiktok", "snaptr(", "linkedin", "bing"
];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function looksExcluded(url: string): boolean {
  const u = new URL(url);
  const path = (u.pathname || "/").toLowerCase();

  // ignore assets
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|map|pdf|zip|mp4|mov|webm)$/i.test(path)) return true;

  // keyword exclusions
  if (EXCLUDE_KEYWORDS.some(k => path.includes(`/${k}`) || path.includes(`-${k}`) || path.includes(`${k}-`))) return true;

  return false;
}

function isProbablyConversion(url: string): boolean {
  const p = new URL(url).pathname.toLowerCase();
  return CONVERSION_HINTS.some(h => p.includes(h));
}

function scorePage(url: string, html: string): { score: number; reasons: string[]; title?: string; ctaLinks: string[]; allOutLinks: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const u = new URL(url);
  const path = (u.pathname || "/").toLowerCase();

  // URL hints
  for (const hint of FUNNEL_URL_HINTS) {
    if (path.includes(hint)) {
      score += 8;
      reasons.push(`url:${hint}`);
    }
  }

  const $ = cheerio.load(html);
  const title = ($("title").first().text() || "").trim();

  // Tracking scripts typical for ad pages
  const htmlLower = html.toLowerCase();
  const trackingHits = TRACKING_HINTS.filter(h => htmlLower.includes(h)).length;
  if (trackingHits > 0) {
    score += Math.min(20, trackingHits * 6);
    reasons.push(`tracking:${trackingHits}`);
  }

  // Forms (lead-gen) often appear on landing pages
  const formCount = $("form").length;
  if (formCount > 0) {
    score += Math.min(24, 12 + formCount * 3);
    reasons.push(`forms:${formCount}`);
  }

  // "noindex" sometimes used for ad LPs
  const robotsMeta = ($("meta[name='robots']").attr("content") || "").toLowerCase();
  if (robotsMeta.includes("noindex")) {
    score += 6;
    reasons.push("meta:noindex");
  }

  // Strong CTA detection (button-like anchors + buttons)
  const buttonish = (el: cheerio.Element) => {
    const cls = ($(el).attr("class") || "").toLowerCase();
    const role = ($(el).attr("role") || "").toLowerCase();
    return role === "button" || cls.includes("btn") || cls.includes("button") || cls.includes("cta");
  };

  let ctaHits = 0;
  const ctaLinksSet = new Set<string>();

  $("a[href], button, input[type='submit']").each((_, el) => {
    const txt = $(el).text().trim().toLowerCase();
    const isCtaText = txt && CTA_TEXT_HINTS.some(h => txt.includes(h));
    const isButtonish = el.tagName === "a" ? buttonish(el) : true;

    if (el.tagName === "a") {
      const href = $(el).attr("href") || "";
      const abs = toAbsoluteUrl(url, href);
      if (abs && isButtonish && (isCtaText || isProbablyConversion(abs))) {
        ctaLinksSet.add(stripUtm(abs));
        ctaHits += 1;
      }
    } else {
      if (isCtaText) ctaHits += 1;
    }
  });

  if (ctaHits > 0) {
    score += Math.min(18, ctaHits * 6);
    reasons.push(`cta:${ctaHits}`);
  }

  // Link density heuristic: ad LPs often have fewer links
  const linkCount = $("a[href]").length;
  if (linkCount <= 35) {
    score += 6;
    reasons.push(`lowLinks:${linkCount}`);
  }

  // Extract all internal outlinks
  const allOutLinksSet = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const abs = toAbsoluteUrl(url, href);
    if (abs) allOutLinksSet.add(stripUtm(abs));
  });

  return {
    score,
    reasons,
    title,
    ctaLinks: Array.from(ctaLinksSet),
    allOutLinks: Array.from(allOutLinksSet),
  };
}

let _browser: Browser | null = null;
let _browserFailed = false;
async function getBrowser(): Promise<Browser | null> {
  if (_browser) return _browser;
  if (_browserFailed) return null;
  try {
    _browser = await chromium.launch({ headless: true });
    return _browser;
  } catch {
    _browserFailed = true;
    return null;
  }
}

const DEFAULT_HEADERS: HeadersInit = {
  // polite identification + transparency
  "User-Agent": "FunnelFinderLocal/1.0 (+local; contact: you)",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchStatus(url: string, headers: HeadersInit): Promise<{ status: number; finalUrl: string; contentType?: string }> {
  const timeoutMs = 15000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // HEAD first; fallback to GET if blocked by 405/501
    let res = await fetch(url, { method: "HEAD", redirect: "follow", headers, signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", redirect: "follow", headers, signal: controller.signal });
    }
    return { status: res.status, finalUrl: res.url || url, contentType: res.headers.get("content-type") || undefined };
  } catch {
    return { status: 0, finalUrl: url };
  } finally {
    clearTimeout(t);
  }
}

async function fetchHtmlWithFallback(url: string, headers: HeadersInit): Promise<{ html: string; used: "fetch" | "playwright" }> {
  // Try normal fetch first
  try {
    const res = await fetch(url, { redirect: "follow", headers });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && ct.includes("text/html")) {
      return { html: await res.text(), used: "fetch" };
    }
  } catch {}

  // Fallback to Playwright for JS-heavy pages (skipped on Vercel / when Chromium not installed)
  const browser = await getBrowser();
  if (!browser) return { html: "", used: "fetch" };
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders(headers as Record<string, string>);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const html = await page.content();
    return { html, used: "playwright" };
  } finally {
    await page.close();
  }
}

async function crawlInternalLinks(seedUrl: string, robots: RobotsRules, headers: HeadersInit, maxPages: number, maxDepth: number) {
  const base = normalizeUrl(seedUrl);
  const q: Array<{ url: string; depth: number }> = [{ url: base, depth: 0 }];
  const seen = new Set<string>([stripUtm(base)]);
  const found: string[] = [];

  // Politeness knobs
  const perRequestDelayMs = 150; // small delay
  const maxQueue = 5000;

  while (q.length && found.length < maxPages && q.length < maxQueue) {
    const { url, depth } = q.shift()!;
    if (!isAllowedByRobots(base, robots, url)) continue;

    found.push(url);

    if (depth >= maxDepth) continue;

    // polite spacing
    await sleep(perRequestDelayMs);

    let html = "";
    try {
      const out = await fetchHtmlWithFallback(url, headers);
      html = out.html;
    } catch {
      continue;
    }

    const $ = cheerio.load(html);

    $("a[href]").each((_, el) => {
      const abs = toAbsoluteUrl(url, $(el).attr("href") || "");
      if (!abs) return;
      if (!sameOrigin(base, abs)) return;

      const norm = stripUtm(abs);
      if (seen.has(norm)) return;
      seen.add(norm);

      if (!looksExcluded(norm)) {
        q.push({ url: norm, depth: depth + 1 });
      }
    });
  }

  return Array.from(new Set(found));
}

function buildFunnels(adPages: PageFinding[]): FunnelPath[] {
  const byUrl = new Map(adPages.map(p => [p.finalUrl, p]));

  // Build weighted adjacency using CTA links first, then all links
  const adj = new Map<string, string[]>();
  for (const p of adPages) {
    const ctas = (p.ctaLinks || []).filter(l => byUrl.has(l));
    const others = (p.allOutLinks || []).filter(l => byUrl.has(l) && !ctas.includes(l));
    // CTA links are prioritized
    adj.set(p.finalUrl, [...ctas, ...others]);
  }

  const funnels: FunnelPath[] = [];

  for (const start of adPages) {
    // treat as landing candidate
    if (start.score < 18) continue;
    if (isProbablyConversion(start.finalUrl)) continue; // don't start at conversion

    // BFS up to a reasonable depth to find conversion
    const maxSteps = 5;
    const visited = new Set<string>([start.finalUrl]);
    const parent = new Map<string, string | null>();
    parent.set(start.finalUrl, null);

    const depth = new Map<string, number>();
    depth.set(start.finalUrl, 0);

    const queue: string[] = [start.finalUrl];
    let foundConv: string | null = null;

    while (queue.length) {
      const cur = queue.shift()!;
      const d = depth.get(cur) || 0;
      if (d > maxSteps) continue;

      if (cur !== start.finalUrl && isProbablyConversion(cur)) {
        foundConv = cur;
        break;
      }

      for (const nxt of adj.get(cur) || []) {
        if (visited.has(nxt)) continue;
        visited.add(nxt);
        parent.set(nxt, cur);
        depth.set(nxt, d + 1);
        queue.push(nxt);
      }
    }

    if (!foundConv) continue;

    // Reconstruct path
    const steps: string[] = [];
    let cur: string | null = foundConv;
    while (cur && cur !== start.finalUrl) {
      steps.push(cur);
      cur = parent.get(cur) || null;
    }
    steps.reverse();

    const convPage = byUrl.get(foundConv);
    const confidence =
      Math.min(100,
        (start.score * 2) +
        (convPage ? convPage.score : 0) +
        (steps.length ? (10 / steps.length) : 0)
      );

    funnels.push({
      landing: start.finalUrl,
      steps,
      conversion: foundConv,
      confidence: Math.round(confidence),
    });
  }

  // Dedupe by landing+conversion
  const seen = new Set<string>();
  return funnels
    .sort((a, b) => b.confidence - a.confidence)
    .filter(f => {
      const key = `${f.landing}→${f.conversion}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatOutputText(baseUrl: string, adLikePages: PageFinding[], funnels: FunnelPath[]): string {
  const lines: string[] = [];
  lines.push(`# Funnel Finder Output`);
  lines.push(`Base: ${baseUrl}`);
  lines.push(``);

  lines.push(`## Funnels (landing -> ... -> conversion)`);
  if (!funnels.length) {
    lines.push(`(none found)`);
  } else {
    for (const f of funnels) {
      const chain = [f.landing, ...f.steps].join(" -> ");
      lines.push(`- [${f.confidence}] ${chain}`);
    }
  }

  lines.push(``);
  lines.push(`## Ad-like Pages (best candidates for ads)`);
  if (!adLikePages.length) {
    lines.push(`(none)`);
  } else {
    for (const p of adLikePages) {
      lines.push(`- (${p.score}) ${p.finalUrl}`);
    }
  }

  return lines.join("\n");
}

export async function runFunnelFinder(inputUrl: string): Promise<ScrapeResult> {
  const baseUrl = normalizeUrl(inputUrl);

  const headers = DEFAULT_HEADERS;

  // 1) robots + sitemaps
  const robots = await fetchRobots(baseUrl, headers);
  const sm = await discoverSitemapUrls(baseUrl, robots.sitemaps, headers);

  // 2) crawl fallback (bounded)
  const crawled = await crawlInternalLinks(baseUrl, robots, headers, 350, 4);

  // 3) candidate set (unique, internal)
  const candidatesRaw = Array.from(new Set([...sm.urls, ...crawled]))
    .map(stripUtm)
    .filter(u => sameOrigin(baseUrl, u));

  const excludedSamples: string[] = [];
  const candidates = candidatesRaw.filter(u => {
    if (looksExcluded(u)) {
      if (excludedSamples.length < 30) excludedSamples.push(u);
      return false;
    }
    return true;
  });

  // 4) check statuses + score pages (polite)
  const limit = pLimit(4);        // low concurrency
  const perRequestDelayMs = 120;  // spacing

  const checked: PageFinding[] = [];
  const htmlCache = new Map<string, string>();

  await Promise.all(
    candidates.map(url =>
      limit(async () => {
        if (!isAllowedByRobots(baseUrl, robots, url)) return;

        await sleep(perRequestDelayMs);

        const { status, finalUrl, contentType } = await fetchStatus(url, headers);

        // Exclude: 404, any 4xx, any 5xx (incl 505), network failures
        if (status === 0) return;
        if (status >= 400 && status < 600) return;

        // require HTML-ish content type if provided
        if (contentType && !contentType.toLowerCase().includes("text/html")) return;

        let html = htmlCache.get(finalUrl);
        if (!html) {
          const fetched = await fetchHtmlWithFallback(finalUrl, headers);
          html = fetched.html;
          htmlCache.set(finalUrl, html);
        }

        const scored = scorePage(finalUrl, html);

        const allInternalLinks = scored.allOutLinks
          .filter(l => sameOrigin(baseUrl, l))
          .filter(l => !looksExcluded(l));

        const ctaInternalLinks = scored.ctaLinks
          .filter(l => sameOrigin(baseUrl, l))
          .filter(l => !looksExcluded(l));

        checked.push({
          url,
          finalUrl,
          status,
          score: scored.score,
          reasons: scored.reasons,
          title: scored.title,
          ctaLinks: ctaInternalLinks,
          allOutLinks: allInternalLinks,
        });
      })
    )
  );

  const valid = checked.sort((a, b) => b.score - a.score);

  // 5) classify ad-like pages:
  // - threshold score
  // - AND must not be excluded
  // - keep top N
  const adLikePages = valid
    .filter(p => p.score >= 18)
    .slice(0, 250);

  // 6) funnels from the ad-like subset
  const funnels = buildFunnels(adLikePages);

  // 7) Output text for one copy/paste textarea
  const outputText = formatOutputText(baseUrl, adLikePages, funnels);

  return {
    inputUrl,
    baseUrl,
    robots: { disallowCount: robots.disallow.length, sitemapCount: robots.sitemaps.length },
    discovered: { fromSitemaps: sm.urls.length, fromCrawl: crawled.length, totalUnique: candidatesRaw.length },
    kept: { checked: candidates.length, valid: valid.length, adLike: adLikePages.length, funnels: funnels.length },
    outputText,
    adLikePages,
    funnels,
    excludedSamples,
  };
}

export async function previewSite(url: string) {
  const baseUrl = normalizeUrl(url);
  const headers = DEFAULT_HEADERS;

  const browser = await getBrowser();
  if (browser) {
    const page = await browser.newPage();
    try {
      await page.setExtraHTTPHeaders(headers as Record<string, string>);
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      const finalUrl = page.url();
      const title = await page.title();
      const buf = await page.screenshot({ fullPage: false });
      return { finalUrl, title, screenshotBase64: buf.toString("base64") };
    } finally {
      await page.close();
    }
  }

  // No browser (e.g. Vercel): use fetch for finalUrl + title only, no screenshot
  try {
    const res = await fetch(baseUrl, { redirect: "follow", headers });
    const finalUrl = res.url || baseUrl;
    const html = res.ok ? await res.text() : "";
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    return { finalUrl, title, screenshotBase64: undefined };
  } catch {
    return { finalUrl: baseUrl, title: "", screenshotBase64: undefined };
  }
}
