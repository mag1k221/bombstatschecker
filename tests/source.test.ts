import { describe, expect, it } from "vitest";
import { fetchBattleEvents, MAX_OFFSET, nextOffset, PAGE_SIZE } from "@/lib/source/albion-api";
import { loadDataset, mergeRecords, type BattleRecord } from "@/lib/source/albion-source";
import { parseAlbionBBLink } from "@/lib/source/url";
import { HttpClient } from "@/lib/source/http";
import { TtlCache } from "@/lib/server/ttl-cache";
import { analyze } from "@/lib/server/analyze";
import { fakeApi, json, kill, testClient } from "./helpers";

const link = (id: number) => parseAlbionBBLink(`https://albionbb.com/battles/${id}`);

describe("pagination", () => {
  it("retrieves every page until a short page", async () => {
    const api = fakeApi({ battleId: 42, total: 130 });
    const r = await fetchBattleEvents(testClient(api.fetchImpl), "americas", 42);
    expect(r.events).toHaveLength(130);
    expect(r.pagesFetched).toBe(3); // 51 + 51 + 28
    expect(r.capReached).toBe(false);
    expect(api.calls.every((c) => c.includes("limit=51"))).toBe(true);
  });

  it("fetches one extra empty page when the total is an exact multiple of the page size", async () => {
    const api = fakeApi({ battleId: 42, total: 102 });
    const r = await fetchBattleEvents(testClient(api.fetchImpl), "americas", 42);
    expect(r.events).toHaveLength(102);
    expect(r.pagesFetched).toBe(3);
  });

  it("clamps the last page to offset 1000, dedupes the overlap, and flags the API cap", async () => {
    expect(nextOffset(969)).toBe(MAX_OFFSET);
    expect(nextOffset(MAX_OFFSET)).toBeNull();
    const api = fakeApi({ battleId: 42, total: 1200 });
    const r = await fetchBattleEvents(testClient(api.fetchImpl), "americas", 42);
    expect(r.events).toHaveLength(MAX_OFFSET + PAGE_SIZE); // 1051 unique despite overlapping pages
    expect(r.capReached).toBe(true);
    expect(r.issues.some((i) => i.kind === "pagination_cap")).toBe(true);
    expect(api.calls.some((c) => /offset=1020/.test(c))).toBe(false);
  });

  it("deduplicates events repeated across pages (e.g. shifting results)", async () => {
    let n = 0;
    const page1 = Array.from({ length: 51 }, (_, i) => ({ EventId: i + 1, BattleId: 42, Killer: { Name: "A" }, Victim: { Name: "B" } }));
    const page2 = [...page1.slice(40), { EventId: 99, BattleId: 42, Killer: { Name: "A" }, Victim: { Name: "B" } }];
    const client = testClient(async () => json(n++ === 0 ? page1 : page2));
    const r = await fetchBattleEvents(client, "americas", 42);
    expect(r.events).toHaveLength(52);
  });

  it("skips malformed records and events from other battles", async () => {
    const client = testClient(async () => json([{ EventId: 1 }, { EventId: 2, BattleId: 7, Killer: { Name: "A" }, Victim: { Name: "B" } }, "x"]));
    const r = await fetchBattleEvents(client, "americas", 42);
    expect(r.events).toHaveLength(0);
    expect(r.malformed).toBe(2);
    expect(r.issues.map((i) => i.kind)).toContain("foreign_event");
  });
});

describe("partial retrieval failures", () => {
  it("continues past a failed page and marks the battle partial", async () => {
    const api = fakeApi({ battleId: 42, total: 130, failOffsets: new Set([51]) });
    const res = await loadDataset(link(42), { client: testClient(api.fetchImpl), cache: new TtlCache() });
    const b = res.dataset.battles[0];
    expect(b.status).toBe("partial");
    expect(b.pagesFailed).toBe(1);
    expect(res.dataset.events).toHaveLength(79);
    expect(res.dataset.issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["page_failed", "count_mismatch"]));
  });

  it("stops after repeated consecutive failures", async () => {
    const api = fakeApi({ battleId: 42, total: 300, failOffsets: new Set([51, 102]) });
    const r = await fetchBattleEvents(testClient(api.fetchImpl), "americas", 42);
    expect(r.abortedOnFailures).toBe(true);
    expect(r.events).toHaveLength(51);
  });

  it("marks partial when the summary reports more kills than retrievable events", async () => {
    const api = fakeApi({ battleId: 42, total: 20, reportedKills: 23 });
    const res = await loadDataset(link(42), { client: testClient(api.fetchImpl), cache: new TtlCache() });
    expect(res.dataset.battles[0].status).toBe("partial");
  });

  it("marks partial when the summary is unavailable but events load", async () => {
    const api = fakeApi({ battleId: 42, total: 10, summaryStatus: 503 });
    const res = await loadDataset(link(42), { client: testClient(api.fetchImpl), cache: new TtlCache() });
    expect(res.dataset.battles[0].status).toBe("partial");
    expect(res.dataset.events).toHaveLength(10);
  });

  it("reports partial for a multi-battle link where one battle fails", async () => {
    const good = fakeApi({ battleId: 1, total: 5 });
    const client = testClient(async (url) => (/\/(battles|battle)\/2(\?|$)/.test(url) ? json({}, 503) : good.fetchImpl(url)));
    const res = await loadDataset(parseAlbionBBLink("https://albionbb.com/battles/multi?ids=1,2"), { client, cache: new TtlCache() });
    expect(res.dataset.battles.map((b) => b.status)).toEqual(["complete", "failed"]);
    const out = await analyze(
      { url: "https://albionbb.com/battles/multi?ids=1,2", members: ["Killer0"] },
      { client, cache: new TtlCache() },
    );
    expect(out.ok && out.body.source.completeness).toBe("partial");
  });

  it("returns a clear not-found error for unknown battles", async () => {
    const api = fakeApi({ battleId: 42, total: 0 });
    const out = await analyze({ url: "https://albionbb.com/battles/43", members: ["A"] }, { client: testClient(api.fetchImpl), cache: new TtlCache() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.body.code).toBe("not_found");
  });

  it("never fabricates data when the upstream is down", async () => {
    const out = await analyze({ url: "https://albionbb.com/battles/42", members: ["A"] }, { client: testClient(async () => json({}, 503)), cache: new TtlCache() });
    expect(out).toMatchObject({ ok: false, status: 502 });
  });
});

