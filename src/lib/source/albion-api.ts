/**
 * Adapter for the official Albion Online game-info API (the same data AlbionBB displays).
 *
 * Verified endpoints (Oct 2026):
 *   GET {base}/battles/{id}                               → battle summary (404 if unknown)
 *   GET {base}/events/battle/{id}?offset={n}&limit={≤51}  → kill events, newest pages by offset
 * Constraints observed: limit must be ≤ 51, offset must be ≤ 1000 (HTTP 400 otherwise),
 * and an unknown battle returns 200 with [] for events.
 */
import type { DataIssue, KillEvent, PlayerRef, RegionId } from "@/lib/types";
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
  issues: DataIssue[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function toPlayer(raw: unknown): PlayerRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.Name);
  if (!name) return null;
  return { id: str(r.Id), name, guildName: str(r.GuildName), allianceName: str(r.AllianceName) };
}

function namesOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const p of list) {
    const n = p && typeof p === "object" ? str((p as Record<string, unknown>).Name) : null;
    if (n) out.push(n);
  }
  return out;
}

/** Normalizes one raw event. Returns null if required fields are missing. */
export function normalizeEvent(raw: unknown): (KillEvent & { groupMembers: string[] }) | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.EventId;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;
  const killer = toPlayer(r.Killer);
  const victim = toPlayer(r.Victim);
  if (!killer || !victim) return null;
  const battleId = typeof r.BattleId === "number" ? r.BattleId : NaN;
  return {
    id,
    battleId,
    timestamp: str(r.TimeStamp),
    killer,
    victim,
    participants: namesOf(r.Participants),
    groupMembers: namesOf(r.GroupMembers),
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
  const playerNames = players
    .map((p) => (p && typeof p === "object" ? str((p as Record<string, unknown>).name) : null))
    .filter((n): n is string => n !== null);
  return {
    kind: "ok",
    summary: {
      id: battleId,
      startTime: str(d.startTime),
      endTime: str(d.endTime),
      totalKills: typeof d.totalKills === "number" ? d.totalKills : null,
      playerNames,
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
      const { groupMembers, ...event } = ev;
      for (const n of [event.killer.name, event.victim.name, ...event.participants, ...groupMembers]) seen.add(n);
      if (!byId.has(event.id)) byId.set(event.id, event);
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
