/**
 * Builds a BattleDataset for a parsed AlbionBB link by querying the official API for every battle in it.
 * This module owns retrieval, caching and completeness assessment — not statistics.
 */
import type { BattleDataset, BattleMeta, DataIssue, KillEvent, PlayerCombat, RegionId, WeaponUse } from "@/lib/types";
import { TtlCache } from "@/lib/server/ttl-cache";
import { fetchBattleEvents, fetchBattleSummary, mapLimit } from "./albion-api";
import { HttpClient } from "./http";
import type { ParsedBattleLink } from "./url";

export interface BattleRecord {
  meta: BattleMeta;
  events: KillEvent[];
  playersSeen: string[];
  playerWeapons: Record<string, WeaponUse[]>;
  playerCombat: Record<string, PlayerCombat>;
  issues: DataIssue[];
  retrievedAt: string;
  notFound: boolean;
}

export interface LoadResult {
  dataset: BattleDataset;
  retrievedAt: string;
  /** True if every battle was served from cache. */
  fromCache: boolean;
  notFoundBattleIds: number[];
}

export interface LoadOptions {
  refresh?: boolean;
  client?: HttpClient;
  cache?: TtlCache<BattleRecord>;
  completeTtlMs?: number;
  partialTtlMs?: number;
  battleConcurrency?: number;
}

const env = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined);

let sharedClient: HttpClient | null = null;
export function getSharedClient(): HttpClient {
  if (!sharedClient) {
    const contact = env("ALBION_API_CONTACT");
    sharedClient = new HttpClient({
      minIntervalMs: Number(env("ALBION_API_MIN_INTERVAL_MS") ?? 200) || 200,
      userAgent: `BoomsquadTracker/1.0${contact ? ` (+${contact})` : ""}`,
    });
  }
  return sharedClient;
}

export const sharedBattleCache = new TtlCache<BattleRecord>(200);

export async function loadBattle(
  client: HttpClient,
  region: RegionId,
  battleId: number,
): Promise<BattleRecord> {
  // Summary first: it tells us whether the battle exists and how many kills to expect.
  const summary = await fetchBattleSummary(client, region, battleId);
  const retrievedAt = new Date().toISOString();

  if (summary.kind === "not_found") {
    return {
      meta: emptyMeta(battleId, "failed"),
      events: [],
      playersSeen: [],
      playerWeapons: {},
      playerCombat: {},
      issues: [{ kind: "battle_failed", battleId, message: `Battle ${battleId} was not found on this server.` }],
      retrievedAt,
      notFound: true,
    };
  }

  const ev = await fetchBattleEvents(client, region, battleId, {
    expectedKills: summary.kind === "ok" ? summary.summary.totalKills : null,
  });
  const issues: DataIssue[] = [...ev.issues];
  const reportedKills = summary.kind === "ok" ? summary.summary.totalKills : null;

  if (summary.kind === "error") {
    issues.unshift({
      kind: "summary_failed",
      battleId,
      message: `Battle summary unavailable (${summary.error}); the expected kill count could not be verified.`,
    });
  }
  if (reportedKills !== null && ev.events.length < reportedKills) {
    issues.push({
      kind: "count_mismatch",
      battleId,
      message: `The battle summary reports ${reportedKills} kills, but only ${ev.events.length} kill events were retrievable from the official API.`,
    });
  }

  const nothingRetrieved = summary.kind === "error" && ev.pagesFetched === 0;
  const partial =
    summary.kind === "error" ||
    ev.pagesFailed > 0 ||
    ev.capReached ||
    ev.malformed > 0 ||
    (reportedKills !== null && ev.events.length < reportedKills);

  const seen = new Set<string>(ev.playersSeen);
  if (summary.kind === "ok") for (const n of summary.summary.playerNames) seen.add(n);

  // Kill fame comes from the summary; damage/healing/IP from events.
  const playerCombat: Record<string, PlayerCombat> = {};
  for (const [n, c] of Object.entries(ev.playerCombat)) playerCombat[n] = { ...c };
  if (summary.kind === "ok") {
    for (const [n, fame] of Object.entries(summary.summary.playerFame)) {
      playerCombat[n] = { ...(playerCombat[n] ?? { damage: 0, healing: 0, ipSum: 0, ipCount: 0, killFame: null }), killFame: fame };
    }
  }

  if (nothingRetrieved) {
    issues.push({ kind: "battle_failed", battleId, message: `No data could be retrieved for battle ${battleId}.` });
  }

  return {
    meta: {
      id: battleId,
      startTime: summary.kind === "ok" ? summary.summary.startTime : ev.events[0]?.timestamp ?? null,
      endTime: summary.kind === "ok" ? summary.summary.endTime : null,
      reportedKills,
      retrievedEvents: ev.events.length,
      playerCount: summary.kind === "ok" ? summary.summary.playerNames.length : null,
      pagesFetched: ev.pagesFetched,
      pagesFailed: ev.pagesFailed,
      status: nothingRetrieved ? "failed" : partial ? "partial" : "complete",
    },
    events: ev.events,
    playersSeen: [...seen],
    playerWeapons: ev.playerWeapons,
    playerCombat,
    issues,
    retrievedAt,
    notFound: false,
  };
}

