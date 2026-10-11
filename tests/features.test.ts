import { describe, expect, it } from "vitest";
import { fetchBattleEvents, normalizeEvent } from "@/lib/source/albion-api";
import { chunkItems, fetchPrices, selectQuote, type MarketRow } from "@/lib/source/market";
import { TtlCache } from "@/lib/server/ttl-cache";
import { computeRegear, itemsToPrice } from "@/lib/stats/regear";
import { discordSummary, DISCORD_LIMIT } from "@/lib/stats/discord";
import { formatCompact } from "@/lib/stats/format";
import { computeSquadStats } from "@/lib/stats/compute";
import { buildRoster } from "@/lib/stats/roster";
import { parseSavedRosters, upsertRoster, removeRoster, MAX_SAVED_ROSTERS } from "@/lib/saved-rosters";
import type { SquadDeath } from "@/lib/stats/compute";
import type { AnalyzeResponse } from "@/lib/api-types";
import { json, testClient } from "./helpers";

const gear = (mh: string, q = 2) => ({
  MainHand: { Type: mh, Quality: q, Count: 1 },
  Head: { Type: "T6_HEAD_PLATE_SET1", Quality: 1, Count: 1 },
  Mount: { Type: "T5_MOUNT_COUGAR_KEEPER@1", Quality: 1, Count: 1 },
  Potion: { Type: "T6_POTION_HEAL", Quality: 0, Count: 5 },
  Food: null,
});

function ev(id: number, killer: string, victim: string, parts: { Name: string; DamageDone?: number; SupportHealingDone?: number; AverageItemPower?: number }[]) {
  return {
    EventId: id,
    BattleId: 7,
    TimeStamp: "2026-01-01T00:00:00Z",
    Killer: { Name: killer, AverageItemPower: 1300, Equipment: gear("T6_2H_CLAYMORE") },
    Victim: { Name: victim, AverageItemPower: 1200, DeathFame: 50000, Equipment: gear("T6_MAIN_HOLYSTAFF@1", 3) },
    Participants: parts,
    GroupMembers: [],
  };
}

describe("gear & combat extraction", () => {
  it("extracts victim gear without consumables and validates quality", () => {
    const e = normalizeEvent(ev(1, "A", "B", []))!;
    expect(e.victimGear?.map((g) => g.slot)).toEqual(["MainHand", "Head", "Mount"]);
    expect(e.victimGear?.[0]).toEqual({ slot: "MainHand", type: "T6_MAIN_HOLYSTAFF@1", quality: 3 });
    expect(e.victimDeathFame).toBe(50000);
  });

  it("sums damage/healing per distinct event and averages IP", async () => {
    const events = [
      ev(1, "A", "X", [{ Name: "A", DamageDone: 1000, AverageItemPower: 1300 }, { Name: "H", SupportHealingDone: 500, AverageItemPower: 1100 }]),
      ev(2, "A", "Y", [{ Name: "A", DamageDone: 250.5, AverageItemPower: 1300 }]),
    ];
    const fetchImpl = async (url: string) => {
      const u = new URL(url);
      const off = Number(u.searchParams.get("offset"));
      // Return the same events on page 0 and a duplicate of event 1 later: must not double count.
      return json(off === 0 ? [...events, events[0]] : []);
    };
    const res = await fetchBattleEvents(testClient(fetchImpl), "americas", 7, { expectedKills: 2 });
    const a = res.playerCombat["A"] ?? res.playerCombat["a"];
    const h = res.playerCombat["H"] ?? res.playerCombat["h"];
    expect(a.damage).toBeCloseTo(1250.5);
    expect(a.ipSum / a.ipCount).toBe(1300);
    expect(h.healing).toBe(500);
    expect(h.ipSum / h.ipCount).toBe(1100);
  });
});

