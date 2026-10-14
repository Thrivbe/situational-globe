# Audit lane D: situational-globe /api (28 routes)

Base: `/Users/robinsverd/Thrivbe-AI/lab/situational-globe/src/app/api`, libs in `src/lib`. Read-only audit.

Global: no rate limits and no middleware. `s-maxage` only works if a CF cache rule or Cache API fronts the Worker. Module-level caches are per-isolate. No SSRF found in any route (all upstream hosts hardcoded or allowlisted). No secret echoed in any response.

| route | what it does | risk found (file:line) | verdict | must-fix |
|---|---|---|---|---|
| air-quality | OpenAQ v2 PM2.5 stations | route.ts:15,20-24 no cache; v2 retired | FIX/OFF | s-maxage=900, or OFF (v3 needs a key) |
| aircraft | per-icao24 trace + adsbdb | route.ts:215 hex validated; :222-225 2 upstream calls per distinct hex | FIX | CF cache rule + per-IP WAF limit |
| cloudflare-radar | Radar outages + attack origins | route.ts:75,81,209 `no-store` fetch, s-maxage only on success | FIX | cache 300s incl. errors; Radar:Read-only token |
| conflicts | RSS keywords to conflict zones | route.ts:152-181 dead `require('https')`; :192 no-store; :187 UA spoof | FIX | delete dead block; edge-cache 300s |
| country-risk | editorial risk + USGS quakes | route.ts:60 USGS per request, no header | FIX | s-maxage=300 |
| crypto | CoinGecko 3 prices | route.ts:5-6 only `revalidate`; 429 ban risk | FIX | s-maxage=60; configure OpenNext cache |
| cyber-attacks | Feodo C2 blocklist | route.ts:32-45 per-isolate cache; error branch :52 uncached | FIX | rely on s-maxage=300 at edge |
| cyber-threats | CISA KEV + shadowserver ping | route.ts:12 ~1MB per hit, :41 pointless ping, no cache | FIX | s-maxage=3600; drop ping |
| earthquakes | USGS 2.5 day feed | route.ts:13,49 s-maxage=60 | KEEP | needs CF cache rule |
| fires | NASA FIRMS global CSV + EONET | route.ts:18-30,86 tens-of-MB CSV in Worker (memory/CPU) | OFF | or cron-precomputed KV/R2 snapshot |
| flights | OpenSky + adsb.fi aircraft | route.ts:235-262 OpenSky quota; :413-416 33s sweep; stealthFetch spoof | OFF | or cron-fed KV snapshot |
| frontlines | DeepState GeoJSON | route.ts:11,27 s-maxage=1800 | KEEP | none |
| gdelt (GDACS) | GDACS disaster RSS | route.ts:81 unsanitized `html` from upstream (XSS, `javascript:` link) | FIX | escape link+title or drop `html` |
| gdelt-events | GDELT 15min events | route.ts:17-30 params give distinct cache keys, each fetches+inflates zip; lib/gdeltEvents.ts zlib | FIX | whitelist params; cache by window |
| infrastructure | nuclear sites + USGS overlay | route.ts:153 forced no-store; :9 non-route export | FIX | s-maxage=300; move export out |
| live-news | static YouTube live list | s-maxage=86400 | KEEP | none |
| malware | URLhaus snapshot + geolocation | lib/malware-live.ts:460-465 setInterval, :86,173-211 plaintext ip-api, 20s+ cold | OFF | needs cron+KV rewrite |
| malware/stream | SSE of malware store | route.ts:21-90 unbounded long-lived SSE, setInterval | OFF | none (turn off) |
| maritime | live AIS WebSocket | route.ts:2 `ws`, :100 AIS_API_KEY, globalThis cache | OFF | already off; fix markets self-call |
| markets | Yahoo quotes, 31 symbols | route.ts:107,174,211 up to ~60 subrequests (free cap 50); :276 no-store; :233 self-fetch of /api/maritime | FIX | s-maxage=60; drop maritime self-fetch |
| markets/history | Yahoo OHLC, one symbol | route.ts:82,85 allowlisted; :112 browser max-age only | FIX | add s-maxage=60-300 |
| news | Telegram + 9 RSS merged feed | route.ts:175,216 14 upstream scrapes/RSS, BROWSER_UA spoof :87; :368 per-isolate 60s feed, cold isolate refetches all; nominatim.ts:73,83,114 fs read/write `.cache` (fails on Workers, geocoder key-cache lost); no params | FIX | edge-cache s-maxage>=60 (already set, needs CF rule); drop UA spoof; make nominatim cache fs-optional; confirm t.me scraping is acceptable |
| satellites | CelesTrak ~45 TLE groups + SGP4 | route.ts:117-152 `fs` write/read `.next/cache` at module load (Workers: no fs, cwd undefined); :200 ~45 parallel fetches = over subrequest cap (50 free); :288-319 SGP4 for ~19k sats per request, CPU limit; :243 stealthFetch; :197 cache per-isolate; multi-MB response | OFF | or cron job precomputes JSON to R2/KV and route serves it; drop fs |
| satellites/orbit | one satellite's orbit track | route.ts:76 id validated digits; :22,38-39 reads fs disk cache (always 404 on Workers); :86 `t` clamped +-7d; 180-pt SGP4 cheap; s-maxage=600 | FIX | read TLE from KV/R2 snapshot (shared with satellites); `t` ignored or rounded to avoid cache-busting |
| scm-suppliers | supplier risk vs threats | route.ts:61,75 self-fetch `http://127.0.0.1:3000` (breaks on Workers; also calls /api/fires, the heavy route); :98 no-store; `/api/gdelt` is GDACS, reads `.events` (probably wrong shape) | FIX | s-maxage=300; replace self-fetch with direct upstream or lib calls; do not depend on fires |
| space-weather | NOAA SWPC Kp, alerts, flares | route.ts:11-23 3 upstream per hit, no cache header; no key | FIX | add s-maxage=120 |
| stats | counts of 6 internal feeds | route.ts:44-51 fetches /api/flights, satellites, cctv, weather, infrastructure, gdelt via request origin (self-subrequest chain: pulls flights+satellites = the OFF routes); :32 per-isolate snapshot; maxDuration 60 ignored on Workers; origin from `req.url` (host header spoofable only to own deployment via CF, low) | FIX | compute from cached snapshots/KV or drop flights/sats counts; s-maxage=30 is set, needs CF cache rule |
| weather | EONET + NWS + GDACS events | route.ts:157 cachedSource 3min per-isolate; :167 s-maxage=120; :178,188 stealthFetch (spoofed XFF); NWS UA honest; no params | KEEP | swap stealthFetch for plain fetch; needs CF cache rule |

