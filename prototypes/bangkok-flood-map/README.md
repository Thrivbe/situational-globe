# PROTOTYPE: Bangkok flood map (throwaway)

Answers [What does our own Bangkok flood map look like?](https://github.com/Thrivbe/situational-globe/issues/9).
Not production code. No tests, no backend. Our own code; Augma was only a reference for which layers and feeds exist.

## Run

```sh
python3 -m http.server 8791 --bind 127.0.0.1 -d /Users/robinsverd/Thrivbe-AI/.tmp/sg-proto-bangkok
```

Open http://127.0.0.1:8791/prototypes/bangkok-flood-map/?variant=A. Switch with the bottom bar or the arrow keys.
Serve the repo root: the page reuses the MapLibre 6.7.0 worker that Osiris commits under `public/vendor/`.

## Views

| Key | Name | Question it asks |
|---|---|---|
| A | 2D ops board | Is a list-first board (side panel with counts and worst roads, map, radar timeline scrubber, rain chart) the right shape? |
| B | 3D city | Is a map-first 3D view (tilted, extruded buildings, glowing flooded roads, report columns, slow orbit) the right shape? |

Variant C (split 2D/3D) was dropped.

## File layout

| File | Owner | Role |
|---|---|---|
| `feeds.js` | feed coverage | Every endpoint, query, licence and the map `CREDIT` string. Other modules read URLs from here only. Also `fetchOverpass` / `fetchOverpassRaw` (queue, cache, fallback). |
| `osm-snapshot/*.json` | feed coverage | Last-resort copy of the Overpass answers (taken 2026-10-12; transit, piers, parking 2026-10-13), used only when every live Overpass host fails. |
| `data.js` | 2D layers | Fetch and shape the data (`window.__data`). |
| `layers2d.js`, `layers2d.css` | 2D layers | `LAYERS2D` registry, `addLayers2D`, `mountTimeline`, `bindPopups`. |
| `city3d.js` | 3D city | `LAYERS3D` registry, `camera3d`, `addLayers3D`, `startOrbit`. |
| `ui.js`, `style.css`, `index.html` | panels and UI | Entry, side panel, tiles, toggles and legend built from the registries, header, attribution, 2D/3D switch. |

Registry entry shape: `{ key, label, ids:[map layer ids], count?: d => number, legend:[{shape:'line'|'dot'|'swatch', color, label}] }`.

## Live data (all fetched in the browser, all send CORS headers, curl-probed 2026-10-12)

| Feed | Endpoint (key in `FEEDS`) | Format | Licence / credit |
|---|---|---|---|
| Flooded roads | Floodboard `roads.geojson` (`floodRoads`) | GeoJSON, 784 segments, ~380 kB | CC BY 4.0, credit Floodboard, "may be incomplete" |
| Reports | Floodboard `reports.csv` (`floodReports`) | CSV, ~1,050 rows, ~620 kB | CC BY 4.0. Drop rows with `source` = `news` or `social_fb` (they trace to Google News / Facebook) |
| Rain radar | RainViewer `weather-maps.json` (`radar`) | JSON index then PNG tiles, past 2 h, zoom 7 max | Free tier, credit RainViewer |
| River discharge | Open-Meteo Flood API (`riverDischarge`) | JSON, daily m3/s, array per point | CC BY 4.0, free tier non-commercial, credit Open-Meteo |
| Rain forecast | Open-Meteo hourly, past 12 h + next 48 h (`forecast`) | JSON | CC BY 4.0, free tier non-commercial, credit Open-Meteo |
| Rain grid | Open-Meteo 3x3 points (`forecastGrid`) | JSON array of 9, one call | same as above |
| Water level sensors | ThaiWater / HAII `waterlevel_load` (`waterLevel`) | JSON, 805 stations nationwide, ~1.4 MB, 19 in the Bangkok bbox | unconfirmed licence, prototype only; credited as such |
| Hospitals, shelters, pumping, landmarks, fire stations, districts, metro lines, ferry piers, car parks | OSM through Overpass (`hospitals`, `shelters`, `pumping`, `landmarks`, `fireStations`, `districts`, `transit`, `piers`, `parking`) | Overpass JSON | ODbL, credit "© OpenStreetMap contributors" |
| Basemap, roads, canals, water, rail, parks, aeroway, buildings | OpenFreeMap vector tiles (`STYLE`, `vectorTiles`) | MVT | MIT software, ODbL data, credit OpenFreeMap + OpenMapTiles + OSM |

`CREDIT` in `feeds.js` is the full credit string (CC BY 4.0, ODbL wording, links); it is shown in the Sources popover. The line rendered on the map is the shorter `SHORT_CREDIT` in `ui.js`, and MapLibre adds the OpenFreeMap / OpenMapTiles / OpenStreetMap credit from the style. Requirement for the on-map line (ui owns it): Floodboard CC BY 4.0, Open-Meteo CC BY 4.0, RainViewer, ThaiWater/HAII (unconfirmed licence, prototype only) and "© OpenStreetMap contributors (ODbL)". Check `ui.js` for whether the final line carries these.

### Overpass notes

- Bangkok bbox `[100.3, 13.5, 100.95, 14.05]` (Overpass order S,W,N,E: `13.5,100.3,14.05,100.95`). Queries live in `OVERPASS_QUERIES`; sizes: hospitals 251 elements (~110 kB), shelters 127 (~44 kB), pumping 101 (~21 kB), landmarks 422 (~160 kB), fire stations 48 (~21 kB), districts 50 relations with geometry (~860 kB), transit 19 route relations with geometry (~350 kB, `out geom`), piers 263 (~92 kB), parking 199 multi-storey / underground (~62 kB).
- Cache-friendly: the query text is byte-identical every call (fixed bbox, no timestamps), so the HTTP cache and the 24 h `localStorage` cache hit.
- Public Overpass hosts are flaky: `overpass-api.de` had 504s and refused connections after a burst of calls; `overpass.openstreetmap.fr` was dropped from the host list because it sends no CORS header to browsers (403, and the failed fetch logs a console error on every cold cache); `maps.mail.ru` works but takes ~9 s. `fetchOverpass` runs one query at a time (1.5 s gap), tries the two hosts in `OVERPASS_HOSTS` (`overpass-api.de`, then `maps.mail.ru`), then falls back to `osm-snapshot/`. After a full failure it skips live hosts for 2 minutes.
- No area index on the `.fr` host, so no `area(...)` filters. Districts are picked with `admin_level=6` and a Thai name starting `เขต` (50 Bangkok khet).
- From curl, send a descriptive `-A`, otherwise `overpass-api.de` answers 406.

## Coverage of the Augma layer inventory

Layer list taken from the Augma teardown README (names only). Status words:

- **shown**: the page draws it today (A = 2D, B = 3D; checked in the running page 2026-10-13).
- **feed ready, not drawn**: a permitted feed is verified and handed off, but no layer draws it yet. This is not "covered" until a layer ships.
- **deliberately skipped**: a permitted route exists; we chose not to build it.
- **not coverable**: no permitted route (licence, CORS, forbidden source, or needs a backend).

| Augma layer | Our feed | Status |
|---|---|---|
| Flooded roads (`rd`, `rdp`) | Floodboard `roads.geojson` | shown (A, B) |
| Citizen reports (`rep`) | Floodboard `reports.csv`, minus `news` / `social_fb` rows | shown (A, B) |
| Official BMA flooded-road list (`bma`) | Floodboard (it aggregates BMA); BMA direct has no licence | shown via Floodboard only |
| Districts (`dz`) | OSM `districts` (50 khet polygons) | shown (A, B) |
| Rain forecast ("MIGHT RAIN" markers) | Open-Meteo `forecast`, `forecastGrid` | shown in A (3x3 grid + rain chart) |
| Rain radar | RainViewer | shown (A, B) |
| Hospitals (POIs) | OSM `hospitals` | shown (A: H dots; B: pillars with an H badge) |
| Shelters | OSM `shelters` (assembly points, social shelters, community centres) | shown (A: S dots; B: pillars with an S badge); partial: possible gathering sites, not an official evacuation list |
| Pumping stations, sluice / lock gates, weirs | OSM `pumping` | shown (A: P dots; B: pillars with a P badge) |
| Fire / rescue stations | OSM `fireStations` | shown in A (extra, not in Augma) |
| 3D buildings (B has 11 layers: buildings, roads, danger, reports, districts, transit, hospitals, shelters, pumping, parks, radar) | OpenFreeMap `building`, `render_height` | shown in B (sparse heights outside the centre) |
| Parks (3D) | OpenFreeMap `landuse` / `landcover` | shown in B |
| Landmarks (POIs, labels) | OSM `landmarks` (422, via `fetchOverpass('landmarks')`) | shown in A (2D only; layer `landmarks`, labels and popups; not in B) |
| Canal / river level sensors (`fl`, canal level % of bank `wl`) | ThaiWater `waterLevel` (`waterlevel_load`; 19 stations in the Bangkok bbox; % of bank from `waterlevel_msl`, `ground_level`, `min_bank`) | shown in A (layer `waterlevel`, 19 stations, popups). In B only as the "river, % of bank" tile in the side panel (worst station); no 3D sensor columns. Credited "ThaiWater / HAII (unconfirmed licence, prototype only)" in `CREDIT` and in the on-map line |
| Street sensors (BMA street flood sensors, "Street sensor ... cm") | BMA direct only | not coverable: the BMA sensor API has no published licence and BMA direct is outside the permitted list (only allowed as "unconfirmed licence, prototype only", and no CORS-open endpoint was found). Where BMA street depths reach Floodboard they already show as flooded-road depths and depth labels |
| Rain gauges ("Raining now") | Open-Meteo `current` precipitation (`forecast`) and the RainViewer radar | substitute shown in A and B: radar is the "raining now" layer, the rain tile and the 3x3 grid (A) carry the current mm/h. Individual gauge stations (TMD, BMA, ThaiWater rain) are not available as a permitted CORS feed, so there are no gauge dots |
| Danger / warning hex grid (`hx`, `hf`, `tmask`) | Derived in-browser from Floodboard roads + reports and the Open-Meteo grid (not a feed) | shown in A (2D only; layer `danger-grid`, derived cells) |
| 74 HTML text markers ("OVER HEAD 250-400 cm") | Derived in-browser from Floodboard `depthCm` (not a feed) | shown in A (2D only; layer `depth-labels`, derived). B has its own depth columns |
| Avoid (roads to avoid) | Derived from Floodboard `closedAll` / `closedSmall` / `verdict` (not a feed) | shown in A: covered by the roads layer (its red "blocked for a sedan" colour is the avoid layer) plus the worst-roads list and the "districts to avoid" tiles. No separate avoid-only layer, on purpose: it would repeat the roads layer |
| Rail lines (`rail`) | OpenFreeMap `transportation` (class rail, transit) for tiles; OSM metro / sky-train / monorail route relations (`OVERPASS_QUERIES.transit`, snapshot `osm-snapshot/transit.json`, 19 relations) | shown in A (layers `rail`, `transit`) and B (layer `transit`: OSM tiles plus the snapshot lines). Metro lines draw from the committed snapshot, taken 2026-10-13 via maps.mail.ru because overpass-api.de answered 504 (a network failure, not a licence problem); live hosts are tried first |
| Rail stations (`st`) | OpenFreeMap `poi` (class railway); the dark style does not draw it | shown in A (layer `stations`) and B (layers `stations3d`, `stations3d-label`, part of the `transit` entry) |
| Airports (`apt`) | OpenFreeMap `aerodrome_label`, `aeroway` | shown in A (2D only; layers `airports`, `airports-label`) |
| Canals / waterways, water | OpenFreeMap `waterway` (classes canal, river), `water` | shown in A (layer `waterways`: canals, rivers, ferry lines). Not in B: no canal line, only the basemap water |
| Roads (3D) | OpenFreeMap `transportation` | basemap only |
| Boat routes | OpenFreeMap `transportation` (class ferry), tiles | shown in A (layer `waterways`, 4 ferry lines from tiles). Not in B |
| Transport stops, ferry piers | OSM `piers` (`OVERPASS_QUERIES.piers`, 263 elements, ~92 kB: ferry terminals, named piers, ferry stop positions; snapshot `osm-snapshot/piers.json`) | feed ready, handed to layers2d to draw as ferry-pier dots (visible from about z12). Until `LAYERS2D` has a `piers` entry this is NOT covered; at the time of writing no layer draws it. Rail stations are already shown (row above) |
| Bus stops | OSM `highway=bus_stop` | deliberately skipped: a permitted route exists (viewport-bounded Overpass call at z15+, small bbox, same ODbL credit). Not built because a bbox-wide cold load is roughly 10,000+ stops and several MB, and bus stops have little flood value. Vector tiles carry no stop POIs |
| Parking ("free parking" high ground) | OSM `parking` (`OVERPASS_QUERIES.parking`, 199 multi-storey and underground car parks, ~62 kB; snapshot `osm-snapshot/parking.json`). Surface lots skipped: thousands, no flood value | feed ready, handed to layers2d to draw as "P car park" dots. NOT covered until `LAYERS2D` has a `parking` entry; at the time of writing none draws it. OSM has no reliable "free" tag (fee tag sparse), so it is labelled car park / multi-storey, not free parking |
| National flood-extent mass | none: it is an Augma-side aggregate | not coverable as an extent; see the national row below |
| National (whole-Thailand) layers (`nat*`, `ng*`, `nrd`, `nwn`) | Floodboard data is central Thailand | shown: roads and reports render when the camera is zoomed out to Thailand scale (checked at zoom 6: 86 road segments and 1,032 of 1,040 reports rendered). Nothing beyond Floodboard's own coverage |
| Signs (neighbour signs) | Augma user accounts and backend | not coverable: needs accounts and a backend |
| TMD weather warnings | TMD RSS / CAP (`tmd.go.th/api/xml/warning-news`, `/CAP`) | not coverable: answers 200 but sends no `Access-Control-Allow-Origin`, so a browser cannot read it; needs a backend or proxy. The warning-news feed also showed a 2025 pubDate |
| Traffy Fondue reports | Traffy public API | deliberately skipped: unconfirmed licence and personal data in reports; the reports arrive anyway as `source=traffy` rows inside Floodboard |
| iTIC / Longdo traffic and incidents (`SOS`, incidents, traffic) | Longdo event feed | not coverable: forbidden source |
| News headlines | Google News RSS | not coverable: forbidden source |
| Ground photos, AI items (K.A.R.A.), SOS, help requests, accounts, alerts | Augma Firebase backend | not coverable: needs a backend and accounts |
| Live flights (`flt`) | OpenSky | not coverable: CORS only allows opensky-network.org; airplanes.live needs a contact request; both outside the permitted feed list |
| CCTV cams | none | not coverable: no free licence-clean feed (BMA cameras have no terms; Longdo forbidden) |
| Routing (OSRM) | public OSRM demo | not coverable: demo server forbids heavy use and is outside the permitted list |
| Add report, Add sign, Route (panel buttons) | none | not coverable: Add report and Add sign write to the Augma backend (no write access to Floodboard, accounts needed); Route needs a routing engine and the OSRM demo is outside the feed policy |
| SOS counts ("OPEN SOS 88") | none | not coverable: no SOS feed in the permitted list; Augma SOS comes from its own users and the forbidden iTIC / Longdo data |
| Satellite flooded-hectare figures per district, `sat.json` (satellite flood extent) | none | not coverable: Augma-side aggregate built on a backend; no permitted free satellite flood-extent feed |
| Water flow, `flow.json` | Open-Meteo Flood API `river_discharge` (`FEEDS.riverDischarge`, m3/s daily, past 7 + next 14 days, two points: canal cell 13.775,100.525 and Chao Phraya 14.025,100.525; 200, CORS *, CC BY 4.0, covered by the Open-Meteo credit) | shown in A (River discharge card at the top-left of the 2D map, 2 cells; not in B). Augma's own `flow.json` aggregate is not copied; this is the permitted equivalent. GloFAS grid is ~5 km, so it is a river-level indicator, not street flow |
| Transit / water nearby (station flood chips) | Derived in the browser: Floodboard depths plus OSM stations (`transit` / OpenFreeMap station POIs) within 500 m | shown (derived) in A (layer `station-water`, popup "water nearby"); B has its own station chips |
| Current weather tiles (temperature, humidity, wind, UV) | Open-Meteo `forecast` `current=` block (one call, merged so there is no second request) | shown in the side panel; the 50 district-centre rain chips in A use one extra Open-Meteo multi-point call (`loadDistrictRain`) |
| Alerts (`alerts.js`, push / subscribe) | none | not coverable: needs accounts and a backend to send notifications |
| Natural Earth shaded-relief basemap | none (we use OpenFreeMap) | deliberately skipped: cosmetic, the OpenFreeMap dark style replaces it |

## UI notes

- The Sources popover reads `FEEDS` and `CREDIT` from `feeds.js`, plus a hard-coded `SRC` array in `ui.js`. A new feed needs a row in `SRC` and its string in `CREDIT`.
- The Thai toggle translates static labels only. Numbers, road names and live sentences stay as they are.
- District search is a client-side filter over the district names, because Nominatim is not a permitted feed.

## Known gaps

- OSM building heights are thin outside central Bangkok, so 3D looks sparse in the suburbs.
- Floodboard covers central Thailand, not just Bangkok (roads ~770 segments, reports ~1,040 rows after the news / social filter); the views start on the densest cluster inside Bangkok.
- Floodboard "no colour" means no data, not dry.
- First load takes a few seconds (two remote styles + several feeds; Overpass calls are queued).
- Open-Meteo free tier, RainViewer and Floodboard terms are non-commercial or unconfirmed: fine for this throwaway, re-check before any public product.

## Game-like effects (ticket #10)

Open variant B with `?variant=B&fx=0`, `fx=1`, `fx=2`, or `fx=3` for the Today, MapLibre still, MapLibre alive, and three.js game packs. Add `&orbit=0` for a still camera. Reproducible overrides use `&on=key,key&anim=off|move|10hz|raf`.

MapLibre-only effect keys: `shadows-fake`, `water-sheen`, `glow-plus`, `water-ripple`, `glow-pulse`. Lazy-loaded three.js keys: `bloom-real`, `shadows-real`, `water-shader`.

`?fade=1` keeps MapLibre's default 300 ms paint fade (to measure it); without it the fx lab turns the fade off.

Measure (serve the worktree root first, e.g. `python3 -m http.server 8792 --bind 127.0.0.1 -d <repo root>`):

```sh
URL_='http://127.0.0.1:8792/prototypes/bangkok-flood-map/?variant=B&orbit=0' CASES='still' OUT_=fx-results-still.json node prototypes/bangkok-flood-map/measure-fx.mjs
URL_=... CASES='10hz|panning' OUT_=fx-results-moving.json node prototypes/bangkok-flood-map/measure-fx.mjs
```

`CASES` is a regex over case names; one full run is over 10 minutes, so split it. `HEADED=1` shows Chromium. Shots land in `fx-shots/`.

### Results (2026-10-14, Chromium 1148 headless, Apple M2 Max via ANGLE Metal, 1440x900, standalone page, not Osiris)

Raw rows: `fx-results-still.json`, `fx-results-moving.json`, `fx-results-three.json` (three.js rows after the fixes below).
Headless Chromium switched between 60 and 120 Hz between runs, so compare **busy % per repaint**, not raw busy %.

| Case | Main thread busy | Repaints/s | Note |
|---|---:|---:|---|
| No effects, animation off, still | 0.8-2 % | 0 | floor |
| Any single effect, animation off, still (all 8) | 0.8-2 % | 0 | every effect is free when nothing moves |
| Pack 1 "MapLibre still" (fake shadows + water sheen + stronger glow, animate only while moving) | 0.8-2 % | 0 | |
| Pack 0 "Today" (be7e6f6 loop, every frame) | 63 % | 120 | |
| Animation at 10 Hz, any effect or none | 31-35 % | 26-30 | the clock costs, not the effect |
| Same at 10 Hz with MapLibre's 300 ms paint fade on (`fade=1`) | 50 % | 120 | the fade turns "10 Hz" into every frame |
| Panning, no effects | 0.46-0.53 % per repaint | 60-120 | |
| Panning, each single effect | 0.42-0.49 % per repaint | 92-120 | static effects add nothing measurable per frame |
| Panning, pack 3 (all three.js) | 0.61 % per repaint | 120 | three.js render 0.3 ms CPU per frame |
| Real shadows: rebuild on every camera stop | 66-133 ms (318-396 ms at 4x slower CPU) | | a visible hitch each time the map stops |
| 4x slower CPU, pack 0 or pack 3, still | 100 % | 26-32 fps | any every-frame animation pins a slow CPU |

Findings:
1. **Static effects are free.** Fake shadows, water sheen, stronger glow, real bloom and shader water cost nothing while still and ~nothing extra per frame while moving. The cost is how often the map repaints, not what it draws.
2. **One paint change = 2 repaints; one dash-pattern change = 6.** So a 10 Hz animation is ~30-40 repaints/s, not 10. With MapLibre's default 300 ms paint fade it is every frame. This is very likely why the Osiris spike's "10 Hz" glow cost 71 %. Fix in Osiris: style `transition: {duration: 0}` for animated layers, and do not animate `line-dasharray`.
3. **three.js route works** (pinned `three@0.169.0`, one shared renderer, lazy import) and its CPU cost is small (0.1-0.3 ms/frame). GPU time not measured.
4. **Real shadows do not work in this prototype.** Casters are built and placed right (checked with `&shadowdebug=1`, magenta), but no shadow shows on the ground after 3 fixes. Its rebuild hitch (66-133 ms per camera stop, ~400 ms on a slow CPU) is real either way.
5. Bugs fixed during verify: `fx3d.js` used a global `maplibregl` (now imported); the three.js transform mirrored north/south (water drew in the wrong place); the shadow ground was back-face culled; bloom was too thin to see (wider ribbons, quarter-res two-pass blur).
