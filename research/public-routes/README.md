# Which routes are safe to make public?

Ticket: https://github.com/Thrivbe/situational-globe/issues/13 · Audited 2026-10-14 against master `58bf942`. Read-only code review, four parallel lanes. Nothing was deployed, so Workers-compatibility notes are unverified until a preview build runs.

Scope: 83 `src/app/api/**/route.ts` handlers. The public demo is read-only, no login, on Cloudflare Workers, with live ships, camera AI and live streams off (per "Where do the refresh job and the demo run?", #8).

## Result in one line

**Default-deny.** Of 83 routes, 38 go OFF, 37 need a FIX, and 8 are safe as they are. Only routes on an explicit allowlist answer in the public build; everything else returns 404.

## Verdict tally

| Lane | Routes | OFF | FIX | KEEP | Detail |
|---|---|---|---|---|---|
| A. AI, agents, writes | 21 | 18 | 2 | 1 | [audit-A.md](audit-A.md) |
| B. Proxies, CCTV, geo | 16 | 4 | 9 | 3 | [audit-B.md](audit-B.md) |
| C. OSINT | 18 | 9 | 8 | 1 | [audit-C.md](audit-C.md) |
| D. Data feeds | 28 | 7 | 18 | 3 | [audit-D.md](audit-D.md) |
| **Total** | **83** | **38** | **37** | **8** | |

Overrides of the lane files (made while merging):
- `oi/trending`: OFF with the rest of `oi/*` (lane A said FIX-or-OFF).
- `air-quality`: OFF (OpenAQ v2 is retired; v3 needs a key).
- `weather`: FIX, not KEEP (it uses `stealthFetch`, see must-fix 7).

KEEP as is: `health`, `cctv/texas/snapshot`, `proxy-tiles`, `radar`, `osint/cve`, `frontlines`, `live-news`, `earthquakes` (the last three still need the edge-cache rule in must-fix 2, which every route gets).

## OFF in the public build

- **AI and agents (spend, state, long streams):** `ai/analyze`, `ai/briefing`, all of `oi/*` (`oi`, `assist`, `identify`, `models`, `runs`, `runs/[id]`, `ask`, `events`, `inject`, `trending`), `mcp`.
- **Writes and forwards:** `sdk/ingest`, `sdk/stream`, `github-webhook`, `entity/expand`, `scanner`.
- **Camera AI and streams:** `cctv/frame`, `cctv/proxy` (open redirect-following fetcher that returns attacker-chosen content types from our origin), `cctv/resolve`, `cctv/stream-status`.
- **Person lookup and enumeration (operator, GDPR and reputation risk):** `osint/crypto`, `fingerprint`, `github`, `hudsonrock`, `leaks`, `phone`, `sanctions`, `sweep`, `username`.
- **Too heavy for a request on Workers:** `fires` (tens-of-MB CSV), `flights`, `satellites` (fs at module load, ~45 fetches, SGP4 on ~19k sats), `malware`, `malware/stream`, `maritime` (already off), `air-quality`.

## Must-fix for the spec

1. **Route allowlist, default-deny.** No middleware exists today, so a route nobody remembers stays public. Add `src/middleware.ts` that returns 404 for any `/api/*` path not on a fixed list, and also drop the OFF routes and their libs (`lib/sherlock.ts`, `lib/sanctions.ts`, `lib/chainIntel.ts`, `google-libphonenumber`) from the Worker bundle. `oi/*` is gated by `OI_DISABLED === '1'` (`lib/oi/service.ts:23-25`), which fails open; the allowlist replaces it.
2. **Edge cache + edge rate limit on every `/api/*` route.** Every in-code limiter (`lib/ssrf-guard.ts:219-233`, plus per-route copies) is a per-isolate `Map` and does not bind on Workers. Use a Cloudflare rate-limiting rule (or the Workers Rate Limiting binding) keyed on `cf-connecting-ip`, and a cache rule that honours `s-maxage`. Add `s-maxage` where missing (markets, markets/history, infrastructure, scm-suppliers, country-risk, cyber-threats, space-weather, cloudflare-radar errors, chain/daily, oi/trending if ever kept).
3. **No paid or private key in the Worker env.** Never set `GEMINI_API_KEY_*`, `SCANNER_URL/KEY`, `SDK_INGEST_KEY`, `GITHUB_WEBHOOK_*`, `INTEL_URL`, `AIS_API_KEY`, `OPENSKY_*`, `ETHERSCAN_API_KEY`, `HELIUS_API_KEY`. `ai/overview` must lose its Gemini branch (`ai/overview/route.ts:331-338`) and run the heuristic only. `cloudflare-radar` gets a Radar:Read-only token or goes OFF.
4. **`safeFetch` (`lib/ssrf-guard.ts:184-215`): no redirect following** (or re-apply the caller's host allowlist on every hop) and a response-size cap. Today it re-checks only private ranges, so any allowlisted host with an open redirect reaches any public URL.
5. **`arcgis ?service=`:** hosts `*.arcgis.com` only, port 443, `redirect: 'manual'`, byte cap, cache by URL+bbox. Otherwise OFF (`arcgis/route.ts:253-301`).
6. **Heavy feeds move to the cron Worker → R2** (the refresh job decided in #8): the CCTV catalogue (no upstream fan-out from a public request, `cctv/route.ts:947-958`), and later satellites/fires if wanted. Public routes only read the snapshot.
7. **Remove Workers-hostile code:** all `fs`/`process.cwd()` (`satellites`, `satellites/orbit`, `lib/nominatim.ts:73-114`, `lib/cctv-snapshot.ts`), self-fetches (`scm-suppliers` → `127.0.0.1:3000`, `stats` → its own `/api/*`, `markets` → `/api/maritime`), module-scope `setInterval`, and `stealthFetch` UA/X-Forwarded-For spoofing (`lib/stealthFetch.ts`, used by flights, conflicts, weather, satellites, flight-route; plus browser-UA spoofs in news and conflicts). Use an honest User-Agent.
8. **`geo`:** use Cloudflare `request.cf` instead of three third-party IP lookups; stop trusting client-written `X-Forwarded-For` (`ssrf-guard.ts:298-305`, also `sweep`).
9. **Input clamps:** sentinel (radius 0.1-5, days 1-90, lat/lng bounds), directions (`via` ≤ 3), geosearch (`q` ≤ 80 chars), flight-route (`^[A-Z0-9]{2,8}$`, `^[0-9a-f]{6}$`), region-dossier (lat/lng bounds, NaN → 400), gdelt-events (allowlist params), shodan (public IP only), chain/daily (ignore `refresh`, clamp `days`), ai/overview (64 KB body cap).
10. **XSS:** `gdelt` (GDACS) passes unsanitised upstream `html` (`gdelt/route.ts:81`); escape link and title or drop the field. `proxy-tiles`: `redirect:'manual'` and image/protobuf content-type only.
11. **Public OSM demo servers** (Valhalla, OSRM, Photon, Nominatim) will ban our shared Cloudflare egress. Directions, geosearch, geo/reverse and region-dossier must use Photon-only plus edge cache, a self-hosted router, or be hidden in the demo.
12. **OSINT routes kept (bgp, certs, dns, ip, mac, shodan, threats, whois):** drop the OFAC check in `ip` and `whois` (7 MB CSV per cold isolate), drop the `whois` HEAD probe to the user's domain, cache `threats` and per-domain lookups, swap plain-HTTP ip-api for an https source.
13. **Stop echoing `err.message`** in kept routes (arcgis, geo, and the OSINT routes listed in lane C).
14. **Verify on a preview deploy:** `nodejs_compat` covers `node:dns/promises`, `node:https`, `zlib`; script size after removals; subrequest counts (markets ~60, news ~14) against the plan limit.

No SSRF into private networks was found in any kept route, and no route echoes a secret.
