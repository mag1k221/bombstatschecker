# Boomsquad — Albion Online battle K/D tracker

Paste an AlbionBB battle link and your squad roster → get kills, deaths and K/D per member and for the whole squad, **for that battle only**.

## Verified data access (investigated Oct 2026)

| Option | Result |
| --- | --- |
| AlbionBB public API | None documented. |
| AlbionBB page HTML / embedded data | `albionbb.com` and its subdomains answer server-side requests with a Cloudflare bot challenge (HTTP 403 “Just a moment…”). Scraping it would mean bypassing that protection, so **this app does not fetch AlbionBB at all**. |
| **Official Albion Online game-info API** (used) | AlbionBB battle IDs are the official battle IDs. Cross-checked: `albionbb.com/battles/1407921257` shows 14 kills / 26 players with yamoonm 2 kills and KaydenSw 2 kills / 1 death. `gameinfo.albiononline.com/api/gameinfo/events/battle/1407921257` returns exactly the same 14 events, and the app reproduces those numbers. |

Endpoints used (read-only, no key needed):

- `GET {base}/battles/{id}`: battle summary (start/end time, `totalKills`, players). Returns 404 for an unknown battle.
- `GET {base}/events/battle/{id}?offset={n}&limit=51`: kill events. Observed limits: `limit ≤ 51`, `offset ≤ 1000` (HTTP 400 beyond them).

AlbionBB host → API base:

| AlbionBB | Game server | API base |
| --- | --- | --- |
| `albionbb.com`, `www.albionbb.com` | Americas (West) | `https://gameinfo.albiononline.com/api/gameinfo` |
| `europe.albionbb.com` | Europe | `https://gameinfo-ams.albiononline.com/api/gameinfo` |
| `east.albionbb.com` | Asia (East) | `https://gameinfo-sgp.albiononline.com/api/gameinfo` |

Supported links: `https://<host>/battles/<id>` and `https://<host>/battles/multi?ids=<id>,<id>,…` (up to 10 battles). Player, guild and alliance pages are rejected because they show lifetime data.

## Statistics rules

- Nicknames are trimmed, NFC-normalized and lower-cased for matching. Matching is exact; there is no fuzzy matching. Duplicates are removed, keeping the first spelling.
- **Kill** = the member is the event’s `Killer` (killing blow). `Participants` (assists) are never counted. **Death** = the member is the event’s `Victim`.
- Events are deduplicated by `EventId`, including across overlapping pages and across battles in a multi link.
- Overall kills and deaths are sums over matched members. Overall K/D = total kills ÷ total deaths (a ratio of sums).
- K/D is shown to 2 decimals, `∞` when deaths = 0 and kills > 0, and `—` when both are 0.
- **Matched** = the nickname appears anywhere in the battle data: the summary player list, killers, victims, participants or group members. So a member can be matched with 0 kills.
- **Friendly fire**: if one roster member kills another, it counts normally and is also listed and badged separately.
- **Completeness**: a battle is *partial* when any of these happens: an events page failed after retries, the API offset cap was reached, records were malformed, the summary was unavailable, or fewer events were retrieved than the summary’s `totalKills`. When the dataset is partial, every row is flagged, and “not found” is shown as inconclusive.

## Architecture

```
src/lib/source/   data-source integration (no statistics)
  url.ts            strict AlbionBB link parser/allow-list
  regions.ts        fixed host → official API mapping (SSRF defense)
  http.ts           JSON client: HTTPS allow-list, no redirects, timeout, size cap, retry/backoff, throttle
  albion-api.ts     summary + paginated events adapter, normalization
  albion-source.ts  per-battle loading, completeness assessment, TTL cache, merge
  demo.ts           fictional demo dataset (explicit opt-in only)
src/lib/stats/    pure statistics (no I/O): roster.ts, kd.ts, compute.ts, csv.ts
src/lib/server/   analyze.ts orchestration, rate limiter, TTL cache
src/app/api/analyze/route.ts   POST endpoint
src/components/   UI (Analyzer, RosterInput, Results, ThemeToggle, ui primitives)
tests/            Vitest suites
```

Security and robustness:
- Upstream hosts are constants, and the user link only supplies a validated numeric ID.
- Redirects are refused. Each request has a 20 s timeout and a 16 MB response cap.
- Retries cover 429/5xx and honor `Retry-After`. Upstream requests are spaced globally (200 ms by default), and only ≤3 pages are fetched concurrently.
- The request body is limited to 64 KB, the roster to 500 names (32 characters each), and uploads to 256 KB of `.txt`/`.csv`.
- Uploaded files are read in the browser as plain text and turned into an editable list. They are never uploaded, executed or stored. The server only receives nickname strings and never logs them.
- CSV export guards against formula injection.
- Analyses are rate-limited per IP (12/min by default).
- Battle data is cached for 10 min when complete and 60 s when partial. **Refresh data** bypasses the cache.

## Setup

Requirements: Node 20+ (tested on Node 24).

```bash
npm install
cp .env.example .env.local   # optional — all variables have defaults
npm run dev                  # http://localhost:3000
npm test                     # 49 tests
npm run build && npm start   # production
```

Environment variables (all optional, none secret):

| Variable | Default | Purpose |
| --- | --- | --- |
| `ALBION_API_CONTACT` | — | Contact appended to the upstream User-Agent |
| `ALBION_API_MIN_INTERVAL_MS` | `200` | Minimum spacing between upstream requests |
| `BATTLE_CACHE_TTL_SECONDS` | `600` | Cache lifetime for complete battles |
| `ANALYZE_RATE_LIMIT_PER_MINUTE` | `12` | Per-IP analyses per minute |
| `NEXT_PUBLIC_ENABLE_DEMO` | `true` | Set `false` to remove demo mode (build-time) |

## Deploy

- **Vercel**: import the repo, choose the Next.js preset, and set env vars if needed. The API route uses the Node runtime with `maxDuration = 120`, so very large battles may need a plan that allows it.
- **Any Node host / Docker**: run `npm ci && npm run build && npm start` behind a reverse proxy. The proxy must set `X-Forwarded-For` so the rate limit works.
- The cache and rate limiter are in-memory per instance. For multi-instance deployments, swap `TtlCache`/`RateLimiter` for Redis.

## Known limitations

1. **API pagination cap**: the official events endpoint only pages to offset 1000, so at most 1,051 kill events per battle are retrievable. Larger battles are marked **Partial** with an explanation. Split huge fights into AlbionBB multi-battle links when possible.
2. **Summary vs events gaps**: the official API sometimes returns slightly fewer events than its own `totalKills` (e.g. battle 441346892: 569 reported, 566 retrievable). The app reports this as partial instead of hiding it.
3. AlbionBB-only features (its own merged/filtered views, custom battle groupings beyond `multi?ids=`) are not reproduced. Only battle IDs from the link are used.
4. Results reflect what the official API returns at retrieval time. A battle that is still in progress can change, so use **Refresh data**.
5. Not affiliated with Sandbox Interactive or AlbionBB.