describe("member stats and squad deaths", () => {
  it("reports combat fields and lost gear for roster deaths", () => {
    const roster = buildRoster(["A", "X"]).members;
    const stats = computeSquadStats(roster, {
      events: [
        {
          id: 1, battleId: 7, timestamp: "2026-01-01T00:00:00Z",
          killer: { id: null, name: "A", guildName: null, allianceName: null },
          victim: { id: null, name: "X", guildName: null, allianceName: null },
          participants: ["A"],
          victimGear: [{ slot: "MainHand", type: "T6_2H_CLAYMORE", quality: 2 }],
          victimDeathFame: 10,
        },
      ],
      playersSeen: ["A", "X"],
      playerCombat: { a: { damage: 900, healing: 0, ipSum: 2600, ipCount: 2, killFame: 1234 } },
    }, { partial: false });
    const a = stats.members.find((m) => m.key === "a")!;
    expect(a.damage).toBe(900);
    expect(a.avgIp).toBe(1300);
    expect(a.killFame).toBe(1234);
    expect(stats.squadDeaths).toHaveLength(1);
    expect(stats.squadDeaths[0].items[0].name).toBe("Claymore");
  });
});

const NOW = Date.parse("2026-01-10T00:00:00Z");
const row = (city: string, quality: number, price: number, date = "2026-01-09T12:00:00"): MarketRow => ({
  item_id: "T6_2H_CLAYMORE", city, quality, sell_price_min: price, sell_price_min_date: date,
});

describe("market price selection", () => {
  it("picks the cheapest exact quality across cities", () => {
    const q = selectQuote([row("Lymhurst", 2, 900), row("Martlock", 2, 700), row("Martlock", 1, 100)], 2, "all", NOW)!;
    expect(q).toMatchObject({ price: 700, quality: 2, city: "Martlock" });
  });
  it("respects a chosen city", () => {
    expect(selectQuote([row("Lymhurst", 2, 900), row("Martlock", 2, 700)], 2, "Lymhurst", NOW)?.price).toBe(900);
  });
  it("ignores zero and stale prices", () => {
    expect(selectQuote([row("Lymhurst", 2, 0), row("Martlock", 2, 5, "2025-01-01T00:00:00"), row("Thetford", 2, 9, "0001-01-01T00:00:00")], 2, "all", NOW)).toBeNull();
  });
  it("falls back to the nearest quality, preferring higher on ties", () => {
    const q = selectQuote([row("Lymhurst", 1, 100), row("Lymhurst", 3, 300)], 2, "all", NOW)!;
    expect(q.quality).toBe(3);
  });
  it("chunks long item lists under the URL limit", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `T8_2H_ITEM_NUMBER_${i}@3`);
    const chunks = chunkItems("https://west.albion-online-data.com/api/v2/stats/prices", ids, "?locations=x&qualities=1,2,3,4,5");
    expect(chunks.flat()).toEqual(ids);
    for (const c of chunks) {
      const url = `https://west.albion-online-data.com/api/v2/stats/prices/${c.map(encodeURIComponent).join(",")}.json?locations=x&qualities=1,2,3,4,5`;
      expect(url.length).toBeLessThanOrEqual(3800);
    }
  });
  it("fetches, caches and quotes", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return json([{ item_id: "T6_2H_CLAYMORE", city: "Caerleon", quality: 2, sell_price_min: 1000, sell_price_min_date: "2026-01-09T00:00:00" }]);
    };
    const cache = new TtlCache<MarketRow[]>(50, () => NOW);
    const deps = { client: testClient(fetchImpl), cache, now: () => NOW };
    const r1 = await fetchPrices("americas", "all", [{ type: "T6_2H_CLAYMORE", quality: 2 }], deps);
    expect(r1.quotes["T6_2H_CLAYMORE#2"].price).toBe(1000);
    expect(calls[0]).toContain("west.albion-online-data.com");
    await fetchPrices("americas", "Caerleon", [{ type: "T6_2H_CLAYMORE", quality: 2 }], deps);
    expect(calls).toHaveLength(1);
  });
});

const death = (key: string, items: [string, string, number][]): SquadDeath => ({
  eventId: Math.random(), battleId: 1, timestamp: null, memberKey: key, victim: key.toUpperCase(), killer: "K", killerGuild: null, deathFame: null,
  items: items.map(([slot, type, quality]) => ({ slot, type, quality, name: type })),
});

