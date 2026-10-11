/** Statistics computation. Source-agnostic: consumes a BattleDataset and a roster. */
import type { BattleDataset } from "@/lib/types";
import { formatKD, kdValue } from "./kd";
import { normalizeName, type RosterMember } from "./roster";

export type MemberStatus = "matched" | "not_found";

export interface MemberStat {
  key: string;
  /** Source capitalization when found, otherwise the submitted spelling. */
  name: string;
  input: string;
  status: MemberStatus;
  kills: number;
  deaths: number;
  kd: number | null;
  kdDisplay: string;
  /** Kills/deaths where both killer and victim are on the roster (already included in kills/deaths). */
  friendlyKills: number;
  friendlyDeaths: number;
  /** True when the dataset is partial: counts may be undercounted, and "not found" is not conclusive. */
  incomplete: boolean;
}

export interface FriendlyFireEvent {
  eventId: number;
  battleId: number;
  timestamp: string | null;
  killer: string;
  victim: string;
}

export interface SquadSummary {
  submitted: number;
  matched: number;
  notFound: number;
  totalKills: number;
  totalDeaths: number;
  overallKd: number | null;
  overallKdDisplay: string;
}

export interface SquadStats {
  members: MemberStat[];
  summary: SquadSummary;
  friendlyFire: FriendlyFireEvent[];
  eventsConsidered: number;
  duplicateEventsIgnored: number;
}

export function computeSquadStats(
  roster: readonly RosterMember[],
  dataset: Pick<BattleDataset, "events" | "playersSeen">,
  opts: { partial: boolean },
): SquadStats {
  const rosterKeys = new Set(roster.map((m) => m.key));

  // Original capitalization from the source, first occurrence wins.
  const displayByKey = new Map<string, string>();
  for (const n of dataset.playersSeen) {
    const k = normalizeName(n);
    if (!displayByKey.has(k)) displayByKey.set(k, n);
  }

  const kills = new Map<string, number>();
  const deaths = new Map<string, number>();
  const fKills = new Map<string, number>();
  const fDeaths = new Map<string, number>();
  const friendlyFire: FriendlyFireEvent[] = [];
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  // Deduplicate by stable event ID so the same event is never counted twice.
  const seenIds = new Set<number>();
  let duplicates = 0;
  for (const e of dataset.events) {
    if (seenIds.has(e.id)) {
      duplicates++;
      continue;
    }
    seenIds.add(e.id);
    const kk = normalizeName(e.killer.name);
    const vk = normalizeName(e.victim.name);
    if (!displayByKey.has(kk)) displayByKey.set(kk, e.killer.name);
    if (!displayByKey.has(vk)) displayByKey.set(vk, e.victim.name);
    const killerIn = rosterKeys.has(kk);
    const victimIn = rosterKeys.has(vk);
    if (killerIn) inc(kills, kk); // killer credit only — participants/assists are never kills
    if (victimIn) inc(deaths, vk);
    if (killerIn && victimIn) {
      inc(fKills, kk);
      inc(fDeaths, vk);
      friendlyFire.push({
        eventId: e.id,
        battleId: e.battleId,
        timestamp: e.timestamp,
        killer: e.killer.name,
        victim: e.victim.name,
      });
    }
  }

  const members: MemberStat[] = roster.map((m) => {
    const found = displayByKey.has(m.key);
    const k = kills.get(m.key) ?? 0;
    const d = deaths.get(m.key) ?? 0;
    return {
      key: m.key,
      name: displayByKey.get(m.key) ?? m.input,
      input: m.input,
      status: found ? "matched" : "not_found",
      kills: k,
      deaths: d,
      kd: found ? kdValue(k, d) : null,
      kdDisplay: found ? formatKD(k, d) : "—",
      friendlyKills: fKills.get(m.key) ?? 0,
      friendlyDeaths: fDeaths.get(m.key) ?? 0,
      incomplete: opts.partial,
    };
  });

  const matched = members.filter((m) => m.status === "matched");
  const totalKills = matched.reduce((s, m) => s + m.kills, 0);
  const totalDeaths = matched.reduce((s, m) => s + m.deaths, 0);

  return {
    members,
    summary: {
      submitted: roster.length,
      matched: matched.length,
      notFound: members.length - matched.length,
      totalKills,
      totalDeaths,
      // Ratio of sums — never the average of individual ratios.
      overallKd: kdValue(totalKills, totalDeaths),
      overallKdDisplay: formatKD(totalKills, totalDeaths),
    },
    friendlyFire: friendlyFire.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")),
    eventsConsidered: seenIds.size,
    duplicateEventsIgnored: duplicates,
  };
}
