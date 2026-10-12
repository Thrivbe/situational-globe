# Public Bangkok flood feeds: what we can use in a public demo

Ticket: Thrivbe/situational-globe#4 (map #1). Researched 2026-10-12/13.

Scope: the ten feeds the Augma teardown lists as sources. The teardown was used only to learn which feeds exist and their hostnames. No Augma code was read or reused. Every endpoint below was probed or read at the provider's own site, not via Augma.

Verdict key:
- **usable**: no strings that matter for a public demo.
- **usable-with-attribution**: allowed, with a credit (and/or a non-commercial condition, stated in the row).
- **not usable**: terms forbid it, or no licence could be found. "Not usable (unconfirmed)" means we found no licence text; ask the owner before shipping.

"Non-commercial" below means: no ads, no subscriptions, no paid product. A free public demo qualifies. If situational-globe ever gets monetised, re-check every row marked NC.

## Summary table

| Feed | Endpoint | Shape | Refresh | Auth / key | Cost | Licence for public display | Verdict |
|---|---|---|---|---|---|---|---|
| **Floodboard** (community road status; aggregates BMA, Highways, Traffy, ThaiWater, iTIC, TMD, news) | `https://floodboard.org/api/export/roads.geojson`, `https://floodboard.org/api/export/reports.csv` | GeoJSON road segments (depth/passability classes), CSV citizen reports | Live; no cadence published | None seen | Free | **CC BY 4.0**, stated on floodboard.org/about as "open to media, rescue teams, agencies, developers". Credit Floodboard. Disclaimer: data "may be incomplete or wrong"; no colour = no data, not dry. Upstream rights in the sources it mixes are not addressed. | **usable-with-attribution** (best single source) |
| **Open-Meteo** (forecast, marine) | `https://api.open-meteo.com/v1/forecast`, `https://marine-api.open-meteo.com/v1/marine` | JSON hourly/daily arrays | Model-run cadence (hourly-ish) | None on free tier; `apikey` param on paid | Free: under 10,000 calls/day, 5,000/h, 600/min, 300k/month. Paid plans priced by call budget, no list price shown. | Data **CC BY 4.0**. Free API is **non-commercial only** (no ads/subscriptions/commercial product). Required credit: a link next to any place the data shows, e.g. "Weather data by Open-Meteo.com" linking to https://open-meteo.com/. No uptime guarantee. | **usable-with-attribution** (NC; paid plan if monetised) |
| **RainViewer** (radar tiles) | `https://api.rainviewer.com/public/weather-maps.json`, tiles at `{host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png` | JSON index of timestamped frames, then PNG raster tiles (256 or 512) | New frame every 10 min; file covers past 2 h in 10-min steps (the API page also says radar tiles refresh every 5 min) | None documented | Free | Free for personal/educational/small-scale community use; attribution requested (link to rainviewer.com, do not hide the watermark). Page says max zoom 7. No availability guarantee; radar owners can withdraw data. Separate API terms page was not readable, so commercial terms are unverified. | **usable-with-attribution** (NC / small scale) |
| **OpenFreeMap** (vector basemap) | `https://tiles.openfreemap.org/styles/liberty` (also bright, positron; the teardown names a `dark` style) | MapLibre style JSON plus vector tiles | Planet rebuilt regularly; `/planet/latest` cached up to 1 day | None | Free; asks for donations | Project is MIT. Statement: "no limits on the number of map views or requests". No SLA. Attribution required: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (MapLibre adds it automatically; the "OpenFreeMap" part is optional). | **usable-with-attribution** |
| **OSM data** (behind the basemap) | via OpenFreeMap tiles | n/a | n/a | n/a | n/a | **ODbL**. Credit OpenStreetMap and indicate the ODbL (link to https://www.openstreetmap.org/copyright). Share-alike applies only if we publish a derived database. | **usable-with-attribution** |
| **TMD** (Thai Met Dept: forecasts, warnings, observations) | RSS/XML: `https://www.tmd.go.th/api/xml/region-daily-forecast?regionid=7` (Bangkok), `/api/xml/warning-news`, `https://www.tmd.go.th/api/xml/CAP`, `/api/xml/weather-report?stationnumber=48455`. JSON/XML API: `http://data.tmd.go.th/api/<Name>/<ver>/` (WeatherToday, Weather3Hours, WeatherForecastDaily, WeatherWarningNews, Station...). NWP model API: `https://data.tmd.go.th/nwpapi/doc/` | XML (RSS, CAP) and JSON | Daily forecast at 06/12/17/23h; obs 3-hourly (01,04,07...22h); NWP hourly to 48-72 h | RSS: none seen. `data.tmd.go.th/api`: `uid` + `ukey` query params (docs show demo values; production suitability not stated). NWP API: registration + OAuth token. | Free | Site copyright (tmd.go.th/content/copyright): TMD owns content; redistribution allowed only **non-commercially**, and the source (TMD) must be credited **every time**. No separate licence found for the API/RSS; no rate limits published. | **usable-with-attribution** (NC; credit "กรมอุตุนิยมวิทยา / Thai Meteorological Department") |
| **ThaiWater / HAII** (rain gauges, river and canal levels) | `https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h`, `.../public/waterlevel_load` | JSON `{result, data[]}`; per record: station (lat/lon, bank level, warning/critical levels), agency, basin, geocode, `*_datetime` ("YYYY-MM-DD HH:MM", no timezone), situation level | Gauge readings roughly hourly; some 20-60 min | None seen (open GET). No documentation page found. | Free | **No terms, licence, or API docs found.** thaiwater.net pages refused connections from our host; the about page has no usage terms. Source agencies (RID, TMD, etc.) own the underlying data. Contact: info_thaiwater@hii.or.th, +66 2158 0901. | **not usable (unconfirmed)**: ask HAII before shipping; interim path is Floodboard (CC BY) which credits ThaiWater |
| **Traffy Fondue** (BMA citizen reports) | `https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?limit=N&output_format=json` (also `.../share/teamchadchart/search` seen in the teardown). Portal: `https://citydata.traffy.in.th/` | GeoJSON FeatureCollection; properties: ticket_id, problem_type_fondue, description, address, district, state, timestamp, photo_url, view_count, `ai` summary/categories | Cache expiry 1800 s on the response; reports continuous | None seen | Free | **None stated in the response.** citydata.traffy.in.th lists "open data, API, licence, terms, attribution" sections but their text did not render for us. Reports include free-text, addresses and photos from citizens (personal-data risk). The probe also returned a cache error message with inconsistent counts. | **not usable (unconfirmed)**: read the licence on citydata.traffy.in.th (needs a browser) or ask Traffy; interim path is Floodboard |
| **BMA** (Bangkok Metropolitan Admin: road flood sensors, rain, canal levels) | Web UIs: `https://weather.bangkok.go.th/flood/`, `https://weather.bangkok.go.th/rain/`, SCADA `https://weather.bangkok.go.th/scada/`. Portal: `https://data.bangkok.go.th`. No documented public API found. | Unknown (web app; 108 road flood points reported by press) | Rainfall/canal logged every 5-15 min (2016 technical report) | Unknown | Free to view | **No licence or API terms found.** weather.bangkok.go.th returned 403 to our fetch; data.bangkok.go.th unreachable from our host. National portal licences vary per dataset (some forbid commercial use). | **not usable (unconfirmed)**: take BMA data through Floodboard (CC BY) or get written permission |
| **iTIC / Longdo** (traffic, incidents) | Longdo events: `https://event.longdo.com/feed/json`. Longdo Map JS API (key, URL-bound). Traffic page: `https://traffic.longdo.com/` | JSON array: eid, title/title_en, lat/lon, type (6 = flood), start/stop, contributor, icon, severity, images | Live | Event feed: none seen. Map API: account + URL-registered key. | Map API free under 100k web-service queries/month (max 60/min) and 800k tile loads/month | Longdo terms: content may be shown **only inside the keyed Longdo service in the form provided**; no robots/spiders and **no bulk feeds**; iTIC traffic data is listed as third-party content usable only via Longdo. Event feed has no licence text; items carry per-contributor credits (police, radio). | **not usable** as a raw feed; only legitimate route is the Longdo Map API with a registered key and their branding, or a licence from Metamedia (info@mm.co.th) |
| **Google News** (headlines) | `https://news.google.com/rss/search?q=...&hl=en-TH&gl=TH&ceid=TH:en` | RSS 2.0: title (headline - outlet), redirect link, guid, pubDate, HTML description, source | Continuous | None | Free | Channel copyright, verbatim in substance: feed is (c) Google, for rendering Google News results **in a personal feed reader, personal non-commercial use only; any other use is prohibited.** | **not usable** (a public demo is not a personal feed reader). Use outlet RSS or GDELT instead if news is wanted (not researched here). |

## Notes that change the build

1. **Floodboard is the load-bearing feed.** It is the only Thai flood source with an explicit open licence (CC BY 4.0), a documented export URL, and it already merges BMA, Highways, Traffy, ThaiWater, iTIC and TMD. Risk: it is a one-person-looking community site (X @floodboardTH), has no stated SLA or rate limit, and its CC BY covers its own compilation, not necessarily the upstream owners' rights. Mitigate: cache, show "may be incomplete" wording, and ask them for an OK to use it in a demo. Note `floodboard.com` is a parked domain for sale; the live site is `floodboard.org`.
2. **Ask-first list** (blocks ticket #6 and #8 only if we want direct feeds): HAII/ThaiWater, Traffy, BMA. All three publish unauthenticated endpoints with no licence text we could find. Open endpoint is not a licence.
3. **Non-commercial is the recurring constraint** (Open-Meteo free tier, TMD copyright, RainViewer). Fine for a free demo, a blocker if monetised. Decide that before building on them.
4. **TMD** has two surfaces with different friction: RSS/CAP needs no key; `data.tmd.go.th/api` needs `uid/ukey`; NWP needs registration. For warnings in a demo, RSS/CAP is enough.
5. **Basemap**: OpenFreeMap + OSM needs only the standard attribution string in the map footer.

## What I could not verify

- Thai-language licence/terms pages for ThaiWater, Traffy (citydata), BMA, and data.bangkok.go.th: unreachable or not rendered from this host. A human with a Thai-capable browser should read them.
- RainViewer's separate "API terms of use" page and its 2025-26 free-tier changes (the transition page 404'd). The zoom-7 limit and 10-min cadence come from the current weather-maps-api page.
- Open-Meteo's separate licence page quoted attribution wording; commercial price list is not published on the pages read.
- Floodboard rate limits and uptime.
- Probes of ThaiWater and Traffy were single GETs; no sustained load was applied.

## Sources

- Open-Meteo licence: https://open-meteo.com/en/licence
- Open-Meteo terms: https://open-meteo.com/en/terms
- Open-Meteo pricing: https://open-meteo.com/en/pricing
- RainViewer API overview: https://www.rainviewer.com/api.html
- RainViewer Weather Maps API: https://www.rainviewer.com/api/weather-maps-api.html
- RainViewer terms: https://www.rainviewer.com/terms.html
- OpenFreeMap quick start: https://openfreemap.org/quick_start/
- OpenFreeMap repo (terms, attribution, no-limits statement): https://github.com/hyperknot/openfreemap
- OSM copyright: https://www.openstreetmap.org/copyright
- TMD copyright: https://www.tmd.go.th/content/copyright
- TMD RSS list: https://www.tmd.go.th/service/rss
- TMD data API index: https://data.tmd.go.th/api/index1.php
- TMD NWP API docs: https://data.tmd.go.th/nwpapi/doc/
- ThaiWater API (live probe): https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h and https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load
- ThaiWater about: https://twa.thaiwater.net/en/about
- Traffy public API (live probe): https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?limit=3&output_format=json
- Traffy portal: https://citydata.traffy.in.th/
- BMA flood page: https://weather.bangkok.go.th/flood/
- Floodboard home and about (CC BY 4.0, exports): https://floodboard.org/ , https://floodboard.org/about
- Longdo Map API terms: https://map.longdo.com/api/terms
- Longdo Map terms (iTIC third-party content): https://map.longdo.com/terms/
- Longdo events feed (live probe): https://event.longdo.com/feed/json
- Google News RSS (copyright element): https://news.google.com/rss/search?q=bangkok+flood&hl=en-TH&gl=TH&ceid=TH:en
- Reference only, for which feeds exist: /Users/robinsverd/Thrivbe-AI/content/research/augma-imaginarium-2026-10-12/README.md