describe("regear", () => {
  const deaths = [death("a", [["MainHand", "W", 2], ["Mount", "M", 1]]), death("a", [["MainHand", "W", 2]]), death("b", [["Head", "H", 1]])];
  const quotes = {
    "W#2": { price: 100, quality: 2, city: "Caerleon", observedAt: "" },
    "M#1": { price: 50, quality: 1, city: "Caerleon", observedAt: "" },
  };
  it("dedupes lookups", () => expect(itemsToPrice(deaths)).toHaveLength(3));
  it("totals per death, member and squad, counting missing", () => {
    const t = computeRegear(deaths, quotes);
    expect(t.total).toBe(250);
    expect(t.missing).toBe(1);
    expect(t.members[0]).toMatchObject({ memberKey: "a", deaths: 2, total: 250 });
    expect(t.members[1]).toMatchObject({ memberKey: "b", total: 0, missing: 1 });
  });
  it("can exclude mounts and flags approximate quality", () => {
    const t = computeRegear(deaths, { ...quotes, "W#2": { ...quotes["W#2"], quality: 3 } }, { excludeSlots: new Set(["Mount"]) });
    expect(t.total).toBe(200);
    expect(t.approx).toBe(2);
  });
});

describe("discord summary", () => {
  function data(n: number): Pick<AnalyzeResponse, "summary" | "members" | "source" | "mode"> {
    const members = Array.from({ length: n }, (_, i) => ({
      key: `p${i}`, name: `VeryLongPlayerName${i}`, input: `p${i}`, status: i % 9 === 8 ? ("not_found" as const) : ("matched" as const),
      kills: i % 4, deaths: i % 3, kd: 1, kdDisplay: "1.00", friendlyKills: 0, friendlyDeaths: 0, incomplete: false,
      weapon: null, role: "unknown" as const, otherWeapons: [], damage: i * 1000, healing: 0, avgIp: 1300, killFame: 1000,
    }));
    return {
      mode: "live",
      members,
      summary: { submitted: n, matched: n, notFound: 0, totalKills: 10, totalDeaths: 5, overallKd: 2, overallKdDisplay: "2.00" },
      source: { battles: [{ id: 123 }], regionLabel: "Europe", completeness: "partial" } as AnalyzeResponse["source"],
    };
  }
  it("stays within Discord's limit for big rosters", () => {
    const text = discordSummary(data(300), { regearTotal: 12_500_000, regearLocation: "Caerleon" });
    expect(text.length).toBeLessThanOrEqual(DISCORD_LIMIT);
    expect(text).toContain("K/D 2.00");
    expect(text).toContain("12.5m");
    expect(text).toContain("Partial data");
    expect(text.split("```").length).toBe(3); // code block is closed
  });
  it("formats compact numbers", () => {
    expect([formatCompact(950), formatCompact(12_500), formatCompact(2_740_000), formatCompact(null)]).toEqual(["950", "12.5k", "2.7m", "—"]);
  });
});

describe("saved rosters", () => {
  it("upserts by name, caps the list, and survives bad storage", () => {
    let list = parseSavedRosters("not json");
    expect(list).toEqual([]);
    list = upsertRoster(list, { name: "Main", text: "a\nb", count: 2 });
    list = upsertRoster(list, { name: "main", text: "a\nb\nc", count: 3 });
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(3);
    for (let i = 0; i < 50; i++) list = upsertRoster(list, { name: `R${i}`, text: "x", count: 1 });
    expect(list).toHaveLength(MAX_SAVED_ROSTERS);
    expect(parseSavedRosters(JSON.stringify(list))).toHaveLength(MAX_SAVED_ROSTERS);
    expect(removeRoster(list, "R49")).toHaveLength(MAX_SAVED_ROSTERS - 1);
  });
});

import { buildShareQuery, parseShareQuery, battleParam, urlFromBattleParam } from "@/lib/share";

