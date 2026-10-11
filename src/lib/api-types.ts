/** Wire format for POST /api/analyze — shared by server and client. */
import type { BattleMeta, DataIssue, RegionId } from "@/lib/types";
import type { FriendlyFireEvent, MemberStat, RoleStat, SquadSummary } from "@/lib/stats/compute";

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
  friendlyFire: FriendlyFireEvent[];
}

export interface AnalyzeError {
  error: string;
  code: "invalid_input" | "invalid_link" | "not_found" | "rate_limited" | "upstream_unavailable" | "demo_disabled" | "internal";
}