function emptyMeta(id: number, status: BattleMeta["status"]): BattleMeta {
  return {
    id,
    startTime: null,
    endTime: null,
    reportedKills: null,
    retrievedEvents: 0,
    playerCount: null,
    pagesFetched: 0,
    pagesFailed: 0,
    status,
  };
}

export async function loadDataset(link: ParsedBattleLink, opts: LoadOptions = {}): Promise<LoadResult> {
  const client = opts.client ?? getSharedClient();
  const cache = opts.cache ?? sharedBattleCache;
  const completeTtl = opts.completeTtlMs ?? (Number(env("BATTLE_CACHE_TTL_SECONDS") ?? 600) || 600) * 1000;
  const partialTtl = opts.partialTtlMs ?? 60_000;

  let allCached = true;
  const records = await mapLimit(link.battleIds, opts.battleConcurrency ?? 2, async (id) => {
    const key = `${link.region}:${id}`;
    if (!opts.refresh) {
      const hit = cache.get(key);
      if (hit) return hit;
    }
    allCached = false;
    const rec = await loadBattle(client, link.region, id);
    if (rec.notFound || rec.meta.status === "failed") cache.delete(key);
    else cache.set(key, rec, rec.meta.status === "complete" ? completeTtl : partialTtl);
    return rec;
  });

  return {
    dataset: mergeRecords(records),
    retrievedAt: records.map((r) => r.retrievedAt).sort()[0] ?? new Date().toISOString(),
    fromCache: allCached,
    notFoundBattleIds: records.filter((r) => r.notFound).map((r) => r.meta.id),
  };
}

/** Merges per-battle records; events are deduplicated by their stable EventId across battles. */
export function mergeRecords(records: BattleRecord[]): BattleDataset {
  const events = new Map<number, KillEvent>();
  const seen = new Set<string>();
  const issues: DataIssue[] = [];
  const weapons = new Map<string, Map<string, WeaponUse>>();
  const combat = new Map<string, PlayerCombat>();
  for (const r of records) {
    for (const [name, c] of Object.entries(r.playerCombat ?? {})) {
      const cur = combat.get(name);
      if (!cur) combat.set(name, { ...c });
      else {
        cur.damage += c.damage;
        cur.healing += c.healing;
        cur.ipSum += c.ipSum;
        cur.ipCount += c.ipCount;
        cur.killFame = cur.killFame === null && c.killFame === null ? null : (cur.killFame ?? 0) + (c.killFame ?? 0);
      }
    }
    for (const e of r.events) if (!events.has(e.id)) events.set(e.id, e);
    for (const n of r.playersSeen) seen.add(n);
    issues.push(...r.issues);
    for (const [name, uses] of Object.entries(r.playerWeapons ?? {})) {
      let m = weapons.get(name);
      if (!m) weapons.set(name, (m = new Map()));
      for (const u of uses) {
        const cur = m.get(u.type);
        if (!cur) m.set(u.type, { ...u });
        else {
          cur.count += u.count;
          if ((u.lastSeen ?? "") > (cur.lastSeen ?? "")) cur.lastSeen = u.lastSeen;
        }
      }
    }
  }
  return {
    battles: records.map((r) => r.meta),
    events: [...events.values()],
    playersSeen: [...seen],
    playerWeapons: Object.fromEntries([...weapons].map(([n, m]) => [n, [...m.values()]])),
    playerCombat: Object.fromEntries(combat),
    issues,
  };
}
