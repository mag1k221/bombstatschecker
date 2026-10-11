import type { MemberStat } from "./compute";
import { ROLE_LABELS } from "@/lib/weapons/roles";

/** Neutralizes spreadsheet formula injection and quotes per RFC 4180. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function membersToCsv(members: readonly MemberStat[]): string {
  const header = ["Nickname", "Status", "Role (inferred)", "Weapon", "Kills", "Deaths", "K/D", "Damage", "Healing", "Avg IP", "Kill fame", "Friendly kills", "Friendly deaths", "Data complete"];
  const rows = members.map((m) => {
    const found = m.status === "matched";
    return [
      m.name,
      found ? "Matched" : "Not found",
      found ? ROLE_LABELS[m.role] : "",
      m.weapon ? `${m.weapon.name} (T${m.weapon.tier}${m.weapon.enchant ? `.${m.weapon.enchant}` : ""})` : "",
      found ? m.kills : "",
      found ? m.deaths : "",
      m.kdDisplay,
      found ? Math.round(m.damage) : "",
      found ? Math.round(m.healing) : "",
      found && m.avgIp != null ? Math.round(m.avgIp) : "",
      found && m.killFame != null ? m.killFame : "",
      found ? m.friendlyKills : "",
      found ? m.friendlyDeaths : "",
      m.incomplete ? "No" : "Yes",
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
