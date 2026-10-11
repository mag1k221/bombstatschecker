/** Shared domain types. Kept free of any source-specific (API) shapes. */

export type RegionId = "americas" | "europe" | "asia";

export interface PlayerRef {
  id: string | null;
  name: string;
  guildName: string | null;
  allianceName: string | null;
  /** Main-hand item type at the time of the event, e.g. "T6_2H_KNUCKLES_SET2@3". */
  weapon?: string | null;
}

/** How often a player was seen with a given main-hand item in a battle. */
export interface WeaponUse {
  type: string;
  /** Number of distinct events the player appeared in with this item. */
  count: number;
  lastSeen: string | null;
}

/** One kill event, normalized from the source. `id` is the stable source event identifier. */
export interface KillEvent {
  id: number;
  battleId: number;
  timestamp: string | null;
  killer: PlayerRef;
  victim: PlayerRef;
  /** Players credited with participation (damage/healing). Assists — never counted as kills. */
  participants: string[];
}

export type IssueKind =
  | "page_failed"
  | "pagination_cap"
  | "count_mismatch"
  | "summary_failed"
  | "battle_failed"
  | "foreign_event";

export interface DataIssue {
  kind: IssueKind;
  battleId: number;
  message: string;
}

export interface BattleMeta {
  id: number;
  startTime: string | null;
  endTime: string | null;
  /** Total kills reported by the battle summary, if the summary was retrieved. */
  reportedKills: number | null;
  /** Distinct kill events actually retrieved for this battle. */
  retrievedEvents: number;
  playerCount: number | null;
  pagesFetched: number;
  pagesFailed: number;
  status: "complete" | "partial" | "failed";
}

/** Everything the statistics layer needs. Produced by a source adapter. */
export interface BattleDataset {
  battles: BattleMeta[];
  events: KillEvent[];
  /** Every player name seen in the retrieved data (summary roster, killers, victims, participants, group members). */
  playersSeen: string[];
  /** Main-hand weapons observed per player name (source capitalization). */
  playerWeapons: Record<string, WeaponUse[]>;
  issues: DataIssue[];
}
