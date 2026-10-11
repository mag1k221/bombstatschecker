import type { RegionId } from "@/lib/types";

/**
 * Fixed mapping from AlbionBB hostnames to the official Albion Online game-info API
 * for the same game server. Upstream hosts are constants — never derived from user input —
 * which is the primary SSRF defense.
 *
 * Verified: AlbionBB battle IDs are the official battle IDs (e.g. albionbb.com/battles/1407921257
 * shows the same 14 kills / 26 players as gameinfo.albiononline.com/api/gameinfo/battles/1407921257).
 */
export interface RegionConfig {
  id: RegionId;
  label: string;
  albionbbHosts: readonly string[];
  apiBase: string;
  /** Albion Online Data Project (crowdsourced market prices) for the same server. */
  marketBase: string;
}

export const REGIONS: Record<RegionId, RegionConfig> = {
  americas: {
    id: "americas",
    label: "Americas (West)",
    albionbbHosts: ["albionbb.com", "www.albionbb.com"],
    apiBase: "https://gameinfo.albiononline.com/api/gameinfo",
    marketBase: "https://west.albion-online-data.com/api/v2/stats/prices",
  },
  europe: {
    id: "europe",
    label: "Europe",
    albionbbHosts: ["europe.albionbb.com"],
    apiBase: "https://gameinfo-ams.albiononline.com/api/gameinfo",
    marketBase: "https://europe.albion-online-data.com/api/v2/stats/prices",
  },
  asia: {
    id: "asia",
    label: "Asia (East)",
    albionbbHosts: ["east.albionbb.com"],
    apiBase: "https://gameinfo-sgp.albiononline.com/api/gameinfo",
    marketBase: "https://east.albion-online-data.com/api/v2/stats/prices",
  },
};

export const ALLOWED_UPSTREAM_HOSTS: ReadonlySet<string> = new Set(
  Object.values(REGIONS).flatMap((r) => [new URL(r.apiBase).host, new URL(r.marketBase).host]),
);

export function regionForHost(host: string): RegionConfig | null {
  const h = host.toLowerCase();
  for (const r of Object.values(REGIONS)) {
    if (r.albionbbHosts.includes(h)) return r;
  }
  return null;
}
