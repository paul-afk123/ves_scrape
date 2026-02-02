import { sameOrigin } from "./url";

export type RobotsRules = {
  sitemaps: string[];
  disallow: string[]; // best-effort for UA: *
};

export async function fetchRobots(baseUrl: string, headers: HeadersInit): Promise<RobotsRules> {
  const base = new URL(baseUrl);
  const robotsUrl = `${base.protocol}//${base.host}/robots.txt`;

  try {
    const res = await fetch(robotsUrl, { redirect: "follow", headers });
    if (!res.ok) return { sitemaps: [], disallow: [] };
    const text = await res.text();
    return parseRobots(text, robotsUrl);
  } catch {
    return { sitemaps: [], disallow: [] };
  }
}

function parseRobots(txt: string, robotsUrl: string): RobotsRules {
  const lines = txt.split(/\r?\n/);
  const sitemaps: string[] = [];
  const disallow: string[] = [];

  let inStarGroup = false;

  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;

    const [kRaw, ...rest] = line.split(":");
    const key = kRaw.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      inStarGroup = value === "*";
      continue;
    }

    if (key === "sitemap") {
      try {
        const u = new URL(value, robotsUrl).toString();
        sitemaps.push(u);
      } catch {}
      continue;
    }

    if (inStarGroup && key === "disallow") {
      if (value) disallow.push(value);
      continue;
    }
  }

  return { sitemaps: Array.from(new Set(sitemaps)), disallow };
}

export function isAllowedByRobots(baseUrl: string, rules: RobotsRules, candidateUrl: string): boolean {
  if (!sameOrigin(baseUrl, candidateUrl)) return false;

  const u = new URL(candidateUrl);
  const path = u.pathname || "/";

  // Best-effort: treat Disallow as prefix
  for (const dis of rules.disallow) {
    if (!dis) continue;
    if (path.startsWith(dis)) return false;
  }
  return true;
}
