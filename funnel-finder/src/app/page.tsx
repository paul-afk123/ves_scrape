"use client";

import { useMemo, useState } from "react";

type Preview = { finalUrl: string; title?: string; screenshotBase64?: string };
type ScrapeResult = {
  outputText?: string;
  discovered?: { totalUnique?: number };
  kept?: { checked?: number; adLike?: number; funnels?: number };
  excludedSamples?: string[];
  adLikePages?: { finalUrl: string }[];
  funnels?: { landing: string; steps: string[]; conversion: string }[];
};

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [loadingScrape, setLoadingScrape] = useState(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const previewImgSrc = useMemo(() => {
    if (!preview?.screenshotBase64) return null;
    return `data:image/png;base64,${preview.screenshotBase64}`;
  }, [preview]);

  async function doPreview() {
    setError(null);
    setLoadingPreview(true);
    setPreview(null);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Preview failed");
      setPreview({ finalUrl: data.finalUrl, title: data.title, screenshotBase64: data.screenshotBase64 });
    } catch (e: unknown) {
      const err = e as Error;
      setError(err?.message || "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doScrape() {
    setError(null);
    setLoadingScrape(true);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Scrape failed");
      setResult(data.result);
    } catch (e: unknown) {
      const err = e as Error;
      setError(err?.message || "Scrape failed");
    } finally {
      setLoadingScrape(false);
    }
  }

  async function copyAll() {
    if (!result?.outputText) return;
    await navigator.clipboard.writeText(result.outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Funnel Finder (Local)</h1>
        <p className="text-slate-600">
          Paste a site → preview → scrape → copy all results from one textbox.
        </p>
      </header>

      <section className="rounded-xl border p-4 space-y-3">
        <label className="block text-sm font-medium">Website URL</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border px-3 py-2"
            placeholder="https://www.godresults.com/"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="rounded-lg bg-black text-white px-4 py-2 disabled:opacity-50"
            onClick={doPreview}
            disabled={!url.trim() || loadingPreview}
          >
            {loadingPreview ? "Preview..." : "Preview"}
          </button>
          <button
            className="rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
            onClick={doScrape}
            disabled={!url.trim() || loadingScrape}
          >
            {loadingScrape ? "Scraping..." : "Scrape"}
          </button>
        </div>

        {error && <div className="text-red-600 text-sm">{error}</div>}

        {preview && (
          <div className="grid md:grid-cols-2 gap-4 pt-2">
            <div className="rounded-lg border p-3">
              <div className="text-sm text-slate-500">Resolved URL</div>
              <div className="font-mono text-sm break-all">{preview.finalUrl}</div>
              <div className="mt-2 text-sm text-slate-500">Title</div>
              <div className="text-sm">{preview.title || "(no title)"}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-sm text-slate-500 mb-2">Screenshot</div>
              {previewImgSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="rounded-md border" src={previewImgSrc} alt="site preview" />
              ) : (
                <div className="text-sm text-slate-500">(no screenshot)</div>
              )}
            </div>
          </div>
        )}
      </section>

      {result && (
        <section className="rounded-xl border p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Results</h2>
            <button
              className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
              onClick={copyAll}
              disabled={!result?.outputText}
            >
              {copied ? "Copied!" : "Copy all"}
            </button>
          </div>

          <div className="grid md:grid-cols-4 gap-3">
            <Stat title="Unique discovered" value={result.discovered?.totalUnique} />
            <Stat title="Checked" value={result.kept?.checked} />
            <Stat title="Ad-like pages" value={result.kept?.adLike} />
            <Stat title="Funnels" value={result.kept?.funnels} />
          </div>

          {/* Clickable links: one per line in a box */}
          {(() => {
            const urls = new Set<string>();
            (result.funnels || []).forEach((f) => {
              urls.add(f.landing);
              (f.steps || []).forEach((s) => urls.add(s));
              urls.add(f.conversion);
            });
            (result.adLikePages || []).forEach((p) => urls.add(p.finalUrl));
            const linkList = Array.from(urls);
            if (linkList.length === 0) return null;
            return (
              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-700">Links (click to open)</div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 max-h-[320px] overflow-y-auto">
                  <ul className="space-y-2 list-none">
                    {linkList.map((href, i) => (
                      <li key={i} className="border-b border-slate-200 last:border-0 pb-2 last:pb-0">
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline break-all font-mono text-sm"
                        >
                          {href}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })()}

          <div className="space-y-2">
            <div className="text-sm text-slate-600">
              Everything relevant is in the box below (funnels + ad-like pages). Paste anywhere.
            </div>
            <textarea
              className="w-full h-[420px] rounded-lg border p-3 font-mono text-sm"
              readOnly
              value={result.outputText || ""}
            />
          </div>

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-semibold">Excluded samples (debug)</summary>
            <ul className="mt-2 text-sm font-mono break-all space-y-1">
              {(result.excludedSamples || []).map((u: string, i: number) => <li key={i}>{u}</li>)}
            </ul>
          </details>
        </section>
      )}
    </main>
  );
}

function Stat({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="text-2xl font-bold">{value != null ? String(value) : "-"}</div>
    </div>
  );
}
