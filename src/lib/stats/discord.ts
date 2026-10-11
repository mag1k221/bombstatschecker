/** Builds a Discord-ready summary (plain text + one code block), always ≤ 2000 characters. */
import type { AnalyzeResponse } from "@/lib/api-types";
import { formatCompact } from "./format";

export const DISCORD_LIMIT = 2000;

function pad(s: string, n: number, right = false): string {
  const t = s.length > n ? `${s.slice(0, n - 1)}…` : s;
  return right ? t.padStart(n) : t.padEnd(n);
}

export function discordSummary(
  data: Pick<AnalyzeResponse, "summary" | "members" | "source" | "mode">,
  opts: { regearTotal?: number | null; regearLocation?: string; shareUrl?: string | null; maxRows?: number; limit?: number } = {},
): string {
  const limit = opts.limit ?? DISCORD_LIMIT;
  const s = data.summary;
  const battles = data.source.battles.map((b) => b.id).join(", ");
  const header: string[] = [
    `**Boomsquad report**${data.mode === "demo" ? " (demo data)" : ""} — battle ${battles || "?"} · ${data.source.regionLabel}`,
    `**K/D ${s.overallKdDisplay}** · ${s.totalKills} kills · ${s.totalDeaths} deaths · ${s.matched}/${s.submitted} members found`,
  ];
  if (opts.regearTotal != null && opts.regearTotal > 0) {
    header.push(`Regear estimate: **${formatCompact(opts.regearTotal)} silver**${opts.regearLocation ? ` (${opts.regearLocation})` : ""}`);
  }
  if (data.source.completeness === "partial") header.push("⚠️ Partial data — some kills may be missing.");
  // <…> stops Discord from unfurling a preview; very long links are skipped.
  if (opts.shareUrl && opts.shareUrl.length <= 1000) header.push(`Full results: <${opts.shareUrl}>`);

  const matched = data.members
    .filter((m) => m.status === "matched")
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage || a.name.localeCompare(b.name));
  const notFound = data.members.filter((m) => m.status !== "matched").map((m) => m.name);

  const row = (m: (typeof matched)[number]) =>
    `${pad(m.name, 16)} ${pad(String(m.kills), 3, true)} ${pad(String(m.deaths), 3, true)} ${pad(m.kdDisplay, 5, true)} ${pad(formatCompact(m.damage), 6, true)} ${pad(formatCompact(m.healing), 6, true)}`;
  const tableHead = `${pad("Player", 16)} ${pad("K", 3, true)} ${pad("D", 3, true)} ${pad("K/D", 5, true)} ${pad("Dmg", 6, true)} ${pad("Heal", 6, true)}`;

  const build = (rows: number, withMissing: boolean): string => {
    const lines = [...header];
    if (matched.length) {
      lines.push("```", tableHead, ...matched.slice(0, rows).map(row));
      if (matched.length > rows) lines.push(`… +${matched.length - rows} more`);
      lines.push("```");
    }
    if (withMissing && notFound.length) lines.push(`Not found: ${notFound.join(", ")}`);
    return lines.join("\n");
  };

  let rows = Math.min(opts.maxRows ?? 25, matched.length);
  let text = build(rows, true);
  if (text.length > limit) text = build(rows, false);
  while (text.length > limit && rows > 0) text = build(--rows, false);
  return text.length > limit ? text.slice(0, limit) : text;
}
