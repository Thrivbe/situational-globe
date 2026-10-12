# PROTOTYPE: Bangkok flood map (throwaway)

Answers [What does our own Bangkok flood map look like?](https://github.com/Thrivbe/situational-globe/issues/9).
Not production code. No tests, no backend. Our own code; Augma was only a reference for which feeds exist.

## Run

```sh
python3 -m http.server 8791 --bind 127.0.0.1 -d /Users/robinsverd/Thrivbe-AI/.tmp/sg-proto-bangkok
```

Open http://127.0.0.1:8791/prototypes/bangkok-flood-map/?variant=A. Switch with the bottom bar or the ← → keys.
Serve the repo root: the page reuses the MapLibre 6.7.0 worker that Osiris commits under `public/vendor/`.

## Variants

| Key | Name | Question it asks |
|---|---|---|
| A | Ops board (2D) | Is a list-first dashboard (counts, worst roads, layer toggles) the right shape? |
| B | 3D city | Is a map-first 3D view (extruded buildings, glowing flooded roads, report columns, slow orbit) the right shape? |
| C | Split 2D/3D + timeline | Is a time-first view (synced 2D and 3D maps, radar scrubber, 60 h rain chart) the right shape? |

## Live data (all fetched in the browser, all allow CORS)

- Flooded roads + reports: Floodboard `roads.geojson`, `reports.csv` (CC BY 4.0). Road colour = verdict for a sedan.
- Rain radar: RainViewer (past 2 h frames, max zoom 7, overzoomed).
- Rain forecast: Open-Meteo hourly, past 12 h + next 48 h (free tier, non-commercial).
- Base map + 3D buildings: OpenFreeMap `dark` style, `building` layer extruded by `render_height`.

Credits sit in the map attribution. Findings behind these choices: `research/bangkok-feeds.md` and `research/bangkok-buildings.md` on their research branches.

## Known gaps

- OSM building heights are thin outside central Bangkok, so 3D looks sparse in the suburbs.
- Floodboard covers central Thailand, not just Bangkok; the 3D views start on the densest cluster inside Bangkok.
- First load takes a few seconds (two remote styles + four feeds).
