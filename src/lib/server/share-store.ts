/**
 * Short share links (/s/AbC12xYz) backed by Upstash Redis over its REST API.
 * Configure with Vercel's Upstash integration (KV_REST_API_URL / KV_REST_API_TOKEN) or
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Without it, the app falls back to long links.
 */
import { createHash } from "node:crypto";
import { parseAlbionBBLink } from "@/lib/source/url";
import { buildRoster } from "@/lib/stats/roster";
import type { SharePayload } from "@/lib/share";

const ID_RE = /^[A-Za-z0-9]{8}$/;
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PREFIX = "boomsquad:share:";

/**
 * Finds the Upstash REST credentials. Vercel may add a custom prefix
 * (e.g. "myproject_KV_REST_API_URL"), so any matching URL/TOKEN pair with the same prefix is accepted.
 */
function findCredentials(env: NodeJS.ProcessEnv = process.env): { url?: string; token?: string } {
  const pairs: [string, string][] = [
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ];
  for (const [u, t] of pairs) if (env[u] && env[t]) return { url: env[u], token: env[t] };
  for (const key of Object.keys(env).sort()) {
    for (const [u, t] of pairs) {
      if (key.endsWith(`_${u}`)) {
        const prefix = key.slice(0, -u.length);
        const token = env[prefix + t];
        if (env[key] && token) return { url: env[key], token };
      }
    }
  }
  return {};
}

function config() {
  const { url, token } = findCredentials();
  if (!url || !token || !(/^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url))) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export const shareStoreEnabled = () => config() !== null;

export function ttlSeconds(): number {
  const days = Number(process.env.SHARE_TTL_DAYS ?? 180);
  return Math.round((Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : 180) * 86400);
}

/** Validates and normalizes a payload; returns null when unusable. */
export function normalizePayload(raw: unknown): SharePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  let url: string;
  try {
    url = parseAlbionBBLink(r.url).canonicalUrl;
  } catch {
    return null;
  }
  if (!Array.isArray(r.members)) return null;
  const members = buildRoster(r.members).members.map((m) => m.input);
  return members.length ? { url, members } : null;
}

/** Deterministic 8-char base62 id: the same battle + roster always gets the same link. */
export function shareId(p: SharePayload): string {
  const digest = createHash("sha256").update(JSON.stringify([p.url, p.members])).digest();
  let n = digest.readBigUInt64BE(0);
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += B62[Number(n % 62n)];
    n /= 62n;
  }
  return id;
}

async function command(args: (string | number)[]): Promise<unknown> {
  const c = config();
  if (!c) throw new Error("share store not configured");
  const res = await fetch(c.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`share store responded ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error("share store error");
  return body.result;
}

export async function saveShare(p: SharePayload): Promise<string> {
  const id = shareId(p);
  await command(["SET", PREFIX + id, JSON.stringify({ u: p.url, m: p.members }), "EX", ttlSeconds()]);
  return id;
}

export async function loadShare(id: string): Promise<SharePayload | null> {
  if (!ID_RE.test(id) || !shareStoreEnabled()) return null;
  try {
    const raw = await command(["GET", PREFIX + id]);
    if (typeof raw !== "string") return null;
    const v = JSON.parse(raw) as { u?: unknown; m?: unknown };
    return normalizePayload({ url: v.u, members: v.m });
  } catch {
    return null;
  }
}
