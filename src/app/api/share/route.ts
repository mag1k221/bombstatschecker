import { NextResponse, type NextRequest } from "next/server";
import { RateLimiter } from "@/lib/server/rate-limit";
import { normalizePayload, saveShare, shareStoreEnabled } from "@/lib/server/share-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new RateLimiter(Number(process.env.SHARE_RATE_LIMIT_PER_MINUTE ?? 30) || 30, 60_000);
const noStore = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  if (!shareStoreEnabled()) {
    return NextResponse.json({ code: "share_unavailable", error: "Short links are not configured." }, { status: 503, headers: noStore });
  }
  const raw = await req.text();
  if (raw.length > 64 * 1024) return NextResponse.json({ code: "invalid_input", error: "Too large." }, { status: 413, headers: noStore });
  let payload;
  try {
    payload = normalizePayload(JSON.parse(raw));
  } catch {
    payload = null;
  }
  if (!payload) return NextResponse.json({ code: "invalid_input", error: "Invalid battle link or roster." }, { status: 400, headers: noStore });

  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const rl = limiter.check(fwd || req.headers.get("x-real-ip") || "local");
  if (!rl.allowed) {
    return NextResponse.json({ code: "rate_limited", error: "Too many links. Try again soon." }, { status: 429, headers: { ...noStore, "Retry-After": String(rl.retryAfterSec) } });
  }
  try {
    const id = await saveShare(payload);
    return NextResponse.json({ id, path: `/s/${id}` }, { headers: noStore });
  } catch (err) {
    console.error("share save failed:", (err as Error)?.message);
    return NextResponse.json({ code: "share_unavailable", error: "Couldn’t create a short link." }, { status: 503, headers: noStore });
  }
}
