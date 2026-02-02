import { NextResponse } from "next/server";
import { runFunnelFinder } from "@/lib/crawl";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    const result = await runFunnelFinder(url);
    return NextResponse.json({ ok: true, result });
  } catch (e: unknown) {
    const err = e as Error;
    return NextResponse.json({ ok: false, error: err?.message || "Scrape failed" }, { status: 400 });
  }
}
