"use client";

import { AlertTriangle, ArrowRight, Check, Link2, Loader2, Sparkles } from "lucide-react";
import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import type { AnalyzeError, AnalyzeResponse } from "@/lib/api-types";
import { REGIONS } from "@/lib/source/regions";
import { DEMO_ROSTER } from "@/lib/source/demo";
import { LinkError, parseAlbionBBLink } from "@/lib/source/url";
import { buildRoster } from "@/lib/stats/roster";
import { Results, ResultsSkeleton } from "./Results";
import { RosterInput } from "./RosterInput";
import { ThemeToggle } from "./ThemeToggle";
import { Button, Card } from "./ui";

type State =
  | { phase: "idle" }
  | { phase: "loading"; refresh: boolean }
  | { phase: "success"; data: AnalyzeResponse }
  | { phase: "error"; error: AnalyzeError };

export function Analyzer({ demoEnabled }: { demoEnabled: boolean }) {
  const [url, setUrl] = useState("");
  const [rosterText, setRosterText] = useState("");
  const [touchedUrl, setTouchedUrl] = useState(false);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [lastData, setLastData] = useState<AnalyzeResponse | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const rosterRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const link = useMemo(() => {
    if (!url.trim()) return { ok: false as const, error: null };
    try {
      return { ok: true as const, value: parseAlbionBBLink(url) };
    } catch (e) {
      return { ok: false as const, error: e instanceof LinkError ? e.message : "Invalid link." };
    }
  }, [url]);

  const roster = useMemo(() => buildRoster(rosterText.split(/\r?\n/)), [rosterText]);
  const loading = state.phase === "loading";
  const canAnalyze = link.ok && roster.members.length > 0 && !loading;

  async function run(opts: { refresh?: boolean; demo?: boolean } = {}) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ phase: "loading", refresh: !!opts.refresh });
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    const members = opts.demo && roster.members.length === 0 ? DEMO_ROSTER : roster.members.map((m) => m.input);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts.demo ? { demo: true, members } : { url, members, refresh: !!opts.refresh }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setState({ phase: "error", error: body ?? { code: "internal", error: `Request failed (${res.status}).` } });
        return;
      }
      setLastData(body as AnalyzeResponse);
      setState({ phase: "success", data: body as AnalyzeResponse });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setState({ phase: "error", error: { code: "internal", error: "Network error — check your connection and try again." } });
    }
  }

  function startDemo() {
    if (roster.members.length === 0) setRosterText(DEMO_ROSTER.join("\n"));
    void run({ demo: true });
  }

  function editRoster() {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => rosterRef.current?.focus({ preventScroll: true }), 350);
  }

  function newLink() {
    setUrl("");
    setTouchedUrl(false);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => urlRef.current?.focus({ preventScroll: true }), 350);
  }

  const steps = [
    { label: "Paste link", done: link.ok },
    { label: "Add members", done: roster.members.length > 0 },
    { label: "Analyze", done: state.phase === "success" || loading },
    { label: "Results", done: state.phase === "success" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-5 pb-24 sm:px-8">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <div aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-accent to-[color-mix(in_oklab,var(--accent),#000_25%)] text-[15px] font-bold text-accent-fg shadow-card">
            B
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Boomsquad</span>
        </div>
        <ThemeToggle />
      </header>

      <section className="mx-auto max-w-[760px] pt-10 pb-10 text-center sm:pt-16">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[12.5px] font-medium text-muted backdrop-blur">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden /> Albion Online battle stats
        </p>
        <h1 className="text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[60px]">
          Every kill. Every death.
          <br />
          <span className="bg-gradient-to-b from-fg to-muted bg-clip-text text-transparent">Just your squad.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[540px] text-pretty text-[17px] leading-relaxed text-muted">
          Paste an AlbionBB battle link, add your boomsquad, and get kills, deaths and K/D for that battle only — straight from the official Albion Online data.
        </p>
      </section>

      <ol aria-label="Progress" className="mx-auto mb-6 flex max-w-[760px] flex-wrap items-center justify-center gap-x-2 gap-y-2 text-[13px]">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className={clsx(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors duration-300",
                s.done ? "bg-accent-soft text-accent" : "text-subtle",
              )}
            >
              <span
                className={clsx(
                  "grid size-4.5 place-items-center rounded-full text-[10.5px] transition-all duration-300",
                  s.done ? "bg-accent text-accent-fg" : "border border-line-strong",
                )}
                aria-hidden
              >
                {s.done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              {s.label}
              <span className="sr-only">{s.done ? " (done)" : ""}</span>
            </span>
            {i < steps.length - 1 && <ArrowRight className="size-3.5 text-subtle" aria-hidden />}
          </li>
        ))}
      </ol>

      <div ref={composerRef} className="scroll-mt-6">
        <Card className="mx-auto max-w-[760px] overflow-hidden shadow-float">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setTouchedUrl(true);
              if (canAnalyze) void run();
            }}
            noValidate
          >
            <div className="p-6 sm:p-8">
              <StepLabel n={1} title="Battle link" htmlFor="battle-url" />
              <div className="relative">
                <Link2 className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-subtle" aria-hidden />
                <input
                  id="battle-url"
                  ref={urlRef}
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => setTouchedUrl(true)}
                  placeholder="https://europe.albionbb.com/battles/441346892"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={2048}
                  aria-invalid={touchedUrl && !link.ok && !!url.trim()}
                  aria-describedby="battle-url-help"
                  className={clsx(
                    "h-12 w-full rounded-2xl border bg-surface-2/60 pr-4 pl-11 text-[15px] text-fg placeholder:text-subtle transition-colors focus:bg-surface focus:outline-none focus-visible:outline-none focus:ring-4",
                    touchedUrl && link.error ? "border-danger focus:ring-danger-soft" : "border-line-strong focus:border-accent focus:ring-accent-soft",
                  )}
                />
              </div>
              <div id="battle-url-help" className="mt-2 min-h-5 text-[12.5px]" aria-live="polite">
                {link.ok ? (
                  <p className="flex items-center gap-1.5 text-ok">
                    <Check className="size-3.5" aria-hidden />
                    {REGIONS[link.value.region].label} server · {link.value.battleIds.length === 1 ? `battle ${link.value.battleIds[0]}` : `${link.value.battleIds.length} battles`}
                  </p>
                ) : touchedUrl && link.error ? (
                  <p className="text-danger">{link.error}</p>
                ) : (
                  <p className="text-subtle">Single battle (…/battles/123) or multi-battle (…/battles/multi?ids=…) links from albionbb.com, europe. or east.</p>
                )}
              </div>
            </div>

            <div className="border-t border-line p-6 sm:p-8">
              <StepLabel n={2} title="Squad members" />
              <RosterInput ref={rosterRef} value={rosterText} onChange={setRosterText} roster={roster} />
            </div>

            <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line bg-surface-2/40 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              {demoEnabled ? (
                <button
                  type="button"
                  onClick={startDemo}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-fg disabled:opacity-50"
                >
                  <Sparkles className="size-3.5" aria-hidden />
                  Try with demo data <span className="text-subtle">(fictional)</span>
                </button>
              ) : (
                <span />
              )}
              <Button type="submit" variant="primary" size="lg" disabled={!canAnalyze} aria-busy={loading}>
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Analyzing…
                  </>
                ) : (
                  <>
                    Analyze <ArrowRight className="size-4" aria-hidden />
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div ref={resultsRef} className="scroll-mt-6 pt-14" aria-live="polite" aria-busy={loading}>
        {state.phase === "idle" && <EmptyState />}
        {state.phase === "loading" && <ResultsSkeleton refresh={state.refresh} />}
        {state.phase === "error" && (
          <ErrorState
            error={state.error}
            onRetry={() => void run()}
            onBack={lastData ? () => setState({ phase: "success", data: lastData }) : undefined}
            canRetry={canAnalyze || (link.ok && roster.members.length > 0)}
          />
        )}
        {state.phase === "success" && (
          <Results
            data={state.data}
            onRefresh={state.data.mode === "live" ? () => void run({ refresh: true }) : undefined}
            onEditRoster={editRoster}
            onNewLink={newLink}
          />
        )}
      </div>

      <footer className="mt-24 border-t border-line pt-6 text-[12.5px] leading-relaxed text-subtle">
        Data comes from the official Albion Online game-info API — the same battle data AlbionBB displays. Not affiliated with Sandbox Interactive or AlbionBB. Rosters are processed in memory and never stored.
      </footer>
    </div>
  );
}

