import { NextResponse } from "next/server";
import { previewSite } from "@/lib/crawl";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    const data = await previewSite(url);
    return NextResponse.json({ ok: true, ...data });
  } catch (e: unknown) {
    const err = e as Error;
    return NextResponse.json({ ok: false, error: err?.message || "Preview failed" }, { status: 400 });
  }
}
