import type { KillEvent } from "@/lib/types";
import { HttpClient, type FetchLike } from "@/lib/source/http";

export function kill(id: number, killer: string, victim: string, battleId = 42, participants: string[] = []): KillEvent {
  return {
    id,
    battleId,
    timestamp: `2026-01-01T00:00:${String(id % 60).padStart(2, "0")}Z`,
    killer: { id: null, name: killer, guildName: null, allianceName: null },
    victim: { id: null, name: victim, guildName: null, allianceName: null },
    participants,
  };
}

/** Raw official-API-shaped event. */
export function rawEvent(id: number, killer: string, victim: string, battleId = 42) {
  return {
    EventId: id,
    BattleId: battleId,
    TimeStamp: "2026-01-01T00:00:00Z",
    Type: "KILL",
    Killer: { Name: killer, Id: `k${id}`, GuildName: "G" },
    Victim: { Name: victim, Id: `v${id}`, GuildName: "H" },
    Participants: [{ Name: killer }],
    GroupMembers: [{ Name: killer }],
  };
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function testClient(fetchImpl: FetchLike, retries = 0) {
  return new HttpClient({ fetchImpl, retries, minIntervalMs: 0, sleep: async () => undefined });
}

/** Simulated official API for one battle with `total` events. */
export function fakeApi(opts: {
  battleId: number;
  total: number;
  reportedKills?: number;
  failOffsets?: Set<number>;
  summaryStatus?: number;
  names?: (i: number) => [string, string];
}) {
  const calls: string[] = [];
  const names = opts.names ?? ((i: number) => [`Killer${i % 7}`, `Victim${i % 5}`]);
  const all = Array.from({ length: opts.total }, (_, i) => rawEvent(1000 + i, ...names(i), opts.battleId));
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith(`/battles/${opts.battleId}`)) {
      if (opts.summaryStatus && opts.summaryStatus !== 200) return json({}, opts.summaryStatus);
      return json({
        id: opts.battleId,
        startTime: "2026-01-01T00:00:00Z",
        endTime: "2026-01-01T00:30:00Z",
        totalKills: opts.reportedKills ?? opts.total,
        players: { a: { name: "Killer0" }, b: { name: "Bystander" } },
      });
    }
    if (u.pathname.endsWith(`/events/battle/${opts.battleId}`)) {
      const offset = Number(u.searchParams.get("offset"));
      const limit = Number(u.searchParams.get("limit"));
      if (limit > 51) return json({ errors: ["limit"] }, 400);
      if (offset > 1000) return json({ errors: ["offset"] }, 400);
      if (opts.failOffsets?.has(offset)) return json({ error: "boom" }, 503);
      return json(all.slice(offset, offset + limit));
    }
    return json({}, 404);
  };
  return { fetchImpl, calls };
}
