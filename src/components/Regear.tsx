"use client";

import { AlertTriangle, ChevronDown, Coins, RefreshCw, Skull } from "lucide-react";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalyzeResponse, PriceQuote, PricesResponse } from "@/lib/api-types";
import { computeRegear, itemsToPrice, qualityName, type DeathCost, type PricedItem, type RegearTotals } from "@/lib/stats/regear";
import { formatCompact } from "@/lib/stats/format";
import { Badge, Button, Card } from "./ui";

const LOCATIONS = ["all", "Caerleon", "Bridgewatch", "Lymhurst", "Martlock", "Fort Sterling", "Thetford", "Brecilien"] as const;
type Location = (typeof LOCATIONS)[number];
const PREF_KEY = "boomsquad.market.v1";

export interface RegearState {
  enabled: boolean;
  location: Location;
  locationLabel: string;
  setLocation: (l: Location) => void;
  includeMounts: boolean;
  setIncludeMounts: (v: boolean) => void;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  retrievedAt: string | null;
  failedChunks: number;
  totals: RegearTotals | null;
  reload: () => void;
}

const labelFor = (l: Location) => (l === "all" ? "cheapest city" : l);

export function useRegear(data: AnalyzeResponse): RegearState {
  const enabled = data.mode === "live" && data.source.region !== null && data.squadDeaths.length > 0;
  const [location, setLocationState] = useState<Location>("all");
  const [includeMounts, setIncludeMounts] = useState(true);
  const [quotes, setQuotes] = useState<Record<string, PriceQuote>>({});
  const [status, setStatus] = useState<RegearState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ retrievedAt: string | null; failedChunks: number }>({ retrievedAt: null, failedChunks: 0 });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
      if (saved && (LOCATIONS as readonly string[]).includes(saved.location)) setLocationState(saved.location);
      if (saved && typeof saved.includeMounts === "boolean") setIncludeMounts(saved.includeMounts);
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: { location: Location; includeMounts: boolean }) => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
    } catch {
      /* storage may be unavailable */
    }
  };
  const setLocation = useCallback((l: Location) => {
    setLocationState(l);
    persist({ location: l, includeMounts });
  }, [includeMounts]);
  const setMounts = useCallback((v: boolean) => {
    setIncludeMounts(v);
    persist({ location, includeMounts: v });
  }, [location]);

  const items = useMemo(() => itemsToPrice(data.squadDeaths), [data.squadDeaths]);

  useEffect(() => {
    if (!enabled || items.length === 0) return;
    const ctrl = new AbortController();
    setStatus("loading");
    setError(null);
    fetch("/api/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: data.source.region, location, items: items.slice(0, 400) }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Price lookup failed (${r.status}).`);
        const res = body as PricesResponse;
        setQuotes(res.quotes);
        setMeta({ retrievedAt: res.retrievedAt, failedChunks: res.failedChunks });
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message || "Price lookup failed.");
        setStatus("error");
      });
    return () => ctrl.abort();
  }, [enabled, items, location, data.source.region, nonce]);

  const totals = useMemo(
    () => computeRegear(data.squadDeaths, enabled ? quotes : {}, { excludeSlots: includeMounts ? undefined : new Set(["Mount"]) }),
    [data.squadDeaths, quotes, includeMounts, enabled],
  );

  return {
    enabled,
    location,
    locationLabel: labelFor(location),
    setLocation,
    includeMounts,
    setIncludeMounts: setMounts,
    status: enabled ? status : "idle",
    error,
    retrievedAt: meta.retrievedAt,
    failedChunks: meta.failedChunks,
    totals,
    reload: () => setNonce((n) => n + 1),
  };
}

