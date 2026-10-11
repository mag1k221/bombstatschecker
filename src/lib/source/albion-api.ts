/**
 * Adapter for the official Albion Online game-info API (the same data AlbionBB displays).
 *
 * Verified endpoints (Oct 2026):
 *   GET {base}/battles/{id}                               → battle summary (404 if unknown)
 *   GET {base}/events/battle/{id}?offset={n}&limit={≤51}  → kill events, newest pages by offset
 * Constraints observed: limit must be ≤ 51, offset must be ≤ 1000 (HTTP 400 otherwise),
 * and an unknown battle returns 200 with [] for events.
 */
import { GEAR_SLOTS, type DataIssue, type GearItem, type KillEvent, type PlayerCombat, type PlayerRef, type RegionId, type WeaponUse } from "@/lib/types";
import { isValidItemType } from "@/lib/weapons/catalog";
import { REGIONS } from "./regions";
import type { HttpClient } from "./http";

export const PAGE_SIZE = 51;
export const MAX_OFFSET = 1000;
/** Stop paging after this many consecutive failed pages (source is likely down). */
export const MAX_CONSECUTIVE_FAILURES = 2;

export interface BattleSummary {
  id: number;
  startTime: string | null;
  endTime: string | null;
  totalKills: number | null;
  playerNames: string[];
  /** Kill fame per player name, from the summary. */
  playerFame: Record<string, number>;
}

export type SummaryResult =
  | { kind: "ok"; summary: BattleSummary }
  | { kind: "not_found" }
  | { kind: "error"; error: string };

export interface EventsResult {
  events: KillEvent[];
  playersSeen: string[];
  pagesFetched: number;
  pagesFailed: number;
  capReached: boolean;
  /** True when paging stopped because of failures rather than reaching the end. */
  abortedOnFailures: boolean;
  malformed: number;
  playerWeapons: Record<string, WeaponUse[]>;
  /** Damage/healing/IP per player (killFame is filled in from the summary later). */
  playerCombat: Record<string, PlayerCombat>;
  issues: DataIssue[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function gearOf(r: Record<string, unknown>): GearItem[] {
  const eq = r.Equipment;
  if (!eq || typeof eq !== "object") return [];
  const out: GearItem[] = [];
  for (const slot of GEAR_SLOTS) {
    const it = (eq as Record<string, unknown>)[slot];
    if (!it || typeof it !== "object") continue;
    const t = (it as Record<string, unknown>).Type;
    if (!isValidItemType(t)) continue;
    const q = (it as Record<string, unknown>).Quality;
    out.push({ slot, type: t, quality: typeof q === "number" && q >= 1 && q <= 5 ? Math.round(q) : 1 });
  }
  return out;
}

/** Main-hand item type from an Equipment object, validated against the item-ID format. */
function mainHandOf(r: Record<string, unknown>): string | null {
  const eq = r.Equipment;
  if (!eq || typeof eq !== "object") return null;
  const mh = (eq as Record<string, unknown>).MainHand;
  if (!mh || typeof mh !== "object") return null;
  const t = (mh as Record<string, unknown>).Type;
  return isValidItemType(t) ? t : null;
}

function toPlayer(raw: unknown): PlayerRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.Name);
  if (!name) return null;
  return { id: str(r.Id), name, guildName: str(r.GuildName), allianceName: str(r.AllianceName), weapon: mainHandOf(r) };
}

interface Seen {
  name: string;
  weapon: string | null;
  damage: number;
  healing: number;
  ip: number;
}

function playersOf(list: unknown): Seen[] {
  if (!Array.isArray(list)) return [];
  const out: Seen[] = [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const n = str(r.Name);
    if (n) out.push({ name: n, weapon: mainHandOf(r), damage: num(r.DamageDone), healing: num(r.SupportHealingDone), ip: num(r.AverageItemPower) });
  }
  return out;
}

/** Normalizes one raw event. Returns null if required fields are missing. */
export function normalizeEvent(
  raw: unknown,
): (KillEvent & { groupMembers: Seen[]; participantGear: Seen[]; killerIp: number; victimIp: number }) | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.EventId;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;
  const killer = toPlayer(r.Killer);
  const victim = toPlayer(r.Victim);
  if (!killer || !victim) return null;
  const battleId = typeof r.BattleId === "number" ? r.BattleId : NaN;
  const participantGear = playersOf(r.Participants);
  return {
    id,
    battleId,
    timestamp: str(r.TimeStamp),
    killer,
    victim,
    participants: participantGear.map((p) => p.name),
    participantGear,
    groupMembers: playersOf(r.GroupMembers),
    victimGear: gearOf(r.Victim as Record<string, unknown>),
    victimDeathFame: typeof (r.Victim as Record<string, unknown>).DeathFame === "number" ? ((r.Victim as Record<string, unknown>).DeathFame as number) : null,
    killerIp: num((r.Killer as Record<string, unknown>).AverageItemPower),
    victimIp: num((r.Victim as Record<string, unknown>).AverageItemPower),
  };
}