describe("http safety and caching", () => {
  it("refuses non-allow-listed hosts and redirects", async () => {
    let called = 0;
    const client = testClient(async () => {
      called++;
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    });
    expect(await client.getJson("https://169.254.169.254/latest")).toMatchObject({ ok: false, error: "Upstream host not allowed" });
    expect(called).toBe(0);
    expect(await client.getJson("https://gameinfo.albiononline.com/api/gameinfo/battles/1")).toMatchObject({ ok: false, status: 302 });
  });

  it("retries 5xx then succeeds", async () => {
    let n = 0;
    const client = new HttpClient({ retries: 2, minIntervalMs: 0, sleep: async () => undefined, fetchImpl: async () => (n++ < 2 ? json({}, 503) : json([1])) });
    expect(await client.getJson("https://gameinfo.albiononline.com/api/gameinfo/x")).toMatchObject({ ok: true, data: [1] });
  });

  it("serves from cache and bypasses it on refresh", async () => {
    const api = fakeApi({ battleId: 42, total: 3 });
    const cache = new TtlCache<BattleRecord>();
    const client = testClient(api.fetchImpl);
    await loadDataset(link(42), { client, cache });
    const callsAfterFirst = api.calls.length;
    const second = await loadDataset(link(42), { client, cache });
    expect(second.fromCache).toBe(true);
    expect(api.calls.length).toBe(callsAfterFirst);
    const third = await loadDataset(link(42), { client, cache, refresh: true });
    expect(third.fromCache).toBe(false);
    expect(api.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("dedupes events across merged battles", () => {
    const rec = (id: number, events = [kill(1, "A", "B", id)]): BattleRecord => ({
      meta: { id, startTime: null, endTime: null, reportedKills: 1, retrievedEvents: 1, playerCount: 2, pagesFetched: 1, pagesFailed: 0, status: "complete" },
      events, playersSeen: ["A", "B"], playerWeapons: {}, playerCombat: {}, issues: [], retrievedAt: "", notFound: false,
    });
    expect(mergeRecords([rec(1), rec(1)]).events).toHaveLength(1);
  });
});

describe("analyze end-to-end", () => {
  it("produces summary, member stats and completeness from a paginated source", async () => {
    const api = fakeApi({ battleId: 42, total: 60, names: (i) => (i < 50 ? ["Ash", `Foe${i}`] : [`Foe${i}`, "Bran"]) });
    const out = await analyze(
      { url: "https://albionbb.com/battles/42", members: ["ash", "ASH", "Bran", "Nobody"] },
      { client: testClient(api.fetchImpl), cache: new TtlCache() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.body.mode).toBe("live");
    expect(out.body.source.completeness).toBe("complete");
    expect(out.body.roster.duplicatesRemoved).toEqual(["ASH"]);
    expect(out.body.summary).toMatchObject({ submitted: 3, matched: 2, totalKills: 50, totalDeaths: 10, overallKdDisplay: "5.00" });
    expect(out.body.members.find((m) => m.input === "Nobody")?.status).toBe("not_found");
  });

  it("only uses demo data when explicitly requested, and labels it", async () => {
    const out = await analyze({ demo: true, members: ["Ashwick"] });
    expect(out.ok && out.body.mode).toBe("demo");
    const bad = await analyze({ members: ["Ashwick"] });
    expect(bad.ok).toBe(false);
  });
});

describe("concurrent planned paging", () => {
  it("prefetches expected pages and still gets everything when there are more events than reported", async () => {
    const api = fakeApi({ battleId: 42, total: 200, reportedKills: 60 });
    const r = await fetchBattleEvents(testClient(api.fetchImpl), "americas", 42, { expectedKills: 60 });
    expect(r.events).toHaveLength(200);
    expect(r.pagesFetched).toBe(4);
  });

  it("applies failures in order with planned pages", async () => {
    const api = fakeApi({ battleId: 42, total: 300, failOffsets: new Set([51, 102]) });
    const r = await fetchBattleEvents(testClient(api.fetchImpl), "americas", 42, { expectedKills: 300 });
    expect(r.abortedOnFailures).toBe(true);
    expect(r.events).toHaveLength(51);
  });

  it("handles the API offset cap with planned pages", async () => {
    const api = fakeApi({ battleId: 42, total: 1500 });
    const r = await fetchBattleEvents(testClient(api.fetchImpl), "americas", 42, { expectedKills: 1500 });
    expect(r.events).toHaveLength(1051);
    expect(r.capReached).toBe(true);
  });
});
