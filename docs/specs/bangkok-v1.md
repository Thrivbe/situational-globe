# Bangkok v1 build spec (Step 1)

Status: ready to build · Written 2026-10-15 · Ticket: [Write the Bangkok v1 build spec](https://github.com/Thrivbe/situational-globe/issues/15) · Map: [Map: Situational globe](https://github.com/Thrivbe/situational-globe/issues/1)

This file gathers the decisions on the map into one build order. Each section links the ticket that made the decision. Do not re-argue a decision here; if the build shows one is wrong, open an issue on the map. Terms (situation, local map, snapshot, 3D city pack, …) are defined in [`GLOSSARY.md`](../../GLOSSARY.md).

## 1. What Step 1 ships

One public, read-only web app on Cloudflare Workers, no login:

- **The Bangkok flood map**, our own code, at its own page `/bangkok`. 2D ops board and 3D city, on public feeds. It stands on its own: it does not plug into the Osiris globe yet.
- **Osiris, whole**, at `/`, made safe for the public (Robin, 2026-10-15: Step 1 public URL shows the Bangkok map *and* full Osiris). Live ships, camera AI and live streams stay switched off.
- **A refresh Worker** that writes the Bangkok snapshot to R2 every 15 minutes.

Not in Step 1 (Step 2, a later spec): the globe side of situations — the situation marker on the globe, the "Situations" list, the situation panel inside Osiris, `attachFlood(map)`, credits in the Osiris credit line. Step 1 builds the situation folder and snapshot in the shape Step 2 needs, so Step 2 adds only the globe side.

## 2. Architecture

```
browser ──/bangkok, / ──────────────► app Worker (Next.js via OpenNext)
   │                                     ├─ src/middleware.ts allowlist (default-deny /api/*)
   │                                     └─ /api/snapshot/bangkok-flood ──read──► R2 snapshots/
   ├─ map tiles ───────► OpenFreeMap (direct)                                     ▲
   └─ radar tiles ─────► RainViewer (direct)                                     │ write
                                                                                  │
refresh Worker (cron) ── Floodboard, Open-Meteo, Overpass ──► build snapshot ─────┘
both Workers ── errors ──► Sentry project `situational-globe`
```

Viewers never call Floodboard, Open-Meteo or Overpass. Only map tiles and radar tiles go direct ([Bangkok v1 layer list](https://github.com/Thrivbe/situational-globe/issues/14)).

## 3. The situation folder

Decided in [What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6). One situation = one folder: a plain-data settings file plus an optional code module. Keep the settings plain JSON (no functions, no imports) so user-built situations fit later.

```
src/situations/
  bangkok-flood-2026/
    situation.json        # plain data, shape below
    index.ts              # optional code: snapshot builders for this situation's local maps
```

`situation.json` shape (fill in real values; this is the Bangkok one):

```json
{
  "id": "bangkok-flood-2026",
  "title": "Bangkok floods, October 2026",
  "story": "…short plain-text story…",
  "hazard": "flood",
  "status": "live",
  "defaultGlobalLayers": ["radar"],
  "situationLayers": [],
  "fallbackLevel": null,
  "localMaps": [
    {
      "id": "bangkok-flood",
      "name": "Bangkok · flood",
      "bbox": [100.3, 13.5, 100.95, 14.05],
      "feeds": ["floodboard", "open-meteo", "open-meteo-flood", "rainviewer", "osm", "openfreemap"],
      "layers2d": ["…keys from section 6…"],
      "cityPack": { "buildings": "openfreemap", "minZoom": 14 }
    }
  ]
}
```

- `status`: `live` or `past`. A past situation keeps its last snapshot; its refresh stops.
- `fallbackLevel`: used only when a situation has no local maps. Null for Bangkok.
- Local maps are listed by hand. No auto-generated hot spots.
- `defaultGlobalLayers` and `situationLayers` are read only in Step 2; Step 1 stores them.

Write a small validator (zod or a hand check) and run it in a test, so a bad `situation.json` fails the build.

## 4. The snapshot

One JSON file per local map. R2 key: `snapshots/<local-map-id>.json` (here `snapshots/bangkok-flood.json`). Decided in [What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6) and [Bangkok v1 layer list](https://github.com/Thrivbe/situational-globe/issues/14).

```ts
type Snapshot = {
  localMap: string;              // "bangkok-flood"
  situation: string;             // "bangkok-flood-2026"
  builtAt: string;               // ISO time of this build
  feedsAt: Record<string, string>; // ISO time each feed was last fetched OK
  level: 0 | 1 | 2 | 3;          // worst danger-hex level; Step 2 colours the globe marker from it
  credits: { feed: string; text: string; url: string; licence: string; note?: string }[];
  flood: {
    roads: GeoJSON.FeatureCollection;    // Floodboard roads.geojson, clipped to bbox
    reports: GeoJSON.FeatureCollection;  // Floodboard reports.csv → points, news/social_fb rows dropped
    dangerHexes: GeoJSON.FeatureCollection; // derived
    depthPoints: GeoJSON.FeatureCollection; // derived
  };
  weather: {
    current: object;               // Open-Meteo `current` (temp, humidity, wind, UV, precip)
    hourly: object;                // past 12 h + next 48 h rain
    grid: object[];                // 3x3 points
    districtRain: object[];        // 50 district-centre rain chips
    river: object[];               // Open-Meteo Flood API, river discharge
  };
  osm: {                           // refreshed once a day; copied forward between daily runs
    builtAt: string;
    hospitals, shelters, pumping, fireStations, districts, transit, landmarks: GeoJSON.FeatureCollection;
  };
  stationWater: GeoJSON.FeatureCollection; // derived: stations with water within 500 m
};
```

Rules:

- **Derived layers are computed by the refresh job**, not in the browser. Port these prototype functions from `prototypes/bangkok-flood-map/data.js` on branch `prototype/game-like-3d`: `dangerGrid` (hex score and `DG_LEVEL`), `depthPoints` (one label per ~150 m cell, deepest wins), `worst`, `centerOfTrouble`, `stitch` (district rings), `snapToTransit`, and the station-water rule (Floodboard depths within 500 m of a station).
- **Reports filter:** drop rows with `source` = `news` or `social_fb`.
- **Clip to the local map bbox.** No national zoom-out view.
- **Partial failure keeps the last good part.** If one feed fails, copy that part from the previous snapshot and leave its `feedsAt` time unchanged. The page shows "data from <time>" when a part is older than 1 hour.
- **Credits ride the snapshot.** The page renders them from `credits`, never from hard-coded strings.
- Do not put the ThaiWater sensors in the snapshot (held, section 10).

## 5. Refresh Worker

Decided in [Where do the refresh job and the demo run?](https://github.com/Thrivbe/situational-globe/issues/8). A separate small Worker, `workers/refresh/`, own `wrangler.toml`, bound to the same R2 bucket.

- Cron `*/15 * * * *`: Floodboard roads + reports, Open-Meteo forecast/current/grid/district rain, Open-Meteo Flood API. Rebuild derived layers. Write the snapshot.
- Cron `0 3 * * *` (once a day): Overpass queries for the OSM layers. Reuse `OVERPASS_QUERIES` and the bbox from the prototype `feeds.js`. One query at a time, 1.5 s gap, descriptive `User-Agent`, hosts `overpass-api.de` then `maps.mail.ru`. If all fail, keep yesterday's `osm` block.
- Seed: commit the prototype `osm-snapshot/*.json` as the first `osm` block, so the first snapshot is complete even if Overpass is down.
- Loop over every local map in every `live` situation. Skip `past` ones.
- Errors go to Sentry (section 9). Success is silent.

## 6. The Bangkok page (`/bangkok`)

Look decided in [What does our own Bangkok flood map look like?](https://github.com/Thrivbe/situational-globe/issues/9) and [How game-like can the 3D flood city get?](https://github.com/Thrivbe/situational-globe/issues/10). Reference build: `prototypes/bangkok-flood-map/` on `prototype/game-like-3d` @ `085a152`. Rewrite it as typed React/TS inside the app; do not copy the prototype's globals or its browser-side feed calls.

**2D = the ops board (prototype variant A).** List-first side panel: counts, worst roads, layer chips. Radar timeline scrubber. Rain chart. EN/Thai toggle (static labels only). Sources popover. "Around me" (browser geolocation). District search (client-side filter over district names; no Nominatim).

**3D = the tilted city (prototype variant B), night-neon style** (`be7e6f6`), plus **water sheen** (`water-sheen`) and **stronger glow** (`glow-plus`) from the fx lab. Near-black ground, blue-grey buildings that rise on load, neon flooded roads, thin depth pins with rings, danger hexes, smooth orbit, vignette. MapLibre only: no three.js, no fake shadows.

**One page, two views.** A 2D/3D switch on the page. Both views read the same snapshot. Switching does not refetch.

**Buildings:** OpenFreeMap vector tiles, extruded by `render_height` ([Where do the 3D Bangkok buildings come from?](https://github.com/Thrivbe/situational-globe/issues/5)). The 3D city pack loads only in the 3D view, from z14. A "3D city" switch lets weak phones turn it off.

### Layer table

From [Bangkok v1 layer list](https://github.com/Thrivbe/situational-globe/issues/14). Only the Flood group is on at start. 2D-only layers grey out in the chips in the 3D view.

| Group | Layer | Source | 2D | 3D | On at start |
|---|---|---|---|---|---|
| Flood | Flooded roads (incl. blocked = avoid) | snapshot `flood.roads` | yes | yes (neon) | yes |
| Flood | Citizen reports | snapshot `flood.reports` | yes | yes (columns) | yes |
| Flood | Rain radar + timeline | RainViewer tiles (direct) | yes | yes | yes |
| Flood | Danger hexes | snapshot `flood.dangerHexes` | yes | yes (pulsing) | yes |
| Flood | Depth labels | snapshot `flood.depthPoints` | yes | 3D uses depth columns | yes |
| Flood | Rain grid 3x3 + rain chart + district rain chips | snapshot `weather` | yes | panel only | yes |
| Flood | River discharge card | snapshot `weather.river` | yes | no | yes |
| Flood | Weather tiles (temp, humidity, wind, UV) | snapshot `weather.current` | panel | panel | yes |
| Help | Hospitals | snapshot `osm.hospitals` | yes | yes (pillars) | no |
| Help | Shelters (label: possible gathering sites, not official) | snapshot `osm.shelters` | yes | yes (pillars) | no |
| Help | Pumping stations, gates, weirs | snapshot `osm.pumping` | yes | yes (pillars) | no |
| Help | Fire / rescue stations | snapshot `osm.fireStations` | yes | no | no |
| City | Districts (50 khet) | snapshot `osm.districts` | yes | yes | no |
| City | Metro / rail lines + stations | snapshot `osm.transit` + OpenFreeMap | yes | yes | no |
| City | Water near station | snapshot `stationWater` | yes | yes (station chips) | no |
| City | Canals, rivers, boat lines | OpenFreeMap tiles | yes | no | no |
| City | Airports | OpenFreeMap tiles | yes | no | no |
| City | Landmarks | snapshot `osm.landmarks` | yes | no | no |
| 3D only | Buildings, parks | OpenFreeMap tiles | no | yes | 3D city pack |

### Animation budget

From [How does the flood map go into Osiris 2D and 3D?](https://github.com/Thrivbe/situational-globe/issues/7) and [How game-like can the 3D flood city get?](https://github.com/Thrivbe/situational-globe/issues/10). The cost is the animation clock, not the effect.

- Animation is a user setting, **on by default**.
- It stops when the tab is hidden, the 3D view is off, or the city is out of view.
- Paint updates at most 10 Hz. Animated layers set style `transition: {duration: 0}`.
- **No `line-dasharray` animation.** Blocked roads keep a static dash; any pulse is an opacity or width change. (The prototype's moving dashes are dropped for this reason.)
- With animation off and the map still: 0 repaints per second (check in DevTools).

### Polish to fix in the rewrite

From pass 2 of [What does our own Bangkok flood map look like?](https://github.com/Thrivbe/situational-globe/issues/9):

- 2D depth labels must not overlap at city zoom (use symbol collision).
- The open legend must not be cut off.
- Layer chips must be visible without scrolling on a 1440x900 screen.
- In forecast mode the radar scrubber must change the map (or forecast mode hides the scrubber).
- 3D: flooded roads, depth columns and the metro line must not share one colour.
- 3D: depth labels must not overlap.

## 7. Osiris made public

Decided in [Where do the refresh job and the demo run?](https://github.com/Thrivbe/situational-globe/issues/8) and [Which routes are safe to make public?](https://github.com/Thrivbe/situational-globe/issues/13). Full findings with file:line: [`research/public-routes/README.md`](https://github.com/Thrivbe/situational-globe/blob/research/public-routes/research/public-routes/README.md) and its `audit-A..D.md` lane files. Keep Osiris whole: nothing is removed from the code, it is only switched off in the public build.

**Public build switch.** One env var, `PUBLIC_DEMO=1`, set in the app Worker's `wrangler.toml`. Local dev without it behaves as today.

**Switched off** (route 404 + its UI toggle hidden when `PUBLIC_DEMO=1`):
- Live ships, camera AI and live streams ([Where do the refresh job and the demo run?](https://github.com/Thrivbe/situational-globe/issues/8)).
- The 38 OFF routes in the findings: AI/agents, writes/forwards, camera AI/streams, person-lookup OSINT, heavy feeds (fires, flights, satellites, malware, maritime, air-quality).
- Leave the OFF routes' libraries out of the Worker bundle (`lib/sherlock.ts`, `lib/sanctions.ts`, `lib/chainIntel.ts`, `google-libphonenumber`).

**Allowlist.** `src/middleware.ts` returns 404 for any `/api/*` path not on a fixed list. The list = the 8 KEEP routes + the 37 FIX routes from the findings + the new `/api/snapshot/[localMap]`. A FIX route goes on the list only with its fix done. Target: all 45; list any route left off in the PR body.

**The 14 must-fixes** (detail and file:line in the findings, section "Must-fix for the spec"):
1. Default-deny allowlist (above).
2. Edge cache + edge rate limit on every `/api/*` route: Workers Rate Limiting binding keyed on `cf-connecting-ip`; add `s-maxage` where missing.
3. No paid or private key in the Worker env. `ai/overview` loses its Gemini branch. `cloudflare-radar` gets a Radar:Read-only token or goes off.
4. `safeFetch`: no redirect following, response-size cap.
5. `arcgis`: `*.arcgis.com` only, port 443, `redirect: 'manual'`, byte cap, cache by URL+bbox.
6. CCTV catalogue built by the refresh Worker into R2; the public route only reads it.
7. Remove Workers-hostile code: `fs`/`process.cwd()`, self-fetches, module-scope `setInterval`, `stealthFetch` spoofing. Honest User-Agent.
8. `geo` uses `request.cf`; never trust client `X-Forwarded-For`.
9. Input clamps (list in the findings).
10. XSS: escape GDACS `html`; `proxy-tiles` image/protobuf content types only.
11. Public OSM demo servers (Valhalla, OSRM, Photon, Nominatim): Photon-only + edge cache, or hide the feature in the demo.
12. Kept OSINT routes: drop the OFAC check in `ip`/`whois`, drop the `whois` HEAD probe, cache, https source for ip lookups.
13. Stop echoing `err.message`.
14. Verify on a preview deploy (`nodejs_compat` coverage, script size, subrequest counts).

Also from [Where do the refresh job and the demo run?](https://github.com/Thrivbe/situational-globe/issues/8): file caches (`satellites`, `cctv-snapshot`, `nominatim`) move to R2 or the Cache API; in-memory AI rate limits move to the rate-limit binding.

**`/api/snapshot/[localMap]`:** GET only. `localMap` must match an id in a `situation.json` (else 404). Reads `snapshots/<id>.json` from R2. `Cache-Control: public, s-maxage=300`. Under the edge rate limit. No other parameters.

## 8. Hosting and deploy

From [Where do the refresh job and the demo run?](https://github.com/Thrivbe/situational-globe/issues/8).

- Cloudflare Workers, Paid plan ($5/month). Total cost about $5–10/month.
- App Worker: `@opennextjs/cloudflare` 1.20.11, wrangler 4.151, `compatibility_flags = ["nodejs_compat"]`. **Pin `next` to 16.3.8** (master has 16.4.0, which crashes on Workers; see the `cloudflare-api` skill).
- Bundle limit 10 MB (paid). The local build was 2.74 MB gzip before removals.
- One R2 bucket, `situational-globe`, bound to both Workers. Prefixes `snapshots/` and `cctv/`.
- Deploy first to the free `*.workers.dev` address. `globe.thrivbe.com` comes later, after Robin looks at it.

## 9. Errors

Both Workers report errors to a new Sentry project `situational-globe` (org `thrivbe`) with `@sentry/cloudflare`. The DSN is a Worker secret (`wrangler secret put SENTRY_DSN`). Success stays silent: Workers cannot reach the kernel notifications feed, which the cron rule allows. A refresh run where every feed fails is an error; one failed feed is a warning.

## 10. Credits and licences

From [Which public Bangkok flood feeds can we use?](https://github.com/Thrivbe/situational-globe/issues/4).

- Credits come from the snapshot and show on the page: Floodboard (CC BY 4.0, "may be incomplete"), Open-Meteo (CC BY 4.0), RainViewer, "© OpenStreetMap contributors (ODbL)", OpenFreeMap / OpenMapTiles. The Sources popover shows the full text and links.
- The demo stays free and ad-free. Open-Meteo, RainViewer and TMD free tiers are non-commercial.
- Never use: Google News RSS, Longdo/iTIC feeds, Google 3D Tiles, Augma code, data, branding or design.
- Floodboard "no colour" means no data, not dry. Say so in the legend.

## 11. Held and out of scope

Held for later (fog on the map):
- ThaiWater water level sensors: no licence. Ask HAII.
- Ferry piers, car parks: feeds ready, not drawn (v1.1).
- Bus stops: low flood value, large data.
- Real bloom, shader water, real cast shadows (three.js).
- Not coverable: TMD warnings, BMA street sensors, Traffy direct, Longdo/iTIC, Google News, CCTV for Bangkok, routing, SOS/signs/alerts/accounts, satellite flood extent, live flights.

Out of scope: Step 2 (globe side, section 1), rebuilding live ships / camera AI / live streams for Workers ([Rebuild live ships, camera AI and live streams for Cloudflare](https://github.com/Thrivbe/situational-globe/issues/12)), situations people build together, a "3D city" button instead of the zoom rule.

## 12. Done when

- [ ] `situation.json` for Bangkok passes the validator in a test.
- [ ] The refresh Worker writes `snapshots/bangkok-flood.json` to R2 every 15 minutes; OSM refreshes once a day; one failed feed keeps the last good part.
- [ ] Unit tests for the ported derived functions (danger hexes, depth points, station water) against a fixed Floodboard sample.
- [ ] `/bangkok` loads on `*.workers.dev` in 2D and 3D, with only Flood layers on, credits from the snapshot, and no browser call to Floodboard, Open-Meteo or Overpass (check the Network tab).
- [ ] With animation off and the map still: 0 repaints per second.
- [ ] The polish list in section 6 is done.
- [ ] `/` shows Osiris with the off features hidden; every `/api/*` path not on the allowlist returns 404.
- [ ] No paid key in either Worker's env or secrets (except `SENTRY_DSN` and a Radar:Read token if kept).
- [ ] Edge rate limit answers 429 under a burst from one IP.
- [ ] A thrown test error in each Worker shows up in Sentry `situational-globe`.
- [ ] Must-fix 14 checks pass on the preview deploy.

## 13. Open points

None that block the build. Tasks to do before or during it:
- Create the Sentry project `situational-globe` and the R2 bucket (needs Cloudflare and Sentry access).
- Bangkok building height coverage is still unmeasured ([Where do the 3D Bangkok buildings come from?](https://github.com/Thrivbe/situational-globe/issues/5)). If the suburbs look too flat, Overture is the fallback; it does not block v1.
