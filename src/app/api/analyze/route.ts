import { NextResponse, type NextRequest } from "next/server";
import { analyze } from "@/lib/server/analyze";
import { RateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BODY_BYTES = 64 * 1024;
const limiter = new RateLimiter(Number(process.env.ANALYZE_RATE_LIMIT_PER_MINUTE ?? 12) || 12, 60_000);
const demoEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO !== "false";

const noStore = { "Cache-Control": "no-store" };

function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "local";
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return NextResponse.json({ code: "invalid_input", error: "Expected application/json." }, { status: 415, headers: noStore });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ code: "invalid_input", error: "Request is too large." }, { status: 413, headers: noStore });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ code: "invalid_input", error: "Malformed JSON." }, { status: 400, headers: noStore });
  }

  const rl = limiter.check(clientKey(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { code: "rate_limited", error: `Too many analyses. Try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { ...noStore, "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  try {
    // The roster is processed in memory only and never logged or persisted.
    const outcome = await analyze(body, {}, demoEnabled);
    return NextResponse.json(outcome.body, { status: outcome.ok ? 200 : outcome.status, headers: noStore });
  } catch (err) {
    console.error("analyze failed:", (err as Error)?.message);
    return NextResponse.json({ code: "internal", error: "Something went wrong while analyzing." }, { status: 500, headers: noStore });
  }
}