function StepLabel({ n, title, htmlFor }: { n: number; title: string; htmlFor?: string }) {
  const Tag = htmlFor ? "label" : "p";
  return (
    <Tag {...(htmlFor ? { htmlFor } : {})} className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
      <span className="grid size-6 place-items-center rounded-full bg-fg text-[12px] font-semibold text-bg tnum" aria-hidden>
        {n}
      </span>
      {title}
    </Tag>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center text-center animate-rise">
      <div className="mb-5 grid grid-cols-3 gap-2 opacity-80" aria-hidden>
        {["K", "D", "K/D"].map((t, i) => (
          <div key={t} className="grid h-16 w-20 place-items-center rounded-2xl border border-line bg-surface text-[13px] font-semibold text-subtle shadow-card" style={{ transform: `translateY(${i === 1 ? -6 : 0}px)` }}>
            {t}
          </div>
        ))}
      </div>
      <h2 className="text-[20px] font-semibold tracking-tight">Your results will appear here</h2>
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
        Stats cover only the battle (or battles) in your link — never lifetime numbers. Kills are killing blows only; assists don’t count.
      </p>
    </div>
  );
}

function ErrorState({ error, onRetry, onBack, canRetry }: { error: AnalyzeError; onRetry: () => void; onBack?: () => void; canRetry: boolean }) {
  const title =
    error.code === "not_found"
      ? "Battle not found"
      : error.code === "invalid_link"
        ? "That link isn’t supported"
        : error.code === "rate_limited"
          ? "Slow down a little"
          : error.code === "upstream_unavailable"
            ? "Albion’s data service is unavailable"
            : error.code === "invalid_input"
              ? "Check your input"
              : "Something went wrong";
  return (
    <Card className="mx-auto max-w-[620px] p-8 text-center animate-rise" role="alert">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-2xl bg-danger-soft">
        <AlertTriangle className="size-5 text-danger" aria-hidden />
      </div>
      <h2 className="text-[19px] font-semibold tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-[460px] text-[14.5px] leading-relaxed text-muted">{error.error}</p>
      <p className="mt-2 text-[12.5px] text-subtle">No statistics were shown because no verified data was retrieved.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {canRetry && !["invalid_link", "invalid_input", "not_found", "demo_disabled"].includes(error.code) && (
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        )}
        {onBack && <Button onClick={onBack}>Back to previous results</Button>}
      </div>
    </Card>
  );
}
