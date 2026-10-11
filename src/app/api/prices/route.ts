import { NextResponse, type NextRequest } from "next/server";
import { RateLimiter } from "@/lib/server/rate-limit";
import { fetchPrices, isMarketLocation } from "@/lib/source/market";
import { REGIONS } from "@/lib/source/regions";
import { isValidItemType } from "@/lib/weapons/catalog";
import type { PricesResponse } from "@/lib/api-types";
import type { RegionId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ITEMS = 400;
const limiter = new RateLimiter(Number(process.env.PRICES_RATE_LIMIT_PER_MINUTE ?? 20) || 20, 60_000);
const noStore = { "Cache-Control": "no-store" };

function bad(error: string, status = 400) {
  return NextResponse.json({ code: "invalid_input", error }, { status, headers: noStore });
}

export async function POST(req: NextRequest) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return bad("Expected application/json.", 415);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return bad("Request is too large.", 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad("Malformed JSON.");
  }
  const region = body?.region;
  if (typeof region !== "string" || !Object.hasOwn(REGIONS, region)) return bad("Unknown region.");
  const location = body.location;
  if (!isMarketLocation(location)) return bad("Unknown market location.");
  if (!Array.isArray(body.items)) return bad("Items must be a list.");

  const seen = new Set<string>();
  const items: { type: string; quality: number }[] = [];
  for (const it of body.items as Record<string, unknown>[]) {
    const type = it?.type;
    const quality = Number(it?.quality);
    if (!isValidItemType(type) || !Number.isInteger(quality) || quality < 1 || quality > 5) continue;
    const key = `${type}#${quality}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type, quality });
  }
  if (items.length > MAX_ITEMS) return bad(`Too many items (max ${MAX_ITEMS}).`);

  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const rl = limiter.check(fwd || req.headers.get("x-real-ip") || "local");
  if (!rl.allowed) {
    return NextResponse.json(
      { code: "rate_limited", error: `Too many price lookups. Try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { ...noStore, "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  try {
    const { quotes, failedChunks } = await fetchPrices(region as RegionId, location, items);
    const out: PricesResponse = { region: region as RegionId, location, quotes, retrievedAt: new Date().toISOString(), failedChunks };
    return NextResponse.json(out, { headers: noStore });
  } catch (err) {
    console.error("prices failed:", (err as Error)?.message);
    return NextResponse.json({ code: "upstream_unavailable", error: "Market prices are unavailable right now." }, { status: 502, headers: noStore });
  }
}
