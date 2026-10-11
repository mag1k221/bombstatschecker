/** Statistics computation. Source-agnostic: consumes a BattleDataset and a roster. */
import type { BattleDataset } from "@/lib/types";
import { formatKD, kdValue } from "./kd";
import { normalizeName, type RosterMember } from "./roster";
import { resolveLoadout } from "@/lib/weapons/loadout";
import { itemName } from "@/lib/weapons/catalog";
import type { PlayerCombat } from "@/lib/types";
import { ROLE_ORDER, type Role } from "@/lib/weapons/roles";

export interface MemberWeapon {
  /** Full item type (icon key), e.g. "T6_2H_KNUCKLES_SET2@3". */
  type: string;
  name: string;
  tier: number | null;
  enchant: number;
}

export interface LostItem {
  slot: string;
  type: string;
  quality: number;
  name: string;
}

export interface SquadDeath {
  eventId: number;
  battleId: number;
  timestamp: string | null;
  /** Roster key of the victim. */
  memberKey: string;
  victim: string;
  killer: string;
  killerGuild: string | null;
  deathFame: number | null;
  items: LostItem[];
}

export interface RoleStat {
  role: Role;
  members: number;
  kills: number;
  deaths: number;
  kd: number | null;
  kdDisplay: string;
}

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
  /** Most-used main-hand weapon in the battle; null when no gear was observed. */
  weapon: MemberWeapon | null;
  /** Inferred from the weapon (not provided by the game). */
  role: Role;
  /** Other weapons seen for this member in the battle. */
  otherWeapons: string[];
  /** Damage dealt across kills the member took part in. */
  damage: number;
  /** Healing done across kills the member took part in. */
  healing: number;
  /** Average item power over events where it was reported; null when never reported. */
  avgIp: number | null;
  /** Kill fame from the battle summary; null when unavailable. */
  killFame: number | null;
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
  roleBreakdown: RoleStat[];
  squadDeaths: SquadDeath[];
  eventsConsidered: number;
  duplicateEventsIgnored: number;
}

export function computeSquadStats(
  roster: readonly RosterMember[],
  dataset: Pick<BattleDataset, "events" | "playersSeen"> & Partial<Pick<BattleDataset, "playerWeapons" | "playerCombat">>,
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
  const squadDeaths: SquadDeath[] = [];
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
    if (victimIn) {
      inc(deaths, vk);
      squadDeaths.push({
        eventId: e.id,
        battleId: e.battleId,
        timestamp: e.timestamp,
        memberKey: vk,
        victim: e.victim.name,
        killer: e.killer.name,
        killerGuild: e.killer.guildName,
        deathFame: e.victimDeathFame ?? null,
        items: (e.victimGear ?? []).map((g) => ({ slot: g.slot, type: g.type, quality: g.quality, name: itemName(g.type) })),
      });
    }
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

  // Weapon observations keyed by normalized name (merging any capitalization variants).
  const weaponsByKey = new Map<string, NonNullable<BattleDataset["playerWeapons"]>[string]>();
  for (const [name, uses] of Object.entries(dataset.playerWeapons ?? {})) {
    const k = normalizeName(name);
    weaponsByKey.set(k, [...(weaponsByKey.get(k) ?? []), ...uses]);
  }

  const combatByKey = new Map<string, PlayerCombat>();
  for (const [name, c] of Object.entries(dataset.playerCombat ?? {})) {
    const k = normalizeName(name);
    const cur = combatByKey.get(k);
    if (!cur) combatByKey.set(k, { ...c });
    else {
      cur.damage += c.damage;
      cur.healing += c.healing;
      cur.ipSum += c.ipSum;
      cur.ipCount += c.ipCount;
      cur.killFame = cur.killFame === null && c.killFame === null ? null : (cur.killFame ?? 0) + (c.killFame ?? 0);
    }
  }

  const members: MemberStat[] = roster.map((m) => {
    const found = displayByKey.has(m.key);
    const k = kills.get(m.key) ?? 0;
    const d = deaths.get(m.key) ?? 0;
    const loadout = resolveLoadout(found ? weaponsByKey.get(m.key) : undefined);
    const c = found ? combatByKey.get(m.key) : undefined;
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
      weapon: loadout.primary
        ? { type: loadout.primary.type, name: loadout.primary.name, tier: loadout.primary.tier, enchant: loadout.primary.enchant }
        : null,
      role: found ? loadout.role : "unknown",
      otherWeapons: loadout.others,
      damage: Math.round(c?.damage ?? 0),
      healing: Math.round(c?.healing ?? 0),
      avgIp: c && c.ipCount > 0 ? Math.round(c.ipSum / c.ipCount) : null,
      killFame: c?.killFame ?? null,
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
    roleBreakdown: ROLE_ORDER.map((role) => {
      const ms = matched.filter((m) => m.role === role);
      const rk = ms.reduce((a, m) => a + m.kills, 0);
      const rd = ms.reduce((a, m) => a + m.deaths, 0);
      return { role, members: ms.length, kills: rk, deaths: rd, kd: kdValue(rk, rd), kdDisplay: formatKD(rk, rd) };
    }).filter((r) => r.members > 0),
    squadDeaths: squadDeaths.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")),
    friendlyFire: friendlyFire.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")),
    eventsConsidered: seenIds.size,
    duplicateEventsIgnored: duplicates,
  };
}
