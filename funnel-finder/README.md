# Funnel Finder (Local)

A local app that finds likely **ad landing pages** and **funnel paths** from any website.

## What it does

1. **Paste a URL** – You enter a website URL.
2. **Preview** – Shows resolved final URL, page title, and a screenshot (via Playwright).
3. **Scrape** – Discovers pages via sitemaps and internal crawl, then:
   - Filters out: 404, 4xx, 5xx (including 505), non-HTML, and excluded sections (FAQ/blog/legal/support/etc).
   - Scores pages as “ad-like” (landing/offer/checkout/thank-you hints, CTAs, forms, tracking).
   - Builds funnel paths: landing → intermediate steps → conversion (checkout/order/thank-you/success/confirm).
4. **Copy** – All results (funnels + ad-like pages) in one textarea with a “Copy all” button.

## Tech stack

- **Next.js** (App Router) + TypeScript + Tailwind
- **API routes** (Node runtime): `/api/preview`, `/api/scrape`
- **Playwright** – screenshots + JS fallback for fetching HTML
- **Cheerio** – HTML parsing and scoring
- **fast-xml-parser** – sitemap parsing
- **p-limit** – low-concurrency polite crawling

Crawling is polite: respects robots.txt (best-effort), prefers sitemaps, then internal links; low concurrency, small delays, identifiable user-agent.

## Install & run

**Prerequisites:** [Node.js](https://nodejs.org/) (LTS) or `brew install node`.

```bash
cd funnel-finder
npm install
npm run dev
```

`npm install` runs a **postinstall** script that installs Playwright’s Chromium (and system deps with `--with-deps`). No need to run `npx playwright install` separately.

Open [http://localhost:3000](http://localhost:3000). Paste a URL (e.g. `https://www.godresults.com/`), click **Preview**, then **Scrape**, and use **Copy all** to copy the output.

### Localhost / browser extensions (Cursor / VS Code)

This workspace recommends:

- **Live Server** (`ritwickdey.LiveServer`) – local dev server with live reload.
- **Open in Browser** (`techer.open-in-browser`) – open the current app in your default browser.

When you open the project in Cursor, you’ll get a prompt to **Install** the recommended extensions. You can also install them manually from the Extensions view (search for “Live Server” and “Open in Browser”).

## Project structure

```
src/
  app/
    api/
      preview/route.ts   # POST { url } → finalUrl, title, screenshotBase64
      scrape/route.ts    # POST { url } → full ScrapeResult
    layout.tsx
    page.tsx
    globals.css
  lib/
    url.ts       # normalizeUrl, sameOrigin, toAbsoluteUrl, stripUtm
    robots.ts    # fetchRobots, isAllowedByRobots
    sitemap.ts   # discoverSitemapUrls
    crawl.ts     # previewSite, runFunnelFinder, scoring & funnel building
```

## Tuning

In `src/lib/crawl.ts`:

- **Crawl size**: `crawlInternalLinks(..., maxPages=350, maxDepth=4)`
- **Ad-like threshold**: `score >= 18`
- **Excluded paths**: `EXCLUDE_KEYWORDS` (faq, blog, privacy, support, etc.)
- **Funnel/CTA/conversion hints**: `FUNNEL_URL_HINTS`, `CTA_TEXT_HINTS`, `CONVERSION_HINTS`

Add custom path tokens (e.g. `"book-now"`, `"application"`) to improve detection for your target sites.
