# Situations on the Osiris globe — build spec (Step 2)

Status: ready to build after Step 1 · Written 2026-10-15 · Ticket: [Write the Step 2 build spec (situations on the Osiris globe)](https://github.com/Thrivbe/situational-globe/issues/17) · Map: [Map: Situational globe](https://github.com/Thrivbe/situational-globe/issues/1)

This file gathers the globe-side decisions into one build order. Each section links the ticket that made the decision. Do not re-argue a decision here; if the build shows one is wrong, open an issue on the map. Terms (global map, situation, open situation, past situation, situation panel, local map, snapshot, 3D city pack) are defined in [`GLOSSARY.md`](../../GLOSSARY.md).

Small build choices that no ticket made are marked **(spec choice)**. They follow from the decisions, need no new decision, and can change in review. Section 12 lists them in one place.

## 1. What Step 2 ships

Step 1 ([`bangkok-v1.md`](bangkok-v1.md), from [Write the Bangkok v1 build spec](https://github.com/Thrivbe/situational-globe/issues/15)) ships the Bangkok map at `/bangkok`, safe public Osiris at `/`, the situation folder, the snapshot and the refresh Worker. **Build Step 1 first.**

Step 2 adds only the globe side, inside Osiris at `/`:

- A **situation marker** on the global map for every situation, coloured from its snapshot level.
- A **"Situations" list** next to the search, and a **local-map outline switch**.
- **Open one situation at a time.** Its layers, situation panel and credits turn on. **"Back to world"** turns them off.
- **`attachFlood(map, { mode })`**: the Bangkok flood layers inside Osiris, 2D and 3D, with the z12 handover and Osiris's own `carto` buildings.
- The **animation budget** inside Osiris.

Osiris stays whole ([Map: Situational globe](https://github.com/Thrivbe/situational-globe/issues/1), standing rule). Situations sit next to the existing OSINT features. No Osiris feature is removed.

`/bangkok` stays as it is, as a standalone page **(spec choice)**. It gets one "Open on the globe" link to `/?situation=bangkok-flood-2026`.

## 2. How Osiris takes a plug-in

From [How does Osiris build its layers and panels?](https://github.com/Thrivbe/situational-globe/issues/3) (file:line in [`research/osiris-layers.md`](https://github.com/Thrivbe/situational-globe/blob/research/osiris-layers/research/osiris-layers.md)) and [How does the flood map go into Osiris 2D and 3D?](https://github.com/Thrivbe/situational-globe/issues/7) (wiring proven on `spike/flood-in-osiris` @ `dfda78e`).

- Osiris has no layer registry. Do **not** add layers to the 3.4k-line `map.on('load')` handler in `OsirisMap.tsx`.
- Plug in with self-contained attach modules, like `lib/oi/globe.ts` `attachOi(map)`: each adds its own sources and layers, returns a handle, and cleans up in `destroy()`. Wire each from one `useEffect` in `OsirisMap.tsx`.
- All new source and layer ids start with a fixed prefix: `situations-` for the globe side, `flood-` for the flood set. Insert layers before `day-night-fill`.
- The spike's `activeLayers.flood_bkk` boolean is replaced by the open-situation state (section 5). The spike's other wiring (the two `OsirisMap.tsx` effects, `setMode` on projection change) is the reference shape.

New files **(spec choice)**:

```
src/lib/situations/
  registry.ts          # imports every src/situations/*/situation.json; the validator from Step 1
  attachSituations.ts  # markers + local-map outlines on the global map
  credits.ts           # credit-line source for the open situation
src/lib/flood/
  attachFlood.ts       # flood set inside Osiris; reuses the Step 1 layer builders
src/components/
  SituationsList.tsx
  SituationPanel.tsx
```

## 3. Changes to the situation folder and snapshot

The folder and snapshot shapes come from [What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6) and Step 1 sections 3–4. Step 2 adds:

- **`marker: [lng, lat]`** in `situation.json`, optional **(spec choice)**. If it is missing, the marker sits at the centre of the first local map's `bbox`. It is required when `localMaps` is empty (such a situation has no bbox). Add the rule to the Step 1 validator.
- **A situations index in R2** **(spec choice)**. After each run, the refresh Worker writes `situations/index.json`:

  ```ts
  type SituationsIndex = { situation: string; localMap: string; level: 0 | 1 | 2 | 3 | 4; builtAt: string }[];
  ```

  This lets the globe colour every marker with one small read. It does not load the full snapshots.
- **`situationLayers`** stays read-only and unused. Bangkok has none, and Step 2 builds no loader for them. The validator fails if the list is not empty, so nobody adds one before a loader exists. El Niño (case 2) adds the loader.

## 4. On the global map

From [What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6).

### Situation markers

- **One marker per situation**, with a hazard icon. Draw the icon once per hazard with `map.addImage` (flood: the lucide `Waves` shape) **(spec choice)**.
- **Colour = worst level** of the situation's local maps in `situations/index.json`. Use the danger-hex level colours from the Step 1 layer code, so the marker and the hexes read the same. A situation with no local maps uses `fallbackLevel`.
- **Past situations are grey.** They stay on the map. Their last snapshot stays viewable; their refresh has stopped (Step 1 section 5).
- The marker layer is clickable: add its id to `CLICKABLE_LAYERS` and add a `map.on('click', …)` handler, as for the other Osiris layers. A click opens the situation (section 5).
- Markers show below z9 only **(spec choice)**. Past z9 the local-map data takes over.

### "Situations" list

- A **"Situations" button next to the search** opens a small list. Live situations come first, then past ones (greyed). Each row: hazard icon, title, level colour, `builtAt` age.
- Picking a row opens the situation, the same as a marker click.
- On mobile, the list is one more entry in the existing search tab (`mobilePanel = 'search'`) **(spec choice)**.

### Local-map outline switch

- A switch that shows the outline of every local map's `bbox`. **Off at start.**
- It lives in a new "Situations" group in `LayerPanel` `LAYER_GROUPS`, next to a "Situation markers" switch that is on at start **(spec choice)**. This keeps the spike's "Situations" group from [How does the flood map go into Osiris 2D and 3D?](https://github.com/Thrivbe/situational-globe/issues/7), but it holds view switches only. Opening a situation happens from the marker or the list.

### Data for the global map

- New public route **`/api/situations`**, GET only, no parameters. It returns the registry entries (id, title, hazard, status, marker, local-map ids and bboxes) merged with the levels from `situations/index.json`. `Cache-Control: public, s-maxage=300`. Under the Step 1 edge rate limit. Add it to the `src/middleware.ts` allowlist.
- Osiris fetches it once at mount, with its existing `fetchEndpoint` pattern (`page.tsx` ~L944).

### Rain radar as a global layer

The Bangkok `situation.json` lists `defaultGlobalLayers: ["radar"]`, and Osiris has no rain radar layer today. Add one: RainViewer raster tiles, world-wide, key `rain_radar` in `activeLayers`, off at start, entry in the "Weather" group of `LayerPanel`, before `day-night-fill` **(spec choice)**. RainViewer is cleared for non-commercial use with credit ([Which public Bangkok flood feeds can we use?](https://github.com/Thrivbe/situational-globe/issues/4)). Reuse the Step 1 radar tile code. Map `"radar"` in `defaultGlobalLayers` to the `rain_radar` key.

## 5. Open situation

From [What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6).

**State.** `page.tsx` holds `openSituation: string | null`. Only one situation is open at a time. Opening a second one closes the first.

**Opening** (marker click, list pick, or `?situation=<id>` in the URL **(spec choice)**, like the existing `?oi=` param):

1. Its layers, situation panel and credits turn on. Other situations' layers go off.
2. Its `defaultGlobalLayers` turn on. The viewer can still toggle any of them. Note which keys were off before.
3. Open Osiris panels (Intel, Markets, Alerts, Search, …) close. They stay available and the viewer can reopen them.
4. The camera flies to fit the union of the situation's local-map bboxes **(spec choice)**. For a situation with no local maps, it flies to `marker`.
5. The URL gets `?situation=<id>`.

**Local map data loads when you zoom into its area.** The snapshot for a local map loads the first time its bbox is in view at zoom 8 or more **(spec choice for the zoom number)**. It is cached for the session ([How does the flood map go into Osiris 2D and 3D?](https://github.com/Thrivbe/situational-globe/issues/7), budget item 1). It comes from Step 1's `/api/snapshot/<local-map>`. The browser never calls Floodboard, Open-Meteo or Overpass.

**"Back to world"** (a button in the situation panel):

- Turns off the situation's layers, panel and credits, and closes the snapshot handles.
- Turns off the `defaultGlobalLayers` that were off before opening, unless the viewer toggled them while it was open **(spec choice)**.
- Removes `?situation` from the URL and flies out to the Osiris start zoom (1.8) over the marker **(spec choice)**.

## 6. The situation panel

From [What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6).

- It slides in on the left, next to the `LayerPanel` rail (`left: 48px`).
- Top: the situation's title, story, hazard, live/past and "data from <time>".
- Below: **the board for the local map in view**: counts, worst roads, radar timeline, rain chart. These are the Step 1 ops-board components (prototype variant A, Step 1 section 6); reuse them, do not fork them **(spec choice)**. Before the snapshot loads, the board says "Zoom in to load <local map name>".
- When no local map is in view, the board shows the list of local maps; a click flies to one.
- Controls: "Back to world", the "3D city" switch (section 7), the "Animate" switch (section 9).
- On mobile it is a bottom sheet: one more `mobilePanel` value, `'situation'` **(spec choice)**.

## 7. `attachFlood(map, { mode })` inside Osiris

From [How does the flood map go into Osiris 2D and 3D?](https://github.com/Thrivbe/situational-globe/issues/7). Spike code: `src/lib/flood/attachFlood.ts`, `layers2d.ts`, `layers3d.ts` on `spike/flood-in-osiris`.

- **Shape:** `attachFlood(map, { mode: '2d' | '3d', snapshot })` returns `{ setMode, destroy, stats }`. Ids start with `flood-`. Layers go before `day-night-fill`. The situation's `hazard: "flood"` picks this module.
- **One set of layer builders.** `attachFlood` and the Step 1 `/bangkok` page use the same 2D and 3D layer builders **(spec choice)**. Do not keep the spike's copies, and do not keep its direct Floodboard fetch: data comes from the snapshot only.
- **Mode follows Osiris's view.** Osiris 2D view (`mapProjection = 'mercator'`) gets the 2D set. Osiris 3D view (`'globe'`) gets the 3D set. Switching calls `setMode`. It does not refetch.
- **The z12 handover.** MapLibre fill-extrusion in the same map. No three.js. The globe renders as mercator past about z12, so the 3D flood set starts at z12. Below z12 in the 3D view, only the marker, the outline (if on) and the situation panel show.
- **3D city pack inside Osiris = Osiris's own `carto` buildings.** Extrude source `carto`, source-layer `building`, by `render_height`. Do not load OpenFreeMap inside Osiris (it saves about 2 MB per Bangkok 3D view). Ignore `cityPack.buildings` there; use `cityPack.minZoom` (14). While the city pack shows, hide Osiris's own `osiris-3d-buildings` layer, so the two do not draw on top of each other **(spec choice)**.
- **City pack load rule** ([What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6)): only in the 3D view AND zoomed in past `cityPack.minZoom` on the local map. It unloads and stops animating otherwise. A "3D city" switch in the situation panel lets weak phones turn it off.
- **The 3D look** is the Step 1 set: variant B night-neon, plus water sheen and stronger glow ([How game-like can the 3D flood city get?](https://github.com/Thrivbe/situational-globe/issues/10)). No fake shadows.
- **Clicks.** Popups work on the 2D set and on flat 3D layers. Extrusions (report columns, pillars) are not clickable in Step 2 **(spec choice)**: on maplibre 6.7, `queryRenderedFeatures` misses extrusions once the globe renders as mercator. The panel lists cover the same data. To make them clickable, bump maplibre to 6.12 or later in a separate PR.
- **Terrain.** If Osiris terrain is on, the globe turns mercator by z9, and `lib/terrain-layer-order.ts` moves fill/line layers under markers. Let it; test once with terrain on.
- Wire it from one `useEffect` in `OsirisMap.tsx`, keyed on `mapReady`, the open situation and the loaded snapshot, as in the spike.

## 8. Credits in the Osiris credit line

From [What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6).

- Credits come from the snapshot `credits`, never from hard-coded strings.
- They show in the Osiris credit line **only while the situation is open**. Use the existing pattern: an empty geojson source with an `attribution` string (`OsirisMap.tsx:2711`, `CLOUDS_CREDIT`). Add it on open, remove it on "Back to world".
- Credits with a `note` (for example "prototype only", "may be incomplete") show that note.
- The situation panel has a "Sources" link to the full text and links (the Step 1 Sources popover).

## 9. Animation budget inside Osiris

From [How does the flood map go into Osiris 2D and 3D?](https://github.com/Thrivbe/situational-globe/issues/7) and [How game-like can the 3D flood city get?](https://github.com/Thrivbe/situational-globe/issues/10). Inside Osiris, any idle animation redraws all of Osiris (main thread 2% → 71% at 10 Hz). The cost is the animation clock, not the effect.

- Animation is a user setting, **on by default**. The "Animate" switch sits in the situation panel. It shares one browser-storage key with `/bangkok` **(spec choice)**.
- It runs only when all are true: the tab is visible, a situation is open, Osiris is in the 3D view, zoom is 12 or more, and the local map is in view. Otherwise the clock stops.
- Paint updates at most 10 Hz. Animated layers set style `transition: {duration: 0}`.
- No `line-dasharray` animation. Blocked roads keep a static dash.
- Check: with animation off and the map still, the flood layers cause 0 repaints per second.

## 10. Public build

From [Which routes are safe to make public?](https://github.com/Thrivbe/situational-globe/issues/13) and Step 1 section 7.

- One new route, `/api/situations` (section 4). Nothing else is added to the allowlist.
- No new paid key, no new upstream call from the browser. RainViewer and map tiles stay direct, as in Step 1.
- Live ships, camera AI and live streams stay off ([Where do the refresh job and the demo run?](https://github.com/Thrivbe/situational-globe/issues/8)).

## 11. Held and out of scope

Held (fog on the map):
- Situation layers and their loader: El Niño, case 2.
- Clickable extrusions (maplibre 6.12 bump).
- Extra game-like 3D effects (three.js bloom, shader water, real shadows).
- ThaiWater sensors, ferry piers, car parks (Bangkok v1.1).

Out of scope: situations people build together (logins, database, editing); a "3D city" button instead of the zoom rule; a tool that suggests new local maps ([What is a situational map?](https://github.com/Thrivbe/situational-globe/issues/6)); rebuilding live ships, camera AI and live streams ([Rebuild live ships, camera AI and live streams for Cloudflare](https://github.com/Thrivbe/situational-globe/issues/12)).

## 12. Spec choices made here

None of these needed a new decision. Change any in review.

1. `/bangkok` stays standalone, with an "Open on the globe" link.
2. Optional `marker` field; required when there are no local maps.
3. `situations/index.json` in R2 + one route `/api/situations`.
4. `situationLayers` must stay empty until a loader exists.
5. Hazard icon via `map.addImage`; markers below z9 only.
6. "Situations" list on mobile = the search tab.
7. `LayerPanel` "Situations" group = view switches (markers, outlines) only.
8. New `rain_radar` global layer (RainViewer), off at start.
9. `?situation=<id>` deep link; fly to the local maps on open; fly out on "Back to world".
10. Snapshot loads at zoom 8+ with the bbox in view.
11. "Back to world" turns off only the default global layers it turned on.
12. Situation panel reuses the Step 1 board; mobile bottom sheet.
13. One set of layer builders for `/bangkok` and `attachFlood`.
14. Hide `osiris-3d-buildings` while the city pack shows.
15. Extrusions not clickable in Step 2.
16. One shared "Animate" storage key.

## 13. Done when

- [ ] The validator accepts Bangkok with the `marker` rule and an empty `situationLayers`.
- [ ] The refresh Worker writes `situations/index.json`; `/api/situations` returns Bangkok with its level, on the allowlist, cached, rate limited.
- [ ] At `/`, the Bangkok marker shows on the globe in its level colour; a fake past situation in a test shows grey.
- [ ] The "Situations" list opens Bangkok; a marker click opens Bangkok; `/?situation=bangkok-flood-2026` opens Bangkok.
- [ ] Opening turns on the situation panel, the credits and `rain_radar`; open Osiris panels close; the camera flies to Bangkok.
- [ ] The snapshot loads once from `/api/snapshot/bangkok-flood`; no browser call to Floodboard, Open-Meteo, Overpass or OpenFreeMap buildings (check the Network tab).
- [ ] 2D view shows the 2D set; 3D view shows the 3D set from z12 and `carto` buildings from z14; switching does not refetch.
- [ ] "Back to world" removes every `flood-` and `situations-` credit layer and source it added, and turns `rain_radar` off again if the viewer did not touch it.
- [ ] The outline switch is off at start and shows the Bangkok bbox when on.
- [ ] With animation off and the map still: 0 repaints per second from the flood layers. With animation on: it stops when the tab is hidden, below z12, in the 2D view, or with Bangkok out of view.
- [ ] Osiris's own features still work with no situation open (spot-check flights, earthquakes, search, OI).
- [ ] Works once with terrain on.

## 14. Open points

None that block the build.

- Check one Step 1 detail: the snapshot type has `level: 0 | 1 | 2 | 3 | 4`, but the prototype `DG_LEVEL` gives 0–3. Step 2 colours level 4 like level 3. If Step 1 drops 4, nothing changes here.
