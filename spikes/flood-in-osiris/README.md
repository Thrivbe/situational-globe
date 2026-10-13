# SPIKE: Bangkok flood map inside Osiris (throwaway)

Answers [How does the flood map go into Osiris 2D and 3D?](https://github.com/Thrivbe/situational-globe/issues/7).
Not production code. Built by Codex from `prototype/bangkok-flood-map` @ `be7e6f6`; measured by Claude on 2026-10-13.

## What was built

- `src/lib/flood/attachFlood.ts`: `attachFlood(map, { mode: '2d' | '3d' })` returns `{ setMode, destroy, stats }`. All ids start with `flood-`. Layers go before `day-night-fill`.
- Osiris 2D view (mercator) gets the 2D set (roads, reports clusters, districts, radar, hospitals/shelters/pumping dots). Osiris 3D view (globe) gets the 3D set (buildings, road ribbons, report columns, district blocks, pillars, metro lines). Switching 3D/2D calls `setMode`; no refetch.
- Wiring: one `activeLayers.flood_bkk` key, one "Situations" group in `LayerPanel`, two small effects in `OsirisMap.tsx`. Nothing else in Osiris changed.
- OSM data comes from `public/flood/osm-snapshot/` only. Overpass calls at runtime: 0.
- Handover: fill-extrusion in the same MapLibre map. No three.js.

## Run

`npm run dev`, open the app, Situations > Bangkok flood. Dev-only handle `window.__floodDebug` (`flyToDistrict()`, `handle().stats()`); animation knob `window.__floodAnim = 'raf' | '10hz' | 'off'`.
Measure: `node spikes/flood-in-osiris/measure.mjs` (needs the dev server; set `URL_`). Raw numbers in `results.json`, `results2.json`.

## Numbers (Chromium 1148, Apple M2 Max GPU via ANGLE Metal, 1440x900, Osiris default layers on)

| Case | fps | p95 frame ms | main-thread busy | script |
|---|---|---|---|---|
| Osiris globe, flood off | 120 | 8.9 | 5% | 3% |
| Flood on, globe zoomed out (z8) | 120 | 8.7 | 3% | 0% |
| Bangkok 3D z14.1, still, animation off | 120 | 8.9 | 2% | 0% |
| Bangkok 3D, still, glow animation 10 Hz | 114 | 9.1 | 71% | 66% |
| Bangkok 3D, still, glow animation every frame | 115 | 9.0 | 90% | 84% |
| Bangkok 2D z12.5, flood on | 109 | 15.2 | 6% | 0% |
| Bangkok 3D, panning, flood off | 51-80 | 42-59 | 98% | 90% |
| Bangkok 3D, panning, flood on, anim off | 42-55 | 49-92 | 99% | 93% |
| 4x slower CPU, panning, flood off | 11.5 | 143 | 100% | 97% |
| 4x slower CPU, panning, flood on | 11.5 | 132 | 100% | 97% |
| 4x slower CPU, still, anim 10 Hz | 42 | 33 | 100% | 95% |
| 4x slower CPU, still, anim off | 120 | 9.6 | 3% | 1% |

Network on first toggle: Floodboard 719 kB (roads + reports), snapshots 184 kB (local), RainViewer/Open-Meteo under 2 kB. Bangkok 3D first view: Osiris CARTO tiles 3.7 MB + OpenFreeMap tiles 2.1 MB (30 tiles). Over one pan session: CARTO 12.7 MB, OpenFreeMap 7.6 MB.
Hidden tab: animation loop stops (`animRunning: false`). Console errors: 0 (one unrelated 503 from an Osiris feed).

## What the numbers say

1. **The flood layers are cheap when still.** Toggled on and zoomed out, or still in Bangkok 3D, they cost nothing measurable.
2. **Any idle animation is the budget killer.** One paint change (report glow opacity) at 10 Hz pushes the main thread from 2% to 71% (95% on a 4x slower CPU), because every change makes MapLibre redraw the whole Osiris map with all its layers. The cost is Osiris's full frame, not the flood layer.
3. **Panning at city zoom is Osiris's own cost.** With flood off, panning in Bangkok 3D already uses 90%+ of the main thread. Flood on adds little (same 11.5 fps on a 4x slower CPU).
4. **The second vector source is waste inside Osiris.** OpenFreeMap adds about 60% more tile bytes. Osiris's CARTO source already has `building` with `render_height` (`OsirisMap.tsx` ~L2609: "No second worldwide vector source is needed").

## Budget proposed for the spec

- Flood data loads only on first toggle; cached for the session; no Overpass at runtime (snapshot files, refreshed by the refresh job).
- 3D set only in Osiris's 3D view and only past z12 (buildings past ~z14); 2D set only in the 2D view.
- **No idle animation by default.** Animation only while the camera already moves, or behind an explicit "animate" switch, and never when the tab is hidden or the layer is off.
- Inside Osiris, extrude buildings from Osiris's own `carto` source; OpenFreeMap only for the standalone map.
- fill-extrusion in the same map; no three.js. Revisit three.js only for the "game-like" effects ticket, and price each animated frame as one full Osiris frame.