## Must-fix for the spec

1. Edge caching for every `/api/*` route: a CF cache rule (or Cache API wrapper) that honours `s-maxage`, plus a WAF rate limit per IP. Module-level caches are per-isolate and do not protect upstreams.
2. Turn OFF: maritime, malware, malware/stream, fires, flights. Keep off unless rebuilt as a scheduled-Worker snapshot written to KV/R2.
3. Turn OFF `satellites` as written (fs at module load, ~45 subrequests, 19k SGP4 per request). Rebuild as a cron-written TLE/position snapshot in R2/KV. `satellites/orbit` and `stats` then read from that snapshot.
4. Strip `stealthFetch` UA and X-Forwarded-For spoofing (src/lib/stealthFetch.ts:8-82; used by flights, conflicts, weather, satellites). Use an honest UA. Also remove the browser UA spoof in news (route.ts:87) and conflicts (route.ts:187).
5. Remove all `fs` and `process.cwd()` use: satellites/route.ts:117-152, satellites/orbit/route.ts:22-50, lib/nominatim.ts:73-114. Workers has no writable filesystem.
6. Remove self-fetches: scm-suppliers (`127.0.0.1:3000`), stats (`${origin}/api/...`), markets (`/api/maritime`). Call libs or upstreams directly. Do not let stats/scm-suppliers pull the OFF routes.
7. Fix cache headers: markets (`no-store` to s-maxage=60), markets/history (add s-maxage), infrastructure, scm-suppliers, air-quality, country-risk, cyber-threats, space-weather, cloudflare-radar errors.
8. gdelt-events: whitelist query params (cache-bust amplification). gdelt (GDACS): escape the `html` field.
9. conflicts: delete the dead `require('https')` block. infrastructure: move the `NUCLEAR_FACILITIES` export out of route.ts. Check `src/lib/httpJson.ts`, `gdeltEvents.ts` and `malware-live.ts` (node `https`/`http`/`zlib`) against `nodejs_compat`.
10. cloudflare-radar: Radar:Read-only token or drop the route. air-quality: OpenAQ v2 is retired, so OFF unless migrated to v3.
11. Subrequest budget: markets (about 60), news (14 plus geocoding), and satellites (about 45) all approach or exceed the Workers free-plan 50-subrequest cap. Confirm the paid plan, or snapshot them.
12. Secrets: only CLOUDFLARE_API_TOKEN, OPENSKY_CLIENT_ID/SECRET and AIS_API_KEY exist. None are echoed. Two of those three routes are OFF; set the secrets only for routes kept.
