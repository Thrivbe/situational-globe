// OWNER: feed coverage worker. Every endpoint the page may fetch, with its licence and credit.
// Other modules read endpoints from here only; never hard-code a feed URL elsewhere.
// All endpoints below were curl-probed on 2026-10-12: they answer, return the stated format and
// send Access-Control-Allow-Origin: *, so a plain browser fetch works (no backend).
export const BKK = [100.53, 13.75];
export const BKK_BOX = [100.3, 13.5, 100.95, 14.05]; // [west, south, east, north]

export const STYLE = 'https://tiles.openfreemap.org/styles/dark'; // credits OpenFreeMap + OSM via the style itself
// Vector source id inside STYLE is "openmaptiles" (TileJSON https://tiles.openfreemap.org/planet).
// Source layers in the tiles: aeroway, boundary, building, landcover, landuse, place, transportation,
// transportation_name, water, water_name, waterway, plus poi, park, aerodrome_label (not drawn by
// the dark style, but you can add your own layer on them: roads, canals, rail, stations, airports,
// parks, water need NO Overpass call).

// ---- Overpass (OSM, ODbL) ------------------------------------------------------------------
// Public Overpass instances are flaky (2026-10-12: overpass-api.de gave 504 for a while and later
// refused connections after a burst; maps.mail.ru works but takes ~9 s). overpass.openstreetmap.fr was
// DROPPED: it sends no Access-Control-Allow-Origin to browsers (403 "white-listed usages only"), which
// logged a CORS console error on every cold cache. So: try hosts in order, serialise calls, cache
// 24 h in localStorage, and as a last resort load the committed snapshot in ./osm-snapshot/<key>.json
// (same queries, taken 2026-10-12, transit 2026-10-13, still ODbL and credited). curl needs a custom -A to avoid a 406.
export const OVERPASS_HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
export const snapshotUrl = key => new URL(`./osm-snapshot/${key}.json`, import.meta.url).href;
const OB = `(${BKK_BOX[1]},${BKK_BOX[0]},${BKK_BOX[3]},${BKK_BOX[2]})`; // Overpass bbox is S,W,N,E
// Cache-friendly: fixed bbox, no timestamps, byte-identical query string every time, so the HTTP
// cache and the localStorage cache in fetchOverpass() hit. OSM changes slowly: cache 24 h.
const q = (body, out = 'out center tags;') => `[out:json][timeout:60];${body};${out}`;

export const OVERPASS_QUERIES = {
  // 251 elements, ~110 kB. Node or way/relation; geometry via `center`.
  hospitals: q(`nwr[amenity=hospital]${OB}`),
  // 127 elements, ~44 kB. Assembly points, social shelters, community centres: POSSIBLE gathering
  // sites, not an official evacuation list. (amenity=shelter is mostly bus stops and gazebos: skipped.)
  shelters: q(`(nwr[emergency=assembly_point]${OB};nwr[social_facility=shelter]${OB};nwr[amenity=community_centre]${OB};nwr[emergency=shelter]${OB};)`),
  // 101 elements, ~21 kB. pumping_station (8), water_works (27), sluice_gate (28), lock_gate (10), weir (28).
  pumping: q(`(nwr[man_made=pumping_station]${OB};nwr[man_made=water_works]${OB};nwr[waterway=sluice_gate]${OB};nwr[waterway=lock_gate]${OB};nwr[waterway=weir]${OB};)`),
  // 422 elements, ~160 kB. Named attractions and monuments: landmarks for labels / 3D markers.
  landmarks: q(`(nwr[tourism=attraction][name]${OB};nwr[historic~"^(monument|memorial|castle|temple)$"][name]${OB};)`),
  // 48 elements, ~21 kB. Fire stations (rescue boats, pumps).
  fireStations: q(`nwr[amenity=fire_station]${OB}`),
  // 19 route relations, ~350 kB with `out geom`: BTS Sukhumvit/Silom (route=subway), MRT Blue/Purple/Gold,
  // MRT Pink/Yellow (monorail), airport people mover (light_rail). Members carry `geometry`; both directions of a
  // line are separate relations. Answered by maps.mail.ru (CORS *) on 2026-10-13; overpass-api.de gave 504.
  transit: q(`rel[type=route][route~"^(subway|monorail|light_rail)$"]${OB}`, 'out geom qt;'),
  // 263 elements, ~92 kB. Ferry piers and boat stops: amenity=ferry_terminal (194), man_made=pier with a name (51),
  // public_transport stop_position/station with ferry=yes (17). Node or way; geometry via `center`. maps.mail.ru answered
  // 200 with CORS * on 2026-10-13. Chao Phraya express boat, khlong boats and cross-river ferries.
  piers: q(`(nwr[amenity=ferry_terminal]${OB};nwr[public_transport=station][ferry=yes]${OB};nwr[public_transport=stop_position][ferry=yes]${OB};nwr[man_made=pier][name]${OB};)`),
  // 199 elements, ~62 kB. Only multi-storey and underground car parks (the ones that flood and that people look
  // for as high/safe ground). Surface lots are skipped: thousands of them. Tags: name, capacity, fee, building.
  parking: q(`nwr[amenity=parking][parking~"^(multi-storey|underground)$"]${OB}`),
  // 50 Bangkok khet polygons as relations, ~860 kB (13.9k way points). Members have `geometry`;
  // stitch outer ways into rings client-side. Filter by Thai name ^เขต so neighbouring provinces'
  // amphoe are dropped. Tags: name, name:en, name:th, population, wikidata.
  districts: q(`rel[boundary=administrative][admin_level=6]["name"~"^เขต"]${OB}`, 'out geom qt;'),
};

