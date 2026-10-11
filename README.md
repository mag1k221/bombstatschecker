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

## Weapons and roles

- **Weapon (data from the game):** each kill event in the official API includes the gear of the killer, the victim, the participants and the killer’s group members. For each member, the app counts how many distinct events show them with each main-hand item. The weapon used most often is shown, with tiers and enchants of the same weapon counted together, and ties go to the most recent. Other weapons the member swapped to are listed as “+N swaps”. This is the same gear AlbionBB shows next to each player.
- **Weapon names** come from the game’s item data (`src/lib/weapons/catalog.generated.json`). To refresh it after a patch, run `node scripts/build-weapon-catalog.mjs`, which reads [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps).
- **Icons** are loaded by the browser from the official render service: `https://render.albiononline.com/v1/item/{ITEM}.png`.
- **Role (inferred, not reported by the game):** Tank, Healer, Support, Melee DPS or Ranged DPS, decided by the weapon line plus a few per-weapon exceptions. Edit `src/lib/weapons/roles.ts` to match your guild’s comp. A member with no observed gear shows as *Unknown*. This happens when the member only appears in the battle summary and never in a kill event.
- The **By role** card shows members, kills, deaths and K/D for each role. As everywhere else, K/D is a ratio of sums.

## Combat stats, regear, Discord, saved rosters

- **Damage / Healing / Avg IP / Kill fame:** damage and healing come from the `Participants` of each kill event (`DamageDone`, `SupportHealingDone`), summed once per distinct event. They only cover damage/healing that contributed to a kill, not the whole fight. The killing blow alone is not reported as damage. Avg IP is the mean of the item power reported for the member across those events. Kill fame comes from the battle summary.
- **Regear calculator:** for every squad death, the victim’s gear (main hand, off hand, head, armor, shoes, cape, bag, mount; potions and food excluded) is priced with the lowest recent sell order from the [Albion Online Data Project](https://www.albion-online-data.com/) for the same server (`west.` / `europe.` / `east.albion-online-data.com`). You can pick one city or the cheapest of all royal cities plus Brecilien, and choose whether to include mounts. Prices older than 7 days or equal to 0 are ignored. If the exact quality has no price, the nearest quality is used and marked with an amber tag. Items without a price are flagged and not counted. The server proxies these lookups through `POST /api/prices`, spaces requests 400 ms apart, keeps URLs under 3,800 characters, and caches rows for 10 minutes. The Data Project asks for ≤180 requests/min, and its prices are crowdsourced, so treat totals as estimates. Pricing is disabled in demo mode.
- **Copy for Discord:** copies a Markdown summary (K/D, kills, deaths, regear total, a code-block table of members). It is trimmed to fit Discord’s 2,000-character message limit.
- **Shareable links:** **Share link** creates a short link like `/s/XH4r4mis`. **Copy for Discord** includes it too. Opening the link fills the form and re-runs the analysis with fresh data, and `#regear` opens straight to the regear page. Only the canonical battle link and the nickname list are stored, in Upstash Redis, for `SHARE_TTL_DAYS` (default 180). The same battle + roster always gets the same id. If no store is configured, the app falls back to a long self-contained link (`/?b=eu.441346892&m=Name1~Name2`, compressed into `z=` for big rosters). Demo results aren't shareable.
  - **Setup on Vercel (free):** Project → **Storage** → **Create** → **Upstash for Redis** (Marketplace) → connect it to this project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Then redeploy. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work.
- **Regear page:** results have two pages, **K/D & stats** and **Regear**, kept in the URL hash, so the browser Back button works. The stats page shows a small regear-total card that links to it.
- **Saved rosters:** stored only in the browser’s `localStorage` (`boomsquad.rosters.v1`, up to 40 rosters, each up to 500 members). Click a chip to load a roster. Saving with an existing name replaces that roster.

## Architecture

```
src/lib/source/   data-source integration (no statistics)
  url.ts            strict AlbionBB link parser/allow-list
  regions.ts        fixed host → official API mapping (SSRF defense)
  http.ts           JSON client: HTTPS allow-list, no redirects, timeout, size cap, retry/backoff, throttle
  albion-api.ts     summary + paginated events adapter, normalization
  albion-source.ts  per-battle loading, completeness assessment, TTL cache, merge
  demo.ts           fictional demo dataset (explicit opt-in only)
src/lib/weapons/  item catalog, main-hand resolution, weapon → role mapping
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
npm test                     # 54 tests
npm run build && npm start   # production
```

Environment variables (all optional, none secret):

| Variable | Default | Purpose |
| --- | --- | --- |
| `ALBION_API_CONTACT` | — | Contact appended to the upstream User-Agent |
| `ALBION_API_MIN_INTERVAL_MS` | `200` | Minimum spacing between upstream requests |
| `BATTLE_CACHE_TTL_SECONDS` | `600` | Cache lifetime for complete battles |
| `ANALYZE_RATE_LIMIT_PER_MINUTE` | `12` | Per-IP analyses per minute |
| `PRICES_RATE_LIMIT_PER_MINUTE` | `20` | Per-IP market price lookups per minute |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | — | Upstash Redis for short share links (added by the Vercel integration) |
| `SHARE_TTL_DAYS` | `180` | How long short links stay valid |
| `SHARE_RATE_LIMIT_PER_MINUTE` | `30` | Per-IP short links created per minute |
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
5. Damage/healing only cover kill events (see above), so support players who never touched a kill show 0.
6. Market prices are crowdsourced and may be missing or stale; regear totals are estimates.
7. Not affiliated with Sandbox Interactive or AlbionBB.