export async function fetchBattleSummary(
  client: HttpClient,
  region: RegionId,
  battleId: number,
): Promise<SummaryResult> {
  const res = await client.getJson<Record<string, unknown>>(
    `${REGIONS[region].apiBase}/battles/${encodeURIComponent(String(battleId))}`,
  );
  if (!res.ok) {
    if (res.status === 404) return { kind: "not_found" };
    return { kind: "error", error: res.error };
  }
  const d = res.data;
  if (!d || typeof d !== "object" || d.id !== battleId) {
    return { kind: "error", error: "Battle summary was malformed" };
  }
  const players = d.players && typeof d.players === "object" ? Object.values(d.players as object) : [];
  const playerNames: string[] = [];
  const playerFame: Record<string, number> = {};
  for (const p of players) {
    if (!p || typeof p !== "object") continue;
    const n = str((p as Record<string, unknown>).name);
    if (!n) continue;
    playerNames.push(n);
    playerFame[n] = num((p as Record<string, unknown>).killFame);
  }
  return {
    kind: "ok",
    summary: {
      id: battleId,
      startTime: str(d.startTime),
      endTime: str(d.endTime),
      totalKills: typeof d.totalKills === "number" ? d.totalKills : null,
      playerNames,
      playerFame,
    },
  };
}

/** Next offset to request, honoring the API's offset ≤ 1000 limit. Null when no further page is allowed. */
export function nextOffset(offset: number): number | null {
  if (offset >= MAX_OFFSET) return null;
  return Math.min(offset + PAGE_SIZE, MAX_OFFSET);
}

/**
 * Retrieves every page of kill events for a battle, deduplicating by EventId.
 * When the expected kill count is known (from the summary), the expected pages are requested with
 * small bounded concurrency (still spaced by the client's global throttle); results are then processed
 * strictly in offset order with the same rules as sequential paging, and paging continues
 * sequentially if more events exist than expected.
 * Pages overlap when the final page is clamped to offset 1000; dedupe makes that safe.
 */
