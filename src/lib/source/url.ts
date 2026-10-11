import type { RegionId } from "@/lib/types";
import { regionForHost } from "./regions";

export const MAX_URL_LENGTH = 2048;
export const MAX_BATTLES_PER_LINK = 10;

export interface ParsedBattleLink {
  region: RegionId;
  kind: "battle" | "multi";
  battleIds: number[];
  /** Canonical AlbionBB URL rebuilt from validated parts. */
  canonicalUrl: string;
}

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}

const ID_RE = /^[1-9]\d{0,11}$/;

function parseId(raw: string): number {
  const s = raw.trim();
  if (!ID_RE.test(s)) throw new LinkError(`“${s.slice(0, 20)}” is not a valid battle ID.`);
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new LinkError("Battle ID is out of range.");
  return n;
}

/**
 * Accepts only:
 *   https://{albionbb.com|www.albionbb.com|europe.albionbb.com|east.albionbb.com}/battles/{id}
 *   https://{same hosts}/battles/multi?ids={id},{id},...
 * Anything else (other hosts, ports, credentials, player/guild pages) is rejected.
 */
export function parseAlbionBBLink(input: unknown): ParsedBattleLink {
  if (typeof input !== "string") throw new LinkError("Paste an AlbionBB battle link.");
  let raw = input.trim();
  if (!raw) throw new LinkError("Paste an AlbionBB battle link.");
  if (raw.length > MAX_URL_LENGTH) throw new LinkError("That link is too long.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkError("That doesn’t look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LinkError("Only http(s) AlbionBB links are supported.");
  }
  if (url.username || url.password) throw new LinkError("Links with credentials are not allowed.");
  if (url.port) throw new LinkError("Links with a custom port are not supported.");

  const region = regionForHost(url.hostname);
  if (!region) {
    throw new LinkError(
      "Only AlbionBB links are supported (albionbb.com, europe.albionbb.com, east.albionbb.com).",
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  const single = /^\/battles\/(\d+)$/.exec(path);
  if (single) {
    const id = parseId(single[1]);
    return {
      region: region.id,
      kind: "battle",
      battleIds: [id],
      canonicalUrl: `https://${region.albionbbHosts[0]}/battles/${id}`,
    };
  }

  if (path === "/battles/multi") {
    const idsParam = url.searchParams.get("ids");
    if (!idsParam) throw new LinkError("This multi-battle link has no battle IDs.");
    const ids = [...new Set(idsParam.split(",").filter((s) => s.trim() !== "").map(parseId))];
    if (ids.length === 0) throw new LinkError("This multi-battle link has no battle IDs.");
    if (ids.length > MAX_BATTLES_PER_LINK) {
      throw new LinkError(`Multi-battle links are limited to ${MAX_BATTLES_PER_LINK} battles.`);
    }
    return {
      region: region.id,
      kind: ids.length === 1 ? "battle" : "multi",
      battleIds: ids,
      canonicalUrl:
        ids.length === 1
          ? `https://${region.albionbbHosts[0]}/battles/${ids[0]}`
          : `https://${region.albionbbHosts[0]}/battles/multi?ids=${ids.join(",")}`,
    };
  }

  if (/^\/(players|guilds|alliances)\//.test(path)) {
    throw new LinkError(
      "Player, guild and alliance pages show lifetime data. Paste a battle link (…/battles/123456789) instead.",
    );
  }
  throw new LinkError("Paste a battle link such as https://albionbb.com/battles/123456789.");
}