describe("share links", () => {
  it("round-trips single and multi battles", () => {
    expect(battleParam("https://europe.albionbb.com/battles/441346892")).toBe("eu.441346892");
    expect(urlFromBattleParam("eu.441346892")).toBe("https://europe.albionbb.com/battles/441346892");
    expect(urlFromBattleParam("west.1-2")).toBe("https://albionbb.com/battles/multi?ids=1,2");
    expect(urlFromBattleParam("evil.1")).toBeNull();
    expect(urlFromBattleParam("eu.abc")).toBeNull();
  });
  it("round-trips short rosters as plain text", async () => {
    const members = ["Ashwick", "Brannoc", "Mr. O'Neil", "Ünïcode"];
    const q = await buildShareQuery({ url: "https://albionbb.com/battles/1407921257", members });
    expect(q).toContain("m=");
    expect(await parseShareQuery(`?${q}`)).toEqual({ url: "https://albionbb.com/battles/1407921257", members });
  });
  it("compresses long rosters", async () => {
    const members = Array.from({ length: 300 }, (_, i) => `SquadMember${i}`);
    const q = await buildShareQuery({ url: "https://east.albionbb.com/battles/5", members });
    expect(q).toContain("z=");
    expect((await parseShareQuery(q))?.members).toEqual(members);
  });
  it("ignores unrelated or broken queries", async () => {
    expect(await parseShareQuery("?utm=x")).toBeNull();
    expect((await parseShareQuery("?b=eu.1&z=!!!"))?.members).toEqual([]);
  });
});

describe("discord share link", () => {
  it("includes a short share link and drops a huge one", () => {
    const base = {
      mode: "live" as const, members: [],
      summary: { submitted: 0, matched: 0, notFound: 0, totalKills: 0, totalDeaths: 0, overallKd: null, overallKdDisplay: "—" },
      source: { battles: [{ id: 1 }], regionLabel: "Europe", completeness: "complete" } as AnalyzeResponse["source"],
    };
    expect(discordSummary(base, { shareUrl: "https://x.app/?b=eu.1&m=A" })).toContain("<https://x.app/?b=eu.1&m=A>");
    expect(discordSummary(base, { shareUrl: "https://x.app/?" + "a".repeat(1200) })).not.toContain("Full results");
  });
});

describe("guild contribution", () => {
  const ev = (id: number, k: [string, string, string | null], v: [string, string, string | null]) => ({
    id, battleId: 1, timestamp: null, participants: [],
    killer: { id: null, name: k[0], guildName: k[1], allianceName: k[2] },
    victim: { id: null, name: v[0], guildName: v[1], allianceName: v[2] },
  });
  it("computes squad share of guild and alliance kills", () => {
    const roster = buildRoster(["A", "B"]).members;
    const events = [
      ev(1, ["A", "G1", "AL"], ["X", "E", null]),
      ev(2, ["A", "G1", "AL"], ["Y", "E", null]),
      ev(3, ["C", "G1", "AL"], ["Z", "E", null]),
      ev(4, ["D", "G2", "AL"], ["W", "E", null]),
      ev(5, ["X2", "E", null], ["B", "G1", "AL"]),
      ev(6, ["X3", "E", null], ["C", "G1", "AL"]),
    ];
    const s = computeSquadStats(roster, { events, playersSeen: ["A", "B"] }, { partial: false });
    const g = s.groupShares.find((x) => x.kind === "guild" && x.name === "G1")!;
    expect(g).toMatchObject({ squadKills: 2, totalKills: 3, squadDeaths: 1, totalDeaths: 2, squadMembers: 2, alliance: "AL" });
    expect(g.killShare).toBeCloseTo(2 / 3);
    expect(g.topKillers).toEqual([{ name: "A", kills: 2 }]);
    const al = s.groupShares.find((x) => x.kind === "alliance")!;
    expect(al).toMatchObject({ squadKills: 2, totalKills: 4 });
    expect(s.groupShares[0].kind).toBe("guild");
    expect(s.groupShares.some((x) => x.name === "E")).toBe(false); // enemy guild has no squad members
  });
});
