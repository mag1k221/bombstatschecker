/** Wire format for POST /api/analyze — shared by server and client. */
import type { BattleMeta, DataIssue, RegionId } from "@/lib/types";
import type { FriendlyFireEvent, GroupShare, MemberStat, RoleStat, SquadDeath, SquadSummary } from "@/lib/stats/compute";

export interface AnalyzeRequest {
  url?: string;
  members: string[];
  refresh?: boolean;
  demo?: boolean;
}

export interface AnalyzeResponse {
  mode: "live" | "demo";
  source: {
    inputUrl: string;
    canonicalUrl: string;
    region: RegionId | null;
    regionLabel: string;
    kind: "battle" | "multi";
    battles: BattleMeta[];
    retrievedAt: string;
    fromCache: boolean;
    completeness: "complete" | "partial";
    issues: DataIssue[];
    eventsConsidered: number;
    duplicateEventsIgnored: number;
  };
  roster: {
    duplicatesRemoved: string[];
    invalid: { name: string; reason: string }[];
    overflow: number;
  };
  summary: SquadSummary;
  members: MemberStat[];
  roleBreakdown: RoleStat[];
  squadDeaths: SquadDeath[];
  /** Squad share of each guild/alliance's kills (guilds first, most squad members first). */
  groupShares: GroupShare[];
  friendlyFire: FriendlyFireEvent[];
}

export interface PriceQuote {
  /** Silver per item. */
  price: number;
  /** Quality the price was found for (may differ from requested when exact is unavailable). */
  quality: number;
  city: string;
  /** ISO timestamp of the price observation. */
  observedAt: string;
}

export interface PricesRequest {
  region: RegionId;
  location: string;
  items: { type: string; quality: number }[];
}

export interface PricesResponse {
  region: RegionId;
  location: string;
  /** Keyed by `${type}#${quality}`; missing key = no recent price. */
  quotes: Record<string, PriceQuote>;
  retrievedAt: string;
  failedChunks: number;
}

export interface AnalyzeError {
  error: string;
  code: "invalid_input" | "invalid_link" | "not_found" | "rate_limited" | "upstream_unavailable" | "demo_disabled" | "internal";
}
