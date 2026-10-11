"use client";

import { Shield, Users } from "lucide-react";
import clsx from "clsx";
import { useState } from "react";
import type { AnalyzeResponse } from "@/lib/api-types";
import type { GroupShare } from "@/lib/stats/compute";
import { Card } from "./ui";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`.replace(".0%", "%"));

export function GuildShareCard({ data }: { data: AnalyzeResponse }) {
  const groups = data.groupShares ?? [];
  const [sel, setSel] = useState(0);
  if (groups.length === 0) return null;
  const g: GroupShare = groups[Math.min(sel, groups.length - 1)];
  const partial = data.source.completeness === "partial";

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">
          <Shield className="size-4 text-muted" aria-hidden /> Guild contribution
        </h3>
        {groups.length > 1 && (
          <>
            <label className="sr-only" htmlFor="group-select">Guild or alliance</label>
            <select
              id="group-select"
              value={sel}
              onChange={(e) => setSel(Number(e.target.value))}
              className="h-9 max-w-full rounded-full border border-line-strong bg-surface px-3 text-[13px] text-fg focus:border-accent focus:outline-none"
            >
              {groups.map((x, i) => (
                <option key={`${x.kind}|${x.name}`} value={i}>
                  {x.kind === "guild" ? "Guild" : "Alliance"}: {x.name} ({x.squadMembers} squad)
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="text-[13px] font-medium text-muted">
            Squad share of <span className="text-fg">{g.name}</span>
            {g.alliance && <span className="text-subtle"> [{g.alliance}]</span>} kills
          </p>
          <p className="tnum mt-2 text-[48px] font-semibold leading-none tracking-[-0.04em] text-accent">{pct(g.killShare)}</p>
          <Bar value={g.killShare} className="mt-4" label={`Squad share of ${g.name} kills`} />
          <p className="tnum mt-2.5 text-[13px] text-muted">
            <b className="font-semibold text-fg">{g.squadKills}</b> of {g.totalKills} {g.kind} kills made by your squad
            <span className="text-subtle"> · {g.squadMembers} squad member{g.squadMembers === 1 ? "" : "s"} seen killing or dying for it</span>
          </p>
          <div className="mt-4 rounded-2xl border border-line bg-surface-2/40 p-3.5">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="text-muted">Share of {g.kind} deaths</span>
              <span className="tnum font-semibold">{pct(g.deathShare)}</span>
            </div>
            <Bar value={g.deathShare} tone="muted" className="mt-2" label={`Squad share of ${g.name} deaths`} />
            <p className="tnum mt-1.5 text-[12px] text-subtle">
              {g.squadDeaths} of {g.totalDeaths} deaths
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-subtle">
            <Users className="size-3.5" aria-hidden /> Top squad killers · % of {g.kind} kills
          </p>
          {g.topKillers.length === 0 ? (
            <p className="text-[13px] text-subtle">No squad kills for this {g.kind}.</p>
          ) : (
            <ul className="space-y-2">
              {g.topKillers.map((k) => {
                const share = g.totalKills > 0 ? k.kills / g.totalKills : null;
                return (
                  <li key={k.name}>
                    <div className="flex items-baseline justify-between gap-2 text-[13.5px]">
                      <span className="truncate font-medium">{k.name}</span>
                      <span className="tnum shrink-0 text-muted">
                        {k.kills} · <span className="font-semibold text-fg">{pct(share)}</span>
                      </span>
                    </div>
                    <Bar value={share} className="mt-1" thin label={`${k.name} share`} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-5 border-t border-line pt-3 text-[12px] leading-relaxed text-subtle">
        Counted from this battle’s kill events: a {g.kind} kill is any killing blow by a player in that {g.kind}; a squad kill is one by a roster member while in it.
        {partial && " Some events couldn’t be retrieved, so these percentages are approximate."}
      </p>
    </Card>
  );
}

function Bar({ value, className, tone = "accent", thin, label }: { value: number | null; className?: string; tone?: "accent" | "muted"; thin?: boolean; label: string }) {
  const w = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(w)}
      className={clsx("overflow-hidden rounded-full bg-surface-2", thin ? "h-1.5" : "h-2.5", className)}
    >
      <div className={clsx("h-full rounded-full transition-[width] duration-700", tone === "accent" ? "bg-accent" : "bg-subtle")} style={{ width: `${w}%` }} />
    </div>
  );
}
