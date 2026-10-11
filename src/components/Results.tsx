"use client";

import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Check, CheckCircle2, Copy, Download, ExternalLink, FlaskConical,
  ArrowLeft, ArrowRight, BarChart3, Coins, Link2, Loader2, Pencil, RefreshCw, Search, Share2, Swords, Users,
} from "lucide-react";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { AnalyzeResponse } from "@/lib/api-types";
import type { MemberStat } from "@/lib/stats/compute";
import { membersToCsv } from "@/lib/stats/csv";
import { discordSummary } from "@/lib/stats/discord";
import { formatCompact } from "@/lib/stats/format";
import { RegearPanel, useRegear, type RegearState } from "./Regear";
import { GuildShareCard } from "./GuildShare";
import { ROLE_LABELS, type Role } from "@/lib/weapons/roles";
import { Badge, Button, Card, Dot } from "./ui";
import { RoleBadge, RoleIcon, WeaponIcon, weaponLabel } from "./Weapon";

type SortKey = "name" | "kills" | "deaths" | "kd" | "damage" | "healing" | "ip" | "fame";
type Filter = "all" | "matched" | "not_found" | "friendly";

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

function duration(a: string | null, b: string | null) {
  if (!a || !b) return null;
  const mins = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  return Number.isFinite(mins) && mins >= 0 ? `${mins} min` : null;
}

