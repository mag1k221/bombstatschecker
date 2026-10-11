/**
 * Shareable result links: the battle and roster are encoded in the page URL, e.g.
 *   /?b=eu.441346892&m=Ashwick~Brannoc~Cinderfall
 * Long rosters are deflate-compressed into `z=` (base64url) to keep links pasteable in Discord.
 * Nothing is stored server-side; opening the link simply re-runs the analysis.
 */
import type { RegionId } from "@/lib/types";
import { REGIONS } from "@/lib/source/regions";
import { MAX_BATTLES_PER_LINK, parseAlbionBBLink } from "@/lib/source/url";
import { MAX_ROSTER_SIZE } from "@/lib/stats/roster";

const REGION_CODE: Record<RegionId, string> = { americas: "west", europe: "eu", asia: "east" };
const CODE_REGION: Record<string, RegionId> = { west: "americas", eu: "europe", east: "asia" };
/** Above this many characters, the roster is compressed. */
export const COMPRESS_THRESHOLD = 1500;
const SEP = "~"; // never valid in a nickname and left unescaped by encodeURIComponent

export interface SharePayload {
  /** Canonical AlbionBB link. */
  url: string;
  members: string[];
}

export function battleParam(canonicalUrl: string): string {
  const link = parseAlbionBBLink(canonicalUrl);
  return `${REGION_CODE[link.region]}.${link.battleIds.join("-")}`;
}

export function urlFromBattleParam(b: string): string | null {
  const m = /^(west|eu|east)\.(\d{1,12}(?:-\d{1,12}){0,20})$/.exec(b);
  if (!m) return null;
  const ids = m[2].split("-").slice(0, MAX_BATTLES_PER_LINK);
  const host = REGIONS[CODE_REGION[m[1]]].albionbbHosts[0];
  const raw = ids.length === 1 ? `https://${host}/battles/${ids[0]}` : `https://${host}/battles/multi?ids=${ids.join(",")}`;
  try {
    return parseAlbionBBLink(raw).canonicalUrl;
  } catch {
    return null;
  }
}

const joinMembers = (members: readonly string[]) => members.map((n) => encodeURIComponent(n)).join(SEP);
const splitMembers = (s: string) =>
  s
    .split(SEP)
    .map((n) => {
      try {
        return decodeURIComponent(n).trim();
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .slice(0, MAX_ROSTER_SIZE);

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = 256 * 1024): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  const buf = new Uint8Array(await out.arrayBuffer());
  if (buf.byteLength > limit) throw new Error("payload too large");
  return buf;
}

/** Builds the query string (without "?"). */
export async function buildShareQuery(payload: SharePayload): Promise<string> {
  const b = battleParam(payload.url);
  const plain = joinMembers(payload.members);
  if (plain.length <= COMPRESS_THRESHOLD || typeof CompressionStream === "undefined") return `b=${b}&m=${plain}`;
  const z = await pipe(new TextEncoder().encode(payload.members.join("\n")), new CompressionStream("deflate-raw"));
  const zs = toBase64Url(z);
  return zs.length < plain.length ? `b=${b}&z=${zs}` : `b=${b}&m=${plain}`;
}

/** Parses a page query string; returns null when it isn't a share link. */
export async function parseShareQuery(search: string): Promise<SharePayload | null> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const b = params.get("b");
  if (!b) return null;
  const url = urlFromBattleParam(b);
  if (!url) return null;
  let members: string[] = [];
  const z = params.get("z");
  if (z && /^[A-Za-z0-9_-]{1,20000}$/.test(z) && typeof DecompressionStream !== "undefined") {
    try {
      const raw = await pipe(fromBase64Url(z), new DecompressionStream("deflate-raw"));
      members = new TextDecoder().decode(raw).split("\n").map((n) => n.trim()).filter(Boolean).slice(0, MAX_ROSTER_SIZE);
    } catch {
      members = [];
    }
  } else {
    // URLSearchParams already decoded once; re-split the raw value to keep "~" boundaries exact.
    const rawM = /(?:^|&)m=([^&]*)/.exec(search.replace(/^\?/, ""))?.[1];
    members = rawM ? splitMembers(rawM) : [];
  }
  return { url, members };
}