export async function fetchBattleEvents(
  client: HttpClient,
  region: RegionId,
  battleId: number,
  opts: { expectedKills?: number | null; concurrency?: number } = {},
): Promise<EventsResult> {
  const byId = new Map<number, KillEvent>();
  const seen = new Set<string>();
  const issues: DataIssue[] = [];
  let pagesFetched = 0;
  let pagesFailed = 0;
  let consecutiveFailures = 0;
  let capReached = false;
  let abortedOnFailures = false;
  let malformed = 0;
  let foreign = 0;
  const weapons = new Map<string, Map<string, WeaponUse>>();
  const combat = new Map<string, PlayerCombat>();
  const combatOf = (name: string) => {
    let c = combat.get(name);
    if (!c) combat.set(name, (c = { damage: 0, healing: 0, ipSum: 0, ipCount: 0, killFame: null }));
    return c;
  };

  /** Damage/healing once per participant per distinct event; IP once per player per event (killer/victim first). */
  const recordCombat = (event: KillEvent, participantGear: Seen[], killerIp: number, victimIp: number) => {
    const counted = new Set<string>();
    for (const p of participantGear) {
      if (counted.has(p.name)) continue;
      counted.add(p.name);
      const c = combatOf(p.name);
      c.damage += p.damage;
      c.healing += p.healing;
    }
    const ipSeen = new Map<string, number>();
    const consider = (name: string, ip: number) => {
      if (ip > 0 && !ipSeen.has(name)) ipSeen.set(name, ip);
    };
    consider(event.killer.name, killerIp);
    consider(event.victim.name, victimIp);
    for (const p of participantGear) consider(p.name, p.ip);
    for (const [name, ip] of ipSeen) {
      const c = combatOf(name);
      c.ipSum += ip;
      c.ipCount++;
    }
  };

  /** Records each player's main hand once per distinct event (killer/victim take precedence). */
  const recordWeapons = (event: KillEvent, participantGear: Seen[], groupMembers: Seen[]) => {
    const perEvent = new Map<string, string>();
    const consider = (name: string, weapon: string | null | undefined) => {
      if (weapon && !perEvent.has(name)) perEvent.set(name, weapon);
    };
    consider(event.killer.name, event.killer.weapon);
    consider(event.victim.name, event.victim.weapon);
    for (const p of participantGear) consider(p.name, p.weapon);
    for (const g of groupMembers) consider(g.name, g.weapon);
    for (const [name, type] of perEvent) {
      let m = weapons.get(name);
      if (!m) weapons.set(name, (m = new Map()));
      const u = m.get(type);
      if (!u) m.set(type, { type, count: 1, lastSeen: event.timestamp });
      else {
        u.count++;
        if ((event.timestamp ?? "") > (u.lastSeen ?? "")) u.lastSeen = event.timestamp;
      }
    }
  };

  const pageUrl = (offset: number) =>
    `${REGIONS[region].apiBase}/events/battle/${encodeURIComponent(String(battleId))}?offset=${offset}&limit=${PAGE_SIZE}`;
  const fetchPage = (offset: number) => client.getJson<unknown>(pageUrl(offset));

  /** Applies one page result. Returns "next" to continue, or "stop". */
  const apply = (offset: number, res: Awaited<ReturnType<typeof fetchPage>>): "next" | "stop" => {
    if (!res.ok || !Array.isArray(res.data)) {
      pagesFailed++;
      consecutiveFailures++;
      issues.push({
        kind: "page_failed",
        battleId,
        message: `Events page at offset ${offset} could not be retrieved (${res.ok ? "unexpected response shape" : res.error}).`,
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        abortedOnFailures = true;
        return "stop";
      }
      return "next";
    }
    consecutiveFailures = 0;
    pagesFetched++;
    const page = res.data;
    for (const raw of page) {
      const ev = normalizeEvent(raw);
      if (!ev) {
        malformed++;
        continue;
      }
      if (ev.battleId !== battleId) {
        foreign++;
        continue;
      }
      const { groupMembers, participantGear, killerIp, victimIp, ...event } = ev;
      for (const n of [event.killer.name, event.victim.name, ...event.participants, ...groupMembers.map((g) => g.name)]) seen.add(n);
      if (!byId.has(event.id)) {
        byId.set(event.id, event);
        recordWeapons(event, participantGear, groupMembers);
        recordCombat(event, participantGear, killerIp, victimIp);
      }
    }
    if (page.length < PAGE_SIZE) return "stop"; // reached the end
    if (offset >= MAX_OFFSET) {
      capReached = true; // a full page at the maximum offset: more events may exist
      return "stop";
    }
    return "next";
  };

  // Phase 1: expected pages, fetched concurrently, applied in order.
  let offset: number | null = 0;
  let stopped = false;
  const expected = opts.expectedKills;
  if (typeof expected === "number" && expected > 0) {
    const planned: number[] = [];
    for (let o: number | null = 0; o !== null && o <= expected; o = nextOffset(o)) planned.push(o);
    const results = await mapLimit(planned, opts.concurrency ?? 3, fetchPage);
    for (let i = 0; i < planned.length && !stopped; i++) {
      if (apply(planned[i], results[i]) === "stop") stopped = true;
    }
    offset = stopped ? null : nextOffset(planned[planned.length - 1]);
  }

  // Phase 2: sequential paging until the end, the API cap, or repeated failures.
  while (!stopped && offset !== null) {
    if (apply(offset, await fetchPage(offset)) === "stop") break;
    offset = nextOffset(offset);
  }

  if (capReached) {
    issues.push({
      kind: "pagination_cap",
      battleId,
      message: `The official API only allows paging to offset ${MAX_OFFSET}; events beyond the first ${MAX_OFFSET + PAGE_SIZE} may be missing.`,
    });
  }
  if (abortedOnFailures) {
    issues.push({
      kind: "page_failed",
      battleId,
      message: "Stopped paging after repeated failures; later events may be missing.",
    });
  }
  if (malformed > 0) {
    issues.push({ kind: "page_failed", battleId, message: `${malformed} malformed event record(s) were skipped.` });
  }
  if (foreign > 0) {
    issues.push({ kind: "foreign_event", battleId, message: `${foreign} event(s) belonging to other battles were ignored.` });
  }

  return {
    events: [...byId.values()],
    playersSeen: [...seen],
    pagesFetched,
    pagesFailed,
    capReached,
    abortedOnFailures,
    malformed,
    playerWeapons: Object.fromEntries([...weapons].map(([n, m]) => [n, [...m.values()]])),
    playerCombat: Object.fromEntries(combat),
    issues,
  };
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