export function Results({
  data, onRefresh, onEditRoster, onNewLink, getShareLink,
}: { data: AnalyzeResponse; onRefresh?: () => void; onEditRoster: () => void; onNewLink: () => void; getShareLink?: () => Promise<string | null> }) {
  const partial = data.source.completeness === "partial";
  const regear = useRegear(data);
  const [view, setView] = useView();
  const canShare = data.mode === "live" && !!getShareLink;
  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-muted">Results</p>
          <h2 className="mt-1 text-[28px] font-semibold tracking-[-0.025em] sm:text-[32px]">
            {data.source.kind === "multi" ? `${data.source.battles.length} battles` : `Battle ${data.source.battles[0]?.id ?? ""}`}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onEditRoster}>
            <Pencil className="size-3.5" aria-hidden /> Edit roster
          </Button>
          <Button size="sm" onClick={onNewLink}>
            <Link2 className="size-3.5" aria-hidden /> Analyze another link
          </Button>
          {onRefresh && (
            <Button size="sm" onClick={onRefresh} title="Bypass the cache and re-fetch from the source">
              <RefreshCw className="size-3.5" aria-hidden /> Refresh data
            </Button>
          )}
          {canShare && <ShareLink getLink={getShareLink!} />}
          <CopyDiscord data={data} regear={regear} getLink={canShare ? getShareLink : undefined} />
        </div>
      </div>

      {data.mode === "demo" && (
        <Notice tone="accent" icon={<FlaskConical className="size-4" />} title="Demo mode — fictional data">
          These numbers come from a built-in sample battle with made-up players. They are not real Albion Online statistics.
        </Notice>
      )}
      {partial && (
        <Notice tone="warn" icon={<AlertTriangle className="size-4" />} title="Partial results">
          Some source data couldn’t be retrieved, so kills and deaths may be undercounted and “not found” members may simply be missing from the retrieved data. Details are in Source below. Try <b>Refresh data</b> in a moment.
        </Notice>
      )}

      <ViewTabs view={view} onChange={setView} deaths={data.squadDeaths.length} />

      {view === "regear" ? (
        <div className="space-y-6 animate-rise">
          <button onClick={() => setView("stats")} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" aria-hidden /> Back to K/D &amp; stats
          </button>
          {data.squadDeaths.length > 0 ? (
            <RegearPanel data={data} regear={regear} />
          ) : (
            <Card className="p-10 text-center">
              <Coins className="mx-auto size-6 text-subtle" aria-hidden />
              <p className="mt-3 text-[15px] font-medium">No squad deaths — nothing to regear.</p>
              <p className="mt-1 text-[13.5px] text-muted">Nobody on your roster died in this battle.</p>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-6 animate-rise">
          <Summary data={data} />
          <GuildShareCard data={data} />
          {data.squadDeaths.length > 0 && <RegearTeaser regear={regear} deaths={data.squadDeaths.length} onOpen={() => setView("regear")} />}
          {data.roleBreakdown.length > 0 && <RoleBreakdown data={data} />}
          <MemberTable data={data} />
          {data.friendlyFire.length > 0 && <FriendlyFire data={data} />}
          <SourceInfo data={data} />
        </div>
      )}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

type View = "stats" | "regear";

/** Results sub-page, kept in the URL hash (#regear) so back/forward and shared links work. */
function useView(): [View, (v: View) => void] {
  const [view, setViewState] = useState<View>("stats");
  useEffect(() => {
    const sync = () => setViewState(window.location.hash === "#regear" ? "regear" : "stats");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const setView = (v: View) => {
    if (v === view) return;
    if (v === "regear") window.location.hash = "regear";
    else window.history.pushState(null, "", window.location.pathname + window.location.search);
    setViewState(v);
    requestAnimationFrame(() => document.getElementById("results-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return [view, setView];
}

function ViewTabs({ view, onChange, deaths }: { view: View; onChange: (v: View) => void; deaths: number }) {
  const tabs: { id: View; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "stats", label: "K/D & stats", icon: <BarChart3 className="size-4" aria-hidden /> },
    { id: "regear", label: "Regear", icon: <Coins className="size-4" aria-hidden />, count: deaths },
  ];
  return (
    <div id="results-tabs" role="tablist" aria-label="Results pages" className="flex scroll-mt-6 gap-1 rounded-full border border-line bg-surface p-1 shadow-card sm:inline-flex">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={view === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-[14px] font-medium transition-all sm:flex-none sm:px-5",
            view === t.id ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          {t.icon}
          {t.label}
          {t.count != null && (
            <span className={clsx("tnum rounded-full px-1.5 text-[12px]", view === t.id ? "bg-white/20" : "bg-surface-2 text-subtle")}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function RegearTeaser({ regear, deaths, onOpen }: { regear: RegearState; deaths: number; onOpen: () => void }) {
  const t = regear.totals;
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-[22px] border border-line bg-surface p-5 text-left shadow-card transition-colors hover:border-line-strong hover:bg-surface-2/40"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Coins className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-muted">Regear estimate</span>
        <span className="tnum mt-0.5 block text-[22px] font-semibold leading-tight tracking-tight">
          {!regear.enabled ? "See lost gear" : regear.status === "ready" && t ? `${formatCompact(t.total)} silver` : regear.status === "error" ? "Prices unavailable" : "Pricing…"}
        </span>
        <span className="block text-[12.5px] text-subtle">
          {deaths} squad death{deaths === 1 ? "" : "s"}
          {regear.enabled && ` · ${regear.locationLabel}`}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[13.5px] font-medium text-accent">
        <span className="hidden sm:inline">Open regear</span> <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  );
}

function ShareLink({ getLink }: { getLink: () => Promise<string | null> }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");
  async function share() {
    setState("busy");
    const link = await getLink();
    setState(link && (await copyText(link)) ? "copied" : "error");
    setTimeout(() => setState("idle"), 2200);
  }
  return (
    <Button size="sm" onClick={share} disabled={state === "busy"} title="Copy a short link that opens these results" aria-live="polite">
      {state === "busy" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : state === "copied" ? <Check className="size-3.5" aria-hidden /> : <Share2 className="size-3.5" aria-hidden />}
      {state === "copied" ? "Link copied!" : state === "error" ? "Copy failed" : "Share link"}
    </Button>
  );
}

function CopyDiscord({ data, regear, getLink }: { data: AnalyzeResponse; regear: RegearState; getLink?: () => Promise<string | null> }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");
  async function copy() {
    setState("busy");
    const shareUrl = getLink ? await getLink().catch(() => null) : null;
    const text = discordSummary(data, {
      regearTotal: regear.totals && regear.status === "ready" ? regear.totals.total : null,
      regearLocation: regear.locationLabel,
      shareUrl,
    });
    setState((await copyText(text)) ? "copied" : "error");
    setTimeout(() => setState("idle"), 2200);
  }
  return (
    <Button size="sm" variant="primary" onClick={copy} disabled={state === "busy"} title="Copy a summary formatted for Discord (under 2000 characters)" aria-live="polite">
      {state === "copied" ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {state === "copied" ? "Copied!" : state === "error" ? "Copy failed" : "Copy for Discord"}
    </Button>
  );
}

function Notice({ tone, icon, title, children }: { tone: "warn" | "accent"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={clsx(
        "flex gap-3 rounded-2xl border px-4 py-3.5 text-[14px] leading-relaxed",
        tone === "warn" ? "border-warn/25 bg-warn-soft" : "border-accent/25 bg-accent-soft",
      )}
    >
      <span className={clsx("mt-0.5 shrink-0", tone === "warn" ? "text-warn" : "text-accent")} aria-hidden>
        {icon}
      </span>
      <div>
        <p className="font-semibold text-fg">{title}</p>
        <p className="text-muted">{children}</p>
      </div>
    </div>
  );
}

function Summary({ data }: { data: AnalyzeResponse }) {
  const s = data.summary;
  return (
    <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
      <Card as="div" className="col-span-3 flex flex-col justify-between p-6 md:col-span-2">
        <p className="text-[13px] font-medium text-muted">Squad K/D</p>
        <div>
          <p className="tnum mt-3 text-[56px] font-semibold leading-none tracking-[-0.04em] text-accent" aria-label={`Overall K/D ${s.overallKdDisplay}`}>
            {s.overallKdDisplay}
          </p>
          <p className="tnum mt-3 text-[13px] text-muted">
            {s.totalKills} kills ÷ {s.totalDeaths} deaths
          </p>
        </div>
      </Card>
      <Stat label="Kills" value={s.totalKills} />
      <Stat label="Deaths" value={s.totalDeaths} />
      <Stat
        label="Matched"
        value={
          <>
            {s.matched}
            <span className="text-[16px] font-medium text-subtle sm:text-[20px]"> / {s.submitted}</span>
          </>
        }
        hint={`of ${s.submitted} unique`}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card as="div" className="p-4 sm:p-5">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="tnum mt-3 text-[26px] font-semibold leading-none tracking-[-0.03em] sm:text-[34px]">{value}</p>
      {hint && <p className="mt-2 text-[12px] text-subtle">{hint}</p>}
    </Card>
  );
}

function RoleBreakdown({ data }: { data: AnalyzeResponse }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-semibold tracking-tight">By role</h3>
        <p className="text-[12.5px] text-subtle">Inferred from each member’s most-used weapon in this battle</p>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {data.roleBreakdown.map((r) => (
          <div key={r.role} className="rounded-2xl border border-line bg-surface-2/40 p-3.5">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
              <RoleIcon role={r.role} /> {ROLE_LABELS[r.role]}
              <span className="tnum ml-auto text-subtle">{r.members}</span>
            </p>
            <p className="tnum mt-2 text-[22px] font-semibold leading-none tracking-tight">{r.kdDisplay}</p>
            <p className="tnum mt-1.5 text-[12px] text-subtle">
              {r.kills} K · {r.deaths} D
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function statusOf(m: MemberStat): { tone: "ok" | "neutral" | "warn"; label: string; title: string } {
  if (m.status === "not_found") {
    return m.incomplete
      ? { tone: "warn", label: "Not found · data incomplete", title: "Not in the retrieved data, but some source data is missing — this is not conclusive." }
      : { tone: "neutral", label: "Not in battle", title: "This nickname does not appear anywhere in the battle data." };
  }
  if (m.kills === 0 && m.deaths === 0) return { tone: "ok", label: "In battle · no K/D", title: "Present in the battle with no killing blows and no deaths." };
  return { tone: "ok", label: "Matched", title: "Found in the battle data." };
}

function MemberTable({ data }: { data: AnalyzeResponse }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "kills", dir: "desc" });
  const hasFriendly = data.friendlyFire.length > 0;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.members.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.input.toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && (m.status !== "matched" || m.role !== roleFilter)) return false;
      if (filter === "matched") return m.status === "matched";
      if (filter === "not_found") return m.status === "not_found";
      if (filter === "friendly") return m.friendlyKills + m.friendlyDeaths > 0;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const kdSort = (m: MemberStat) => (m.status === "not_found" ? -2 : m.kd === null ? -1 : m.kd);
    return filtered.sort((a, b) => {
      // Unmatched rows always sink below matched ones for numeric sorts.
      if (sort.key !== "name" && a.status !== b.status) return a.status === "matched" ? -1 : 1;
      let c = 0;
      if (sort.key === "name") c = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      else if (sort.key === "kills") c = a.kills - b.kills;
      else if (sort.key === "deaths") c = a.deaths - b.deaths;
      else if (sort.key === "damage") c = a.damage - b.damage;
      else if (sort.key === "healing") c = a.healing - b.healing;
      else if (sort.key === "ip") c = (a.avgIp ?? -1) - (b.avgIp ?? -1);
      else if (sort.key === "fame") c = (a.killFame ?? -1) - (b.killFame ?? -1);
      else c = kdSort(a) - kdSort(b) || a.kills - b.kills;
      return c * dir || a.name.localeCompare(b.name);
    });
  }, [data.members, query, filter, roleFilter, sort]);

  const counts = {
    all: data.members.length,
    matched: data.summary.matched,
    not_found: data.summary.notFound,
    friendly: data.members.filter((m) => m.friendlyKills + m.friendlyDeaths > 0).length,
  };

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  function exportCsv() {
    const csv = membersToCsv(data.members);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    const id = data.source.battles.map((b) => b.id).join("-").slice(0, 60);
    a.href = URL.createObjectURL(blob);
    a.download = `bombstats-${data.mode === "demo" ? "DEMO-" : ""}${id}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "matched", label: "Matched" },
    { id: "not_found", label: "Not found" },
    ...(hasFriendly ? [{ id: "friendly" as const, label: "Friendly fire" }] : []),
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted" aria-hidden />
          <h3 className="text-[16px] font-semibold tracking-tight">Members</h3>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nickname"
              aria-label="Search by nickname"
              className="h-9 w-full rounded-full border border-line-strong bg-surface-2/60 pr-3 pl-8.5 text-[13.5px] placeholder:text-subtle focus:border-accent focus:bg-surface focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-accent-soft sm:w-52"
            />
          </div>
          <div role="radiogroup" aria-label="Filter members" className="inline-flex overflow-x-auto rounded-full bg-surface-2 p-0.5">
            {filters.map((f) => (
              <button
                key={f.id}
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={clsx(
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-all",
                  filter === f.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
                )}
              >
                {f.label} <span className="tnum text-subtle">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {data.roleBreakdown.length > 0 && (
            <>
              <label className="sr-only" htmlFor="role-select">Filter by role</label>
              <select
                id="role-select"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as Role | "all")}
                className="h-9 rounded-full border border-line-strong bg-surface px-3 text-[13px] text-fg focus:border-accent focus:outline-none"
              >
                <option value="all">All roles</option>
                {data.roleBreakdown.map((r) => (
                  <option key={r.role} value={r.role}>
                    {ROLE_LABELS[r.role]} ({r.members})
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="sr-only" htmlFor="sort-select">Sort by</label>
          <select
            id="sort-select"
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":") as [SortKey, "asc" | "desc"];
              setSort({ key, dir });
            }}
            className="h-9 rounded-full border border-line-strong bg-surface px-3 text-[13px] text-fg focus:border-accent focus:outline-none md:hidden"
          >
            <option value="kills:desc">Most kills</option>
            <option value="deaths:desc">Most deaths</option>
            <option value="kd:desc">Best K/D</option>
            <option value="kd:asc">Worst K/D</option>
            <option value="damage:desc">Most damage</option>
            <option value="healing:desc">Most healing</option>
            <option value="ip:desc">Highest IP</option>
            <option value="name:asc">Name A–Z</option>
          </select>
          <Button size="sm" onClick={exportCsv} className="h-9">
            <Download className="size-3.5" aria-hidden /> CSV
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Member statistics. Column headers are sortable.</caption>
          <thead>
            <tr className="text-[12px] font-medium text-subtle">
              <Th label="Nickname" k="name" sort={sort} onSort={toggleSort} className="pl-3 sm:pl-5" />
              <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">Role · weapon</th>
              <Th label="Kills" short="K" k="kills" sort={sort} onSort={toggleSort} numeric />
              <Th label="Deaths" short="D" k="deaths" sort={sort} onSort={toggleSort} numeric />
              <Th label="K/D" k="kd" sort={sort} onSort={toggleSort} numeric />
              <Th label="Damage" k="damage" sort={sort} onSort={toggleSort} numeric className="hidden md:table-cell" />
              <Th label="Healing" k="healing" sort={sort} onSort={toggleSort} numeric className="hidden md:table-cell" />
              <Th label="Avg IP" k="ip" sort={sort} onSort={toggleSort} numeric className="hidden xl:table-cell" />
              <Th label="Kill fame" k="fame" sort={sort} onSort={toggleSort} numeric className="hidden pr-5 xl:table-cell" />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const st = statusOf(m);
              const found = m.status === "matched";
              return (
                <tr key={m.key} className="border-t border-line transition-colors hover:bg-surface-2/50">
                  <td className="py-3 pr-2 pl-3 sm:pr-4 sm:pl-5">
                    <div className="flex items-center gap-2.5 sm:gap-3">
                    <WeaponIcon weapon={found ? m.weapon : null} />
                    <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={clsx("text-[14.5px] font-medium", !found && "text-muted")}>{m.name}</span>
                      {m.friendlyKills + m.friendlyDeaths > 0 && (
                        <Badge tone="accent" className="!px-2 !text-[11px]" title={`Friendly fire: ${m.friendlyKills} kill(s) of squadmates, ${m.friendlyDeaths} death(s) to squadmates. Counted under standard rules.`}>
                          <Swords className="size-3" aria-hidden /> FF
                        </Badge>
                      )}
                    </div>
                    {found && m.name !== m.input && <p className="mt-0.5 text-[12px] text-subtle">submitted as “{m.input}”</p>}
                    {found && (
                      <p className="mt-0.5 flex min-w-0 items-center gap-1 whitespace-nowrap text-[12px] text-muted lg:hidden" title={m.weapon ? weaponLabel(m.weapon) : undefined}>
                        <RoleIcon role={m.role} className="size-3 shrink-0" />
                        {ROLE_LABELS[m.role]}
                        {m.weapon && <span className="hidden truncate text-subtle sm:inline">· {m.weapon.name}</span>}
                      </p>
                    )}
                    {found && (
                      <p className="tnum mt-0.5 text-[12px] text-subtle md:hidden">
                        {[
                          m.damage > 0 && `${formatCompact(m.damage)} dmg`,
                          m.healing > 0 && `${formatCompact(m.healing)} heal`,
                          m.avgIp != null && `${Math.round(m.avgIp)} IP`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    {(st.label !== "Matched" || (found && m.incomplete)) && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {st.label !== "Matched" && (
                          <Badge tone={st.tone} title={st.title} className="!text-[11px]">
                            <Dot tone={st.tone} /> {st.label}
                          </Badge>
                        )}
                        {found && m.incomplete && (
                          <span title="Source data is partial — this member’s counts may be undercounted." className="text-warn">
                            <AlertTriangle className="size-3.5" aria-label="May be incomplete" />
                          </span>
                        )}
                      </div>
                    )}
                    </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    {found ? (
                      <div>
                        <RoleBadge role={m.role} />
                        <p className="mt-1 max-w-[220px] truncate text-[12px] text-subtle" title={m.otherWeapons.length ? `Also used: ${m.otherWeapons.join(", ")}` : undefined}>
                          {m.weapon ? weaponLabel(m.weapon) : "No gear data"}
                          {m.otherWeapons.length > 0 && <span> · +{m.otherWeapons.length} swap{m.otherWeapons.length > 1 ? "s" : ""}</span>}
                        </p>
                      </div>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <Num value={found ? m.kills : null} />
                  <Num value={found ? m.deaths : null} />
                  <td className={clsx("tnum px-1.5 py-3.5 pr-3 text-right text-[14.5px] font-semibold sm:px-4", !found && "text-subtle")}>
                    {m.kdDisplay === "∞" ? <span className="text-[19px] leading-none" aria-label="infinite">∞</span> : m.kdDisplay}
                  </td>
                  <Num value={found ? m.damage : null} compact className="hidden md:table-cell" />
                  <Num value={found ? m.healing : null} compact className="hidden md:table-cell" />
                  <Num value={found && m.avgIp != null ? Math.round(m.avgIp) : null} className="hidden xl:table-cell" />
                  <Num value={found ? m.killFame : null} compact className="hidden pr-5 xl:table-cell" />
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-[14px] text-muted">
                  No members match {query ? <>“{query}”</> : "this filter"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(data.roster.duplicatesRemoved.length > 0 || data.roster.invalid.length > 0 || data.roster.overflow > 0) && (
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-subtle">
          {data.roster.duplicatesRemoved.length > 0 && <>Ignored {data.roster.duplicatesRemoved.length} duplicate nickname{data.roster.duplicatesRemoved.length > 1 ? "s" : ""}. </>}
          {data.roster.invalid.length > 0 && <>Skipped {data.roster.invalid.length} invalid entr{data.roster.invalid.length > 1 ? "ies" : "y"}. </>}
          {data.roster.overflow > 0 && <>{data.roster.overflow} members over the limit were not analyzed.</>}
        </p>
      )}
    </Card>
  );
}

function Th({ label, short, k, sort, onSort, numeric, className }: { label: string; short?: string; k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; numeric?: boolean; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={clsx("px-1 py-2 sm:px-4", numeric && "text-right", className)}>
      <button
        onClick={() => onSort(k)}
        className={clsx("inline-flex items-center gap-1 rounded-md px-1 py-1 font-medium transition-colors hover:text-fg", active && "text-fg", numeric && "flex-row-reverse")}
      >
        {short ? (
          <>
            <span className="sm:hidden" aria-hidden>{short}</span>
            <span className="sr-only sm:not-sr-only">{label}</span>
          </>
        ) : (
          label
        )}
        <Icon className={clsx("size-3", !active && "opacity-50")} aria-hidden />
      </button>
    </th>
  );
}

function Num({ value, compact, className }: { value: number | null; compact?: boolean; className?: string }) {
  return (
    <td
      className={clsx("tnum px-1.5 py-3.5 text-right text-[14.5px] sm:px-4", value === null ? "text-subtle" : value === 0 ? "text-muted" : "font-medium", className)}
      title={compact && value != null ? value.toLocaleString() : undefined}
    >
      {value === null ? "—" : compact ? formatCompact(value) : value}
    </td>
  );
}

function FriendlyFire({ data }: { data: AnalyzeResponse }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-3 flex items-center gap-2">
        <Swords className="size-4 text-accent" aria-hidden />
        <h3 className="text-[16px] font-semibold tracking-tight">Friendly fire</h3>
        <Badge tone="accent">{data.friendlyFire.length}</Badge>
      </div>
      <p className="mb-3 text-[13.5px] text-muted">
        Squad members killed by other squad members. These are counted under the standard rules (a kill for the killer and a death for the victim), so they also appear in the totals above.
      </p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {data.friendlyFire.slice(0, 50).map((f) => (
          <li key={f.eventId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
            <span>
              <b className="font-medium">{f.killer}</b> <span className="text-subtle">killed</span> <b className="font-medium">{f.victim}</b>
            </span>
            <span className="tnum text-[12.5px] text-subtle">
              {f.timestamp ? new Date(f.timestamp).toLocaleTimeString(undefined, { timeStyle: "medium" }) : ""} · event {f.eventId}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SourceInfo({ data }: { data: AnalyzeResponse }) {
  const src = data.source;
  const complete = src.completeness === "complete";
  const isDemo = data.mode === "demo";
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold tracking-tight">Source</h3>
        {complete ? (
          <Badge tone="ok"><CheckCircle2 className="size-3.5" aria-hidden /> Complete</Badge>
        ) : (
          <Badge tone="warn"><AlertTriangle className="size-3.5" aria-hidden /> Partial</Badge>
        )}
      </div>

      <dl className="grid gap-x-8 gap-y-4 text-[13.5px] sm:grid-cols-2">
        <Field label="Killboard link">
          {isDemo ? (
            <span className="text-muted">Demo — no link</span>
          ) : (
            <a href={src.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all font-medium text-accent hover:underline">
              {src.inputUrl}
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          )}
        </Field>
        <Field label="Server">{src.regionLabel}</Field>
        <Field label="Last retrieved">
          {fmtDateTime(src.retrievedAt)}
          {src.fromCache && <span className="text-subtle"> · cached</span>}
        </Field>
        <Field label="Events counted">
          <span className="tnum">{src.eventsConsidered}</span> kill events
          {src.duplicateEventsIgnored > 0 && <span className="text-subtle"> · {src.duplicateEventsIgnored} duplicate(s) ignored</span>}
        </Field>
      </dl>

      <div className="mt-5 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead className="bg-surface-2/60 text-[12px] text-subtle">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Battle</th>
              <th scope="col" className="px-4 py-2 font-medium">Started</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Kills (reported / retrieved)</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {src.battles.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="tnum px-4 py-2.5 font-medium">{b.id}</td>
                <td className="px-4 py-2.5 text-muted">
                  {fmtDateTime(b.startTime)}
                  {duration(b.startTime, b.endTime) && <span className="text-subtle"> · {duration(b.startTime, b.endTime)}</span>}
                </td>
                <td className="tnum px-4 py-2.5 text-right">
                  {b.reportedKills ?? "?"} / {b.retrievedEvents}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={b.status === "complete" ? "ok" : b.status === "partial" ? "warn" : "danger"}>
                    {b.status === "complete" ? "Complete" : b.status === "partial" ? "Partial" : "Failed"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {src.issues.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-[13px] text-muted">
          {src.issues.map((i, idx) => (
            <li key={idx} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              <span>
                <span className="tnum text-subtle">#{i.battleId}</span> {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 border-t border-line pt-4 text-[12.5px] leading-relaxed text-subtle">
        {isDemo
          ? "Demo data is fictional and bundled with the app."
          : "Scope: only the kill events of the battle(s) in this link, retrieved from the official Albion Online game-info API (the data AlbionBB itself displays). A kill is the killing blow; assists are not counted. A member is “matched” if their exact nickname appears anywhere in the battle data. Weapon = the main hand a member was seen with most often in this battle’s kill events; role is inferred from that weapon (the game doesn’t report roles). Damage and healing are summed over the kill events a member took part in (as reported by the game), so they cover kills rather than the whole fight; Avg IP is averaged over those events. Weapon icons come from the official Albion Online render service."}
      </p>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium text-subtle">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

export function ResultsSkeleton({ refresh }: { refresh: boolean }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading results">
      <div className="flex items-center gap-3 text-[14px] text-muted">
        <RefreshCw className="size-4 animate-spin text-accent" aria-hidden />
        {refresh ? "Re-fetching battle data from the source…" : "Retrieving battle summary and every page of kill events…"}
      </div>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
        <div className="skeleton col-span-3 md:col-span-2 h-[150px] rounded-[22px]" />
        <div className="skeleton h-[150px] rounded-[22px]" />
        <div className="skeleton h-[150px] rounded-[22px]" />
        <div className="skeleton h-[150px] rounded-[22px]" />
      </div>
      <div className="space-y-px overflow-hidden rounded-[22px] border border-line bg-surface">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="skeleton h-3.5 w-36 rounded-full" />
            <div className="ml-auto skeleton h-3.5 w-10 rounded-full" />
            <div className="skeleton h-3.5 w-10 rounded-full" />
            <div className="skeleton h-3.5 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
