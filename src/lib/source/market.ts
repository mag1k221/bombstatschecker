import type { RegionId } from "@/lib/types";
import type { PriceQuote } from "@/lib/api-types";
import { REGIONS } from "./regions";
import { HttpClient } from "./http";
import { TtlCache } from "@/lib/server/ttl-cache";

/** Royal cities + Brecilien. "all" = cheapest across all of them. */
export const MARKET_LOCATIONS = ["Caerleon", "Bridgewatch", "Lymhurst", "Martlock", "Fort Sterling", "Thetford", "Brecilien"] as const;
export type MarketLocation = (typeof MARKET_LOCATIONS)[number] | "all";

export function isMarketLocation(v: unknown): v is MarketLocation {
  return v === "all" || (typeof v === "string" && (MARKET_LOCATIONS as readonly string[]).includes(v));
}

/** Prices older than this are treated as missing. */
export const MAX_PRICE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_URL_LENGTH = 3800;

export interface MarketRow {
  item_id: string;
  city: string;
  quality: number;
  sell_price_min: number;
  sell_price_min_date: string;
}

function parseDate(s: unknown): number {
  if (typeof s !== "string" || s.startsWith("0001")) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

/**
 * Picks the cheapest recent sell order for the requested quality in the chosen location.
 * Falls back to the nearest quality with data (ties → the higher quality), so the caller can flag it as approximate.
 */
export function selectQuote(
  rows: readonly MarketRow[],
  quality: number,
  location: MarketLocation,
  now: number = Date.now(),
): PriceQuote | null {
  const valid = rows.filter((r) => {
    if (!(Number.isFinite(r.sell_price_min) && r.sell_price_min > 0)) return false;
    if (location !== "all" && r.city !== location) return false;
    if (location === "all" && !(MARKET_LOCATIONS as readonly string[]).includes(r.city)) return false;
    const t = parseDate(r.sell_price_min_date);
    return Number.isFinite(t) && now - t <= MAX_PRICE_AGE_MS;
  });
  if (valid.length === 0) return null;
  let best: MarketRow | null = null;
  let bestScore = Infinity;
  for (const r of valid) {
    const dist = Math.abs(r.quality - quality);
    // Primary: quality distance; secondary: prefer higher quality on ties; tertiary: price.
    const score = dist * 1e15 + (r.quality < quality ? 1e14 : 0) + r.sell_price_min;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best) return null;
  return {
    price: best.sell_price_min,
    quality: best.quality,
    city: best.city,
    observedAt: new Date(parseDate(best.sell_price_min_date)).toISOString(),
  };
}

/** Splits item IDs into groups whose request URL stays under the length limit. */
export function chunkItems(base: string, ids: readonly string[], suffix: string, maxLen = MAX_URL_LENGTH): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = base.length + 1 + ".json".length + suffix.length;
  const baseLen = len;
  for (const id of ids) {
    const add = encodeURIComponent(id).length + (cur.length ? 1 : 0);
    if (cur.length && len + add > maxLen) {
      chunks.push(cur);
      cur = [];
      len = baseLen;
    }
    cur.push(id);
    len += encodeURIComponent(id).length + (cur.length > 1 ? 1 : 0);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export interface MarketDeps {
  client?: HttpClient;
  cache?: TtlCache<MarketRow[]>;
  now?: () => number;
}

// The Data Project asks for ≤180 requests/min; space them out and cache aggressively.
const defaultClient = new HttpClient({ minIntervalMs: 400, retries: 1, timeoutMs: 15_000, maxBytes: 8 * 1024 * 1024 });
const defaultCache = new TtlCache<MarketRow[]>(5000);

export async function fetchPrices(
  region: RegionId,
  location: MarketLocation,
  items: readonly { type: string; quality: number }[],
  deps: MarketDeps = {},
): Promise<{ quotes: Record<string, PriceQuote>; failedChunks: number }> {
  const client = deps.client ?? defaultClient;
  const cache = deps.cache ?? defaultCache;
  const now = deps.now ?? Date.now;
  const base = REGIONS[region].marketBase;

  const types = [...new Set(items.map((i) => i.type))];
  const rowsByType = new Map<string, MarketRow[]>();
  const missing: string[] = [];
  for (const t of types) {
    const hit = cache.get(`${region}|${t}`);
    if (hit) rowsByType.set(t, hit);
    else missing.push(t);
  }

  // Always ask for every market so changing the city in the UI is served from cache.
  const suffix = `?locations=${MARKET_LOCATIONS.map(encodeURIComponent).join(",")}&qualities=1,2,3,4,5`;
  let failedChunks = 0;
  for (const chunk of chunkItems(base, missing, suffix)) {
    const url = `${base}/${chunk.map(encodeURIComponent).join(",")}.json${suffix}`;
    const res = await client.getJson<unknown>(url);
    if (!res.ok || !Array.isArray(res.data)) {
      failedChunks++;
      continue;
    }
    const grouped = new Map<string, MarketRow[]>(chunk.map((t) => [t, []]));
    for (const r of res.data as Record<string, unknown>[]) {
      const id = typeof r?.item_id === "string" ? r.item_id : null;
      if (!id || !grouped.has(id)) continue;
      grouped.get(id)!.push({
        item_id: id,
        city: String(r.city ?? ""),
        quality: Number(r.quality),
        sell_price_min: Number(r.sell_price_min),
        sell_price_min_date: String(r.sell_price_min_date ?? ""),
      });
    }
    for (const [t, rows] of grouped) {
      rowsByType.set(t, rows);
      cache.set(`${region}|${t}`, rows, CACHE_TTL_MS);
    }
  }

  const quotes: Record<string, PriceQuote> = {};
  const t = now();
  for (const { type, quality } of items) {
    const rows = rowsByType.get(type);
    if (!rows) continue;
    const q = selectQuote(rows, quality, location, t);
    if (q) quotes[`${type}#${quality}`] = q;
  }
  return { quotes, failedChunks };
}