export const overpassUrl = (key, host = OVERPASS_HOSTS[0]) =>
  `${host}?data=${encodeURIComponent(OVERPASS_QUERIES[key])}`;

// fetchOverpass('hospitals') -> GeoJSON FeatureCollection of points (relations use `center`).
// Cached in localStorage for 24 h; tries every host in OVERPASS_HOSTS. For `districts` use
// fetchOverpassRaw (elements carry member geometry that you must stitch).
// Network calls run one at a time with a gap, because overpass-api.de answers 429/504 when several
// queries arrive together (seen in testing). Cache hits skip the queue.
let overpassChain = Promise.resolve();
const overpassSlot = fn => {
  const run = overpassChain.then(fn);
  overpassChain = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, 1500)));
  return run;
};
let overpassDownUntil = 0; // circuit breaker: after every live host failed, go straight to the snapshot for 2 min
async function overpassNetwork(key) {
  let lastErr = new Error('overpass hosts skipped (recent failure)');
  if (Date.now() > overpassDownUntil) {
    for (const host of OVERPASS_HOSTS) {
      try {
        const r = await fetch(overpassUrl(key, host), { signal: AbortSignal.timeout(12000) });
        if (!r.ok) throw new Error(`${host} ${r.status}`);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    overpassDownUntil = Date.now() + 120e3;
  }
  try { // every live host failed: committed snapshot
    const r = await fetch(snapshotUrl(key));
    if (r.ok) { const d = await r.json(); return { ...d, fromSnapshot: true }; }
  } catch { /* fall through */ }
  throw lastErr;
}
export async function fetchOverpassRaw(key, ttlMs = 24 * 3600e3) {
  const ck = `bkk-overpass:${key}`;
  try {
    const c = JSON.parse(localStorage.getItem(ck) || 'null');
    if (c && Date.now() - c.t < ttlMs) return c.d;
  } catch { /* storage blocked: ignore */ }
  const d = await overpassSlot(() => overpassNetwork(key));
  if (!d.fromSnapshot) try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d })); } catch { /* too big or blocked: skip cache */ }
  return d;
}

export async function fetchOverpass(key, ttlMs) {
  const d = await fetchOverpassRaw(key, ttlMs);
  return {
    type: 'FeatureCollection',
    features: d.elements
      .map(e => ({ lon: e.lon ?? e.center?.lon, lat: e.lat ?? e.center?.lat, tags: e.tags || {}, id: `${e.type}/${e.id}` }))
      .filter(e => Number.isFinite(e.lon) && Number.isFinite(e.lat))
      .map(e => ({ type: 'Feature', id: e.id, properties: e.tags, geometry: { type: 'Point', coordinates: [e.lon, e.lat] } })),
  };
}