export function RegearPanel({ data, regear }: { data: AnalyzeResponse; regear: RegearState }) {
  const [showAll, setShowAll] = useState(false);
  const t = regear.totals;
  if (!t) return null;
  const loading = regear.status === "loading";
  const priced = regear.enabled && regear.status === "ready";
  const deaths = [...t.deaths].sort((a, b) => b.total - a.total || (a.death.timestamp ?? "").localeCompare(b.death.timestamp ?? ""));
  const visible = showAll ? deaths : deaths.slice(0, 8);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Coins className="size-4 text-muted" aria-hidden />
          <h3 className="text-[16px] font-semibold tracking-tight">Regear calculator</h3>
          <Badge>{t.deaths.length} death{t.deaths.length === 1 ? "" : "s"}</Badge>
        </div>
        {regear.enabled && (
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="sr-only" htmlFor="market-select">Market</label>
            <select
              id="market-select"
              value={regear.location}
              onChange={(e) => regear.setLocation(e.target.value as Location)}
              className="h-9 rounded-full border border-line-strong bg-surface px-3 text-[13px] text-fg focus:border-accent focus:outline-none"
            >
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{l === "all" ? "Cheapest in any city" : l}</option>
              ))}
            </select>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={regear.includeMounts}
                onChange={(e) => regear.setIncludeMounts(e.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              Include mounts
            </label>
            <Button size="sm" className="h-9" onClick={regear.reload} disabled={loading} title="Fetch prices again">
              <RefreshCw className={clsx("size-3.5", loading && "animate-spin")} aria-hidden /> Prices
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
        <div className="rounded-2xl border border-line bg-surface-2/40 p-4 sm:col-span-1">
          <p className="text-[13px] font-medium text-muted">Estimated regear</p>
          <p className="tnum mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em] text-accent" aria-live="polite">
            {!regear.enabled ? "—" : loading && !priced ? <span className="skeleton inline-block h-8 w-28 rounded-lg align-middle" /> : formatCompact(t.total)}
          </p>
          <p className="mt-2 text-[12px] text-subtle">
            {!regear.enabled
              ? "Market prices aren’t available for demo data."
              : `silver · ${t.itemCount} items · ${labelFor(regear.location)}`}
          </p>
          {priced && (t.missing > 0 || t.approx > 0 || regear.failedChunks > 0) && (
            <p className="mt-2 flex gap-1.5 text-[12px] text-warn">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {t.missing > 0 && <>{t.missing} item{t.missing > 1 ? "s" : ""} without a recent price (not counted). </>}
                {t.approx > 0 && <>{t.approx} priced at a nearby quality. </>}
                {regear.failedChunks > 0 && <>Some price requests failed.</>}
              </span>
            </p>
          )}
          {regear.status === "error" && <p className="mt-2 text-[12px] text-danger">{regear.error}</p>}
        </div>
        <div className="sm:col-span-2">
          <p className="mb-2 text-[12px] font-medium text-subtle">By member</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {t.members.map((m) => (
              <li key={m.memberKey} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-[13.5px]">
                <span className="truncate font-medium">{m.name}</span>
                <span className="tnum shrink-0 text-muted">
                  <span className="text-subtle">{m.deaths}×</span>{" "}
                  {regear.enabled ? (loading && !priced ? "…" : formatCompact(m.total)) : "—"}
                  {priced && m.missing > 0 && <span className="text-warn" title={`${m.missing} item(s) without price`}>*</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ul className="divide-y divide-line border-t border-line">
        {visible.map((d) => (
          <DeathRow key={`${d.death.battleId}-${d.death.eventId}`} d={d} priced={priced} />
        ))}
      </ul>
      {deaths.length > 8 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-line px-4 py-3 text-[13px] font-medium text-muted hover:bg-surface-2/50 hover:text-fg"
        >
          {showAll ? "Show fewer" : `Show all ${deaths.length} deaths`}
          <ChevronDown className={clsx("size-3.5 transition-transform", showAll && "rotate-180")} aria-hidden />
        </button>
      )}
      <p className="border-t border-line px-5 py-3 text-[12px] leading-relaxed text-subtle">
        Gear is what each member was wearing when killed (consumables excluded). Prices are the lowest current sell order from the{" "}
        <a href="https://www.albion-online-data.com/" target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
          Albion Online Data Project
        </a>{" "}
        — crowdsourced, so they can be missing or out of date; anything older than 7 days is ignored.
        {regear.retrievedAt && <> Fetched {new Date(regear.retrievedAt).toLocaleTimeString(undefined, { timeStyle: "short" })}.</>}
      </p>
      <span className="sr-only">{data.squadDeaths.length} deaths listed</span>
    </Card>
  );
}

function DeathRow({ d, priced }: { d: DeathCost; priced: boolean }) {
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="min-w-0 sm:w-56 sm:shrink-0">
        <p className="flex items-center gap-1.5 text-[14px] font-medium">
          <Skull className="size-3.5 shrink-0 text-danger" aria-hidden />
          <span className="truncate">{d.death.victim}</span>
        </p>
        <p className="mt-0.5 truncate text-[12px] text-subtle">
          by {d.death.killer}
          {d.death.killerGuild && <> · {d.death.killerGuild}</>}
          {d.death.timestamp && <> · {new Date(d.death.timestamp).toLocaleTimeString(undefined, { timeStyle: "short" })}</>}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {d.items.length === 0 && <span className="text-[12.5px] text-subtle">No gear reported</span>}
        {d.items.map((it) => (
          <ItemTile key={it.slot} it={it} priced={priced} />
        ))}
      </div>
      <p className="tnum text-[15px] font-semibold sm:w-20 sm:text-right">
        {priced ? formatCompact(d.total) : "—"}
        {priced && d.missing > 0 && <span className="text-warn">*</span>}
      </p>
    </li>
  );
}

function ItemTile({ it, priced }: { it: PricedItem; priced: boolean }) {
  const [failed, setFailed] = useState(false);
  const tier = /^T(\d)/.exec(it.type)?.[1];
  const ench = /@(\d)$/.exec(it.type)?.[1];
  const title = [
    `${it.name}${tier ? ` · T${tier}${ench ? `.${ench}` : ""}` : ""} · ${qualityName(it.quality)}`,
    priced
      ? it.quote
        ? `${it.quote.price.toLocaleString()} silver · ${it.quote.city}${it.approx ? ` (price for ${qualityName(it.quote.quality)})` : ""}`
        : "No recent price"
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span title={title} className="relative inline-flex">
      {failed ? (
        <span className="grid size-10 place-items-center rounded-lg border border-line bg-surface-2 text-[10px] text-subtle">{it.slot.slice(0, 3)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://render.albiononline.com/v1/item/${encodeURIComponent(it.type)}.png?size=64&quality=${it.quality}`}
          alt={title.split("\n")[0]}
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-10 rounded-lg bg-surface-2 object-contain"
        />
      )}
      {priced && (
        <span
          className={clsx(
            "tnum absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1 text-[9.5px] font-semibold leading-[14px] shadow-sm",
            it.quote ? (it.approx ? "bg-warn-soft text-warn" : "bg-surface text-fg") : "bg-surface text-subtle",
          )}
        >
          {it.quote ? formatCompact(it.quote.price) : "?"}
        </span>
      )}
    </span>
  );
}
