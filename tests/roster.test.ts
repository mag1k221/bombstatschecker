import { describe, expect, it } from "vitest";
import { buildRoster, extractNames, MAX_ROSTER_SIZE, parseCsv } from "@/lib/stats/roster";

describe("roster", () => {
  it("removes duplicate nicknames case-insensitively, keeping the first spelling", () => {
    const r = buildRoster(["Ashwick", "  ashwick ", "ASHWICK", "Brannoc"]);
    expect(r.members.map((m) => m.input)).toEqual(["Ashwick", "Brannoc"]);
    expect(r.duplicates).toEqual(["ashwick", "ASHWICK"]);
  });

  it("trims whitespace, skips blanks and comments, and reports invalid entries", () => {
    const r = buildRoster(["  Dovrel  ", "", "   ", "# comment", "<script>", "x".repeat(40)]);
    expect(r.members).toEqual([{ key: "dovrel", input: "Dovrel" }]);
    expect(r.invalid.map((i) => i.reason)).toEqual(["Contains unsupported characters", "Longer than 32 characters"]);
  });

  it("enforces the roster size limit", () => {
    const r = buildRoster(Array.from({ length: MAX_ROSTER_SIZE + 5 }, (_, i) => `P${i}`));
    expect(r.members).toHaveLength(MAX_ROSTER_SIZE);
    expect(r.overflow).toBe(5);
  });

  it("extracts names from TXT and CSV (with header detection and quotes)", () => {
    expect(extractNames("\uFEFFA\r\nB\n", "txt")).toEqual(["A", "B", ""]);
    expect(extractNames('Role,Nickname\nTank,"Ash"\nHealer,Bran\n', "csv")).toEqual(["Ash", "Bran"]);
    expect(extractNames("Ash,tank\nBran,heal", "csv")).toEqual(["Ash", "Bran"]);
    expect(extractNames("name;guild\nAsh;G", "csv")).toEqual(["Ash"]);
    expect(parseCsv('"a ""q""",b\n')).toEqual([['a "q"', "b"]]);
  });
});
