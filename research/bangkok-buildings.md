# Where do the 3D Bangkok buildings come from?

Ticket: Thrivbe/situational-globe#5 (map #1). Researched 2026-10-12 from provider docs. Augma's `bkk.json` and `/bld/` tiles were not used.

## Answer

Use **OpenFreeMap vector tiles (OSM-derived, `render_height`) as the baseline**: free, no key, MIT, public-demo friendly. Add **Overture buildings** only if footprint completeness in Bangkok proves poor. Treat **Google Photorealistic 3D Tiles** as an optional visual layer, not a data source. No Thai open dataset with heights was found.

Caveat: no published figure for Bangkok height coverage exists in any source below. Every provider doc is silent on it. The one measurement that settles it is counting non-null `height` / `render_height` inside a Bangkok bbox (see "Open question").

## Comparison

| Source | Bangkok coverage | Height quality | Format | License | Cost |
|---|---|---|---|---|---|
| OpenFreeMap (OpenMapTiles schema) | Planet tiles, so Bangkok is included. Footprint completeness is whatever OSM has. | `render_height` is "an approximated height from levels and height" (OpenMapTiles). The schema page gives no fallback for untagged buildings. Expect many flat or missing buildings where OSM lacks `height` / `building:levels`. | Vector tiles (MVT) | Software MIT. Data ODbL (OSM), attribution required. Commercial use allowed. | Free, no key, no stated request limits. No SLA, donation-funded. |
| OSM raw | Same footprints as above, directly. | `height` is metres to roof top. `building:levels` is a fallback some renderers use. OSM wiki says nothing about overall completeness, and recommends adding `height` to new buildings. | PBF / Overpass | ODbL | Free (self-process) |
| Overture Maps buildings | Global. Conflates OSM (highest priority), Esri Community Maps, Microsoft and Google ML footprints, and an East Asia ML roofprint dataset. Thailand is not called out. | Schema has optional `height` (m) and `num_floors`. Docs give no origin, accuracy or coverage figures. Heights from matched features are merged. Third-party notes say height is sparse outside the US, where it comes from USGS 3DEP lidar. | GeoParquet on S3 and Azure. No PMTiles mentioned in the buildings guide. | ODbL (buildings theme). Sources must be ODbL-compatible. | Free data. You pay for your own processing and hosting. |
| Google Photorealistic 3D Tiles | Map coverage table lists Thailand with "good data quality" under "Map Tiles 2D/3D", but the 3D tile column is ambiguous. Bangkok photogrammetry itself is unconfirmed. | Textured mesh, not footprints with heights. No per-building attributes. | 3D Tiles (glTF) via Map Tiles API | Google terms. No cache or storage, visualization only, no geodata extraction, mandatory on-screen attribution, EEA billing addresses lose some content. | $6 per 1,000 billable events after a 1,000/month free cap, falling with volume. |
| Google Open Buildings 2.5D Temporal | Thailand is listed. | Per-pixel relative height raster. Effective resolution about 4 m, from Sentinel-2. MAE 1.5 m only measured in North America, Europe and Japan. Capped at 100 m, Global South tall buildings likely less accurate. | Raster (GeoTIFF) | CC BY 4.0 or ODbL | Free |
| Thai government (BMA, data.go.th, GISTDA) | Searched, no Bangkok building-footprint-with-height dataset found. Not proven absent. | n/a | n/a | n/a | n/a |

## Recommendation

1. Start with OpenFreeMap and extrude by `render_height`. Zero cost, zero keys, license fits a public demo with an attribution line.
2. Run the coverage check below before committing. If most central Bangkok buildings have no height, either apply a clearly labelled default (for example levels x 3 m, a flat fallback) or switch to Overture.
3. Avoid Google 3D Tiles as the building source: it forbids extracting geodata and caching, and it costs money at scale. Fine as a background mesh only if the demo accepts Google's attribution rules.
4. The 2.5D Temporal raster is a possible height-fill for footprints, but accuracy for Bangkok high-rises is unvalidated. Park it.
5. Thai government data: low-confidence lead only. Worth one Thai-language check of data.go.th and BMA before declaring it dead.

## Open question (needs a data check, not more reading)

Percentage of buildings with a height value in a Bangkok bbox, OpenFreeMap vs Overture. Do it with DuckDB against the Overture release 2026-09-23.1 Parquet and a tile sample. Not run here, since this ticket forbade running repo code and no published figure exists.

## Sources

- Overture buildings guide: https://docs.overturemaps.org/guides/buildings/
- Overture building schema: https://docs.overturemaps.org/schema/reference/buildings/building/
- OpenFreeMap: https://openfreemap.org/
- OpenMapTiles building layer: https://openmaptiles.org/schema/#building
- OSM Simple 3D Buildings: https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings
- Google 3D Tiles policies: https://developers.google.com/maps/documentation/tile/policies
- Google 3D Tiles overview: https://developers.google.com/maps/documentation/tile/3d-tiles-overview
- Google Maps coverage: https://developers.google.com/maps/coverage
- Google Maps pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Open Buildings: https://sites.research.google/gr/open-buildings/
- Open Buildings 2.5D Temporal: https://sites.research.google/gr/open-buildings/temporal/
