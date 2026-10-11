import { describe, expect, it } from "vitest";
import { computeSquadStats } from "@/lib/stats/compute";
import { formatKD, kdValue } from "@/lib/stats/kd";
import { buildRoster } from "@/lib/stats/roster";
import { csvCell, membersToCsv } from "@/lib/stats/csv";
import { kill } from "./helpers";

const roster = (...names: string[]) => buildRoster(names).members;

describe("K/D formatting", () => {
  it("handles zero-death and zero-activity cases", () => {
    expect(formatKD(3, 0)).toBe("∞");
    expect(kdValue(3, 0)).toBe(Infinity);
    expect(formatKD(0, 0)).toBe("—");
    expect(kdValue(0, 0)).toBeNull();
    expect(formatKD(0, 2)).toBe("0.00");
    expect(formatKD(2, 3)).toBe("0.67");
  });
});

describe("computeSquadStats", () => {
  it("matches nicknames case-insensitively and preserves source capitalization", () => {
    const s = computeSquadStats(roster("ashwick", "BRANNOC"), { events: [kill(1, "Ashwick", "BranNoc")], playersSeen: [] }, { partial: false });
    expect(s.members[0]).toMatchObject({ name: "Ashwick", input: "ashwick", status: "matched", kills: 1, deaths: 0, kdDisplay: "∞" });
    expect(s.members[1]).toMatchObject({ name: "BranNoc", status: "matched", kills: 0, deaths: 1, kdDisplay: "0.00" });
  });

  it("does not fuzzy-match similar names", () => {
    const s = computeSquadStats(roster("Ashwik"), { events: [kill(1, "Ashwick", "X")], playersSeen: ["Ashwick"] }, { partial: false });
    expect(s.members[0].status).toBe("not_found");
    expect(s.summary.matched).toBe(0);
  });

  it("distinguishes found-with-zero-activity from not found", () => {
    const s = computeSquadStats(roster("Idle", "Ghost"), { events: [kill(1, "A", "B")], playersSeen: ["Idle"] }, { partial: false });
    expect(s.members[0]).toMatchObject({ status: "matched", kills: 0, deaths: 0, kdDisplay: "—" });
    expect(s.members[1]).toMatchObject({ status: "not_found", kdDisplay: "—" });
    expect(s.summary).toMatchObject({ submitted: 2, matched: 1, notFound: 1 });
  });

  it("does not count participants (assists) as kills", () => {
    const s = computeSquadStats(roster("Helper"), { events: [kill(1, "A", "B", 42, ["A", "Helper"])], playersSeen: ["Helper"] }, { partial: false });
    expect(s.members[0]).toMatchObject({ status: "matched", kills: 0, deaths: 0 });
  });

  it("computes overall K/D as total kills / total deaths, not the mean of ratios", () => {
    // A: 4 kills, 1 death (4.00) ; B: 0 kills, 3 deaths (0.00) → mean 2.00, correct 4/4 = 1.00
    const events = [
      kill(1, "A", "X"), kill(2, "A", "X"), kill(3, "A", "X"), kill(4, "A", "X"),
      kill(5, "Y", "A"), kill(6, "Y", "B"), kill(7, "Y", "B"), kill(8, "Y", "B"),
    ];
    const s = computeSquadStats(roster("A", "B"), { events, playersSeen: [] }, { partial: false });
    expect(s.summary).toMatchObject({ totalKills: 4, totalDeaths: 4, overallKdDisplay: "1.00" });
  });

  it("never counts the same event twice", () => {
    const e = kill(7, "A", "X");
    const s = computeSquadStats(roster("A"), { events: [e, { ...e }, kill(8, "A", "Y")], playersSeen: [] }, { partial: false });
    expect(s.members[0].kills).toBe(2);
    expect(s.duplicateEventsIgnored).toBe(1);
    expect(s.eventsConsidered).toBe(2);
  });

  it("flags friendly fire while counting it under standard rules", () => {
    const s = computeSquadStats(roster("A", "B"), { events: [kill(1, "A", "B")], playersSeen: [] }, { partial: false });
    expect(s.members[0]).toMatchObject({ kills: 1, friendlyKills: 1 });
    expect(s.members[1]).toMatchObject({ deaths: 1, friendlyDeaths: 1 });
    expect(s.summary).toMatchObject({ totalKills: 1, totalDeaths: 1 });
    expect(s.friendlyFire).toHaveLength(1);
  });

  it("shows ∞ overall when the squad has kills and no deaths, — when no activity", () => {
    expect(computeSquadStats(roster("A"), { events: [kill(1, "A", "X")], playersSeen: [] }, { partial: false }).summary.overallKdDisplay).toBe("∞");
    expect(computeSquadStats(roster("A"), { events: [], playersSeen: ["A"] }, { partial: false }).summary.overallKdDisplay).toBe("—");
  });

  it("marks every member incomplete when the dataset is partial", () => {
    const s = computeSquadStats(roster("A", "Ghost"), { events: [kill(1, "A", "X")], playersSeen: [] }, { partial: true });
    expect(s.members.every((m) => m.incomplete)).toBe(true);
  });
});

describe("CSV export", () => {
  it("neutralizes formula injection and quotes fields", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    const s = computeSquadStats(roster("A", "Ghost"), { events: [kill(1, "A", "X")], playersSeen: [] }, { partial: false });
    const lines = membersToCsv(s.members).trim().split("\r\n");
    expect(lines[1]).toBe("A,Matched,1,0,∞,0,0,Yes");
    expect(lines[2]).toBe("Ghost,Not found,,,—,,,Yes");
  });
});
