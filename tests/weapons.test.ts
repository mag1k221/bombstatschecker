import { describe, expect, it } from "vitest";
import { fetchBattleEvents } from "@/lib/source/albion-api";
import { computeSquadStats } from "@/lib/stats/compute";
import { buildRoster } from "@/lib/stats/roster";
import { isValidItemType, weaponInfo } from "@/lib/weapons/catalog";
import { resolveLoadout } from "@/lib/weapons/loadout";
import { roleForWeapon } from "@/lib/weapons/roles";
import { json, kill, testClient } from "./helpers";

describe("weapon catalog & roles", () => {
  it("parses item types and resolves official names", () => {
    expect(weaponInfo("T6_2H_KNUCKLES_SET2@3")).toMatchObject({ base: "2H_KNUCKLES_SET2", name: "Battle Bracers", line: "knuckles", tier: 6, enchant: 3 });
    expect(weaponInfo("T8_MAIN_MACE")).toMatchObject({ name: "Mace", enchant: 0 });
    expect(weaponInfo("T5_2H_SHAPESHIFTER_SET2@1")?.name).toBe("Rootbound Staff");
    expect(isValidItemType("<img src=x>")).toBe(false);
    expect(isValidItemType("T4_2H_NEWTHING@1")).toBe(true);
    expect(weaponInfo("T4_2H_NEWTHING@1")).toMatchObject({ name: "Newthing", line: null });
  });

  it("maps weapons to roles with per-weapon overrides", () => {
    expect(roleForWeapon("MAIN_MACE", "mace")).toBe("tank");
    expect(roleForWeapon("2H_HOLYSTAFF_HELL", "holystaff")).toBe("healer");
    expect(roleForWeapon("2H_ENIGMATICSTAFF", "arcanestaff")).toBe("support");
    expect(roleForWeapon("2H_TWINSCYTHE_HELL", "quarterstaff")).toBe("melee");
    expect(roleForWeapon("2H_IRONCLADEDSTAFF", "quarterstaff")).toBe("tank");
    expect(roleForWeapon("2H_BOW_AVALON", "bow")).toBe("ranged");
    expect(roleForWeapon("2H_NEWTHING", null)).toBe("unknown");
    expect(roleForWeapon(null, null)).toBe("unknown");
  });

  it("picks the most-used weapon, grouping tiers/enchants, ties broken by recency", () => {
    const l = resolveLoadout([
      { type: "T6_2H_BOW_AVALON@1", count: 2, lastSeen: "2026-01-01T00:01:00Z" },
      { type: "T7_2H_BOW_AVALON", count: 2, lastSeen: "2026-01-01T00:02:00Z" },
      { type: "T8_MAIN_HOLYSTAFF", count: 3, lastSeen: "2026-01-01T00:09:00Z" },
    ]);
    expect(l.primary?.name).toBe("Mistpiercer"); // 4 sightings vs 3
    expect(l.primary?.type).toBe("T7_2H_BOW_AVALON"); // most recent of the tied variants
    expect(l.role).toBe("ranged");
    expect(l.others).toEqual(["Holy Staff"]);
    expect(resolveLoadout([])).toMatchObject({ primary: null, role: "unknown" });
  });
});

describe("weapon extraction from events", () => {
  it("records each player's main hand once per distinct event, from killer, victim, participants and group", async () => {
    const ev = (id: number, killerWeapon: string) => ({
      EventId: id, BattleId: 42, TimeStamp: `2026-01-01T00:00:0${id}Z`,
      Killer: { Name: "Ash", Equipment: { MainHand: { Type: killerWeapon } } },
      Victim: { Name: "Foe", Equipment: { MainHand: { Type: "T6_MAIN_SWORD" } } },
      Participants: [{ Name: "Ash", Equipment: { MainHand: { Type: killerWeapon } } }, { Name: "Healer", Equipment: { MainHand: { Type: "T8_MAIN_HOLYSTAFF@1" } } }],
      GroupMembers: [{ Name: "Ash", Equipment: { MainHand: { Type: killerWeapon } } }, { Name: "Tank", Equipment: { MainHand: { Type: "<script>" } } }],
    });
    const page = [ev(1, "T8_2H_DUALSCIMITAR_UNDEAD@1"), ev(1, "T8_2H_DUALSCIMITAR_UNDEAD@1"), ev(2, "T8_2H_DUALSCIMITAR_UNDEAD@1"), ev(3, "T7_2H_CLAYMORE")];
    const r = await fetchBattleEvents(testClient(async () => json(page)), "americas", 42);
    expect(r.playerWeapons.Ash).toEqual([
      { type: "T8_2H_DUALSCIMITAR_UNDEAD@1", count: 2, lastSeen: "2026-01-01T00:00:02Z" },
      { type: "T7_2H_CLAYMORE", count: 1, lastSeen: "2026-01-01T00:00:03Z" },
    ]);
    expect(r.playerWeapons.Healer[0].count).toBe(3);
    expect(r.playerWeapons.Tank).toBeUndefined(); // invalid item IDs are dropped

    const s = computeSquadStats(buildRoster(["ash", "healer", "tank"]).members, { events: r.events, playersSeen: r.playersSeen, playerWeapons: r.playerWeapons }, { partial: false });
    expect(s.members[0]).toMatchObject({ role: "melee", weapon: { name: "Galatine Pair", tier: 8, enchant: 1 }, otherWeapons: ["Claymore"], kills: 3 });
    expect(s.members[1]).toMatchObject({ role: "healer", kills: 0 });
    expect(s.members[2]).toMatchObject({ status: "matched", role: "unknown", weapon: null });
    expect(s.roleBreakdown.map((x) => [x.role, x.members, x.kills])).toEqual([["healer", 1, 0], ["melee", 1, 3], ["unknown", 1, 0]]);
  });

  it("role breakdown K/D is a ratio of sums per role", () => {
    const weapons = { A: [{ type: "T8_MAIN_MACE", count: 1, lastSeen: null }], B: [{ type: "T8_2H_HAMMER", count: 1, lastSeen: null }] };
    const events = [kill(1, "A", "X"), kill(2, "A", "X"), kill(3, "A", "X"), kill(4, "Y", "B"), kill(5, "Y", "B"), kill(6, "Y", "A")];
    const s = computeSquadStats(buildRoster(["A", "B"]).members, { events, playersSeen: [], playerWeapons: weapons }, { partial: false });
    expect(s.roleBreakdown).toEqual([{ role: "tank", members: 2, kills: 3, deaths: 3, kd: 1, kdDisplay: "1.00" }]);
  });
});
