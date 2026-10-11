import type { MemberStat } from "./compute";

/** Neutralizes spreadsheet formula injection and quotes per RFC 4180. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function membersToCsv(members: readonly MemberStat[]): string {
  const header = ["Nickname", "Status", "Kills", "Deaths", "K/D", "Friendly kills", "Friendly deaths", "Data complete"];
  const rows = members.map((m) => {
    const found = m.status === "matched";
    return [
      m.name,
      found ? "Matched" : "Not found",
      found ? m.kills : "",
      found ? m.deaths : "",
      m.kdDisplay,
      found ? m.friendlyKills : "",
      found ? m.friendlyDeaths : "",
      m.incomplete ? "No" : "Yes",
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