export const FEEDS = {
  // Floodboard (CC BY 4.0). roads.geojson 784 segments ~380 kB, reports.csv ~1100 rows ~620 kB; both gzip, cache 30 s.
  // Reports with source `news` or `social_fb` (and roads whose sources include them) trace back to
  // Google News / Facebook: drop those rows in the UI (our no-Google-News rule).
  floodRoads:   { url: 'https://floodboard.org/api/export/roads.geojson', licence: 'CC BY 4.0' },
  floodReports: { url: 'https://floodboard.org/api/export/reports.csv', licence: 'CC BY 4.0' },
  radar:        { url: 'https://api.rainviewer.com/public/weather-maps.json', licence: 'RainViewer free API, attribution' },
  // `current` also carries temperature_2m, relative_humidity_2m, wind_speed_10m, uv_index: the weather tiles read them from
  // this one call (no second request, so no extra 503 risk). data.js caches it 20 min and retries once.
  forecast:     { url: `https://api.open-meteo.com/v1/forecast?latitude=${BKK[1]}&longitude=${BKK[0]}&current=precipitation,rain,temperature_2m,relative_humidity_2m,wind_speed_10m,uv_index&hourly=precipitation,precipitation_probability&past_hours=12&forecast_hours=48&timezone=Asia/Bangkok`,
                  licence: 'CC BY 4.0, free tier non-commercial' },
  // 3x3 grid of hourly precipitation for a "rain coming" map layer: one call, JSON array of 9 results
  // in the order of the lat/lon lists (pair i = lat[i], lon[i]). Same licence as `forecast`.
  forecastGrid: { url: 'https://api.open-meteo.com/v1/forecast?latitude=13.6,13.6,13.6,13.75,13.75,13.75,13.9,13.9,13.9&longitude=100.4,100.55,100.7,100.4,100.55,100.7,100.4,100.55,100.7&hourly=precipitation&past_hours=6&forecast_hours=24&timezone=Asia/Bangkok',
                  licence: 'CC BY 4.0, free tier non-commercial' },
  // ThaiWater / HAII (unconfirmed licence, prototype only). 805 telemetry stations nationwide, ~1.4 MB JSON
  // (19 inside the Bangkok bbox: filter on station.tele_station_lat/long). GET answered 200 on 2026-10-13
  // with access-control-allow-origin echoing the request Origin (works for localhost / our own origin).
  // Shape: { waterlevel_data: { data: [ { waterlevel_msl, waterlevel_msl_previous, waterlevel_datetime,
  // situation_level (1..5), diff_wl_bank (m below bank), diff_wl_bank_text, storage_percent,
  // station: { tele_station_name{en,th}, tele_station_lat, tele_station_long, left_bank, right_bank,
  // min_bank, ground_level, warning_level_m, critical_level_m }, geocode } ] } }.
  // Percent of bank (Augma "wl"): (waterlevel_msl - ground_level) / (min_bank - ground_level) * 100.
  waterLevel:    { url: 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load', licence: 'unconfirmed licence, prototype only' },
  // Open-Meteo Flood API (GloFAS river discharge, CC BY 4.0, free tier non-commercial; same credit as the forecast).
  // Curl-probed 2026-10-13: 200, JSON, access-control-allow-origin *. Daily river_discharge in m3/s on a ~5 km grid cell
  // (the point 13.75,100.5 snapped to 13.775,100.525 and gave 3 to 11 m3/s, a canal cell, while 14.025,100.525 on the
  // Chao Phraya main channel gave about 5,500 m3/s peak: pick river cells for flood-scale numbers, the URL here asks for both). Several points: comma-separated lat/lon lists
  // return an array. Params: daily=river_discharge, past_days, forecast_days (up to 92).
  riverDischarge: { url: 'https://flood-api.open-meteo.com/v1/flood?latitude=13.775,14.025&longitude=100.525,100.525&daily=river_discharge&past_days=7&forecast_days=14',
                    licence: 'CC BY 4.0, free tier non-commercial' },
  // OSM objects through Overpass (ODbL). `url` is the primary host; use fetchOverpass(key) for fallback + cache.
  hospitals:     { url: overpassUrl('hospitals'),     licence: 'ODbL (OpenStreetMap contributors)' },
  shelters:      { url: overpassUrl('shelters'),      licence: 'ODbL (OpenStreetMap contributors)' },
  pumping:       { url: overpassUrl('pumping'),       licence: 'ODbL (OpenStreetMap contributors)' },
  landmarks:     { url: overpassUrl('landmarks'),     licence: 'ODbL (OpenStreetMap contributors)' },
  fireStations:  { url: overpassUrl('fireStations'),  licence: 'ODbL (OpenStreetMap contributors)' },
  piers:         { url: overpassUrl('piers'),         licence: 'ODbL (OpenStreetMap contributors)' },
  parking:       { url: overpassUrl('parking'),       licence: 'ODbL (OpenStreetMap contributors)' },
  districts:     { url: overpassUrl('districts'),     licence: 'ODbL (OpenStreetMap contributors)' },
  // Vector tiles (roads, canals/waterway, water, rail, parks, buildings, aeroway): no fetch needed beyond STYLE.
  vectorTiles:   { url: 'https://tiles.openfreemap.org/planet', licence: 'MIT (software), ODbL (data)' },
};

export const CREDIT = 'Flood roads/reports © <a href="https://floodboard.org">Floodboard</a> (CC BY 4.0, may be incomplete) · '
  + '<a href="https://open-meteo.com/">Weather and river discharge data by Open-Meteo.com</a> (CC BY 4.0) · Radar © <a href="https://www.rainviewer.com">RainViewer</a> · '
  + 'Hospitals, shelters, pumps, landmarks, piers, car parks, metro lines, districts © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL) · '
  + 'Water level sensors: <a href="https://www.thaiwater.net">ThaiWater / HAII</a> (unconfirmed licence, prototype only)';
// Basemap credit (OpenFreeMap, OpenMapTiles, OSM) is added by the style itself.
