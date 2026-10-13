// OWNER: 2D layers & data worker. Fetch + shape live data, plus small shared helpers. 3D and UI only import.
import { FEEDS, BKK, BKK_BOX, snapshotUrl, OVERPASS_QUERIES } from './feeds.js';

export const SEV = { blocked:4, risky:3, caution:2, ok:1 };
export const COLOR = ['match', ['get','sedan'], 'blocked','#ef4444', 'risky','#fb923c', 'caution','#facc15', '#4ade80'];

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.replace(/^﻿/, ''));
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const warned = new Set();
export function warnOnce(key, msg) { if (!warned.has(key)) { warned.add(key); console.warn(`[bangkok-flood-map] ${msg}`); } }

// Rows from Floodboard that trace back to Google News / Facebook are dropped (project rule: no Google News).
const BLOCKED_SOURCES = new Set(['news', 'social_fb']);

const emptyWx = () => {
  const t = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 13) + ':00';
  const time = Array.from({ length: 60 }, (_, i) => new Date(Date.parse(t + ':00Z') + (i - 12) * 3600e3).toISOString().slice(0, 16));
  return { current:{ time:t, precipitation:0, rain:0 }, hourly:{ time, precipitation:time.map(() => 0), precipitation_probability:time.map(() => 0) }, unavailable:true };
};

// Open-Meteo forecast: a fresh (< 20 min) localStorage copy skips the request; on failure retry once after 1.5 s,
// then fall back to the last good copy (marked stale) before giving up.
async function loadForecast() {
  const KEY = 'bkk-forecast', store = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const c = store(); if (c?.d?.hourly && Date.now() - c.t < 20 * 60e3) return c.d;
  const get = () => fetch(FEEDS.forecast.url).then(r => { if (!r.ok) throw new Error(`forecast ${r.status}`); return r.json(); });
  let d; try { d = await get(); } catch (e) { await new Promise(r => setTimeout(r, 1500)); try { d = await get(); } catch (e2) {
    if (c?.d?.hourly) { warnOnce('forecast-stale', `forecast: using cached copy (${e2.message})`); return { ...c.d, stale:true }; } throw e2; } }
  try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d })); } catch { /* storage blocked */ }
  return d;
}

// ThaiWater water level stations inside the Bangkok box. pct = % of bank = (level - ground) / (bank - ground).
export async function loadWaterLevel() {
  try {
    const r = await fetch(FEEDS.waterLevel.url); if (!r.ok) throw new Error(r.status);
    const rows = (await r.json())?.waterlevel_data?.data || [];
    const feats = rows.map(w => ({ w, s: w.station || {} })).filter(({ s }) => s.tele_station_long > BKK_BOX[0] && s.tele_station_long < BKK_BOX[2] && s.tele_station_lat > BKK_BOX[1] && s.tele_station_lat < BKK_BOX[3])
      .map(({ w, s }) => {
        const msl = +w.waterlevel_msl, ground = +s.ground_level, bank = +s.min_bank, ok = [msl, ground, bank].every(Number.isFinite) && bank > ground;
        const pct = ok ? Math.round(100 * (msl - ground) / (bank - ground)) : -1;
        return { type:'Feature', geometry:{ type:'Point', coordinates:[s.tele_station_long, s.tele_station_lat] },
          properties:{ name: s.tele_station_name?.en || s.tele_station_name?.th || 'Station', river: w.river_name || '', msl: Number.isFinite(msl) ? msl : null, bank: Number.isFinite(bank) ? bank : null,
            pct, band: pct < 0 ? 0 : pct < 70 ? 1 : pct <= 90 ? 2 : 3, label: pct < 0 ? '' : `${pct}%`, time: w.waterlevel_datetime || '', situation: w.situation_level ?? '' } };
      });
    return { type:'FeatureCollection', features: feats };
  } catch (e) { warnOnce('waterLevel', `waterLevel unavailable: ${e.message}`); return null; }
}

// Optional metro / sky train line geometry: osm-snapshot/transit.json (Overpass route relations, `out geom`). Resolves null if absent.
// Only requested when feeds.js declares a `transit` query (avoids a 404 in the console).
export const loadTransitLines = () => !OVERPASS_QUERIES.transit ? Promise.resolve(null) : once('transit', async () => {
  const r = await fetch(snapshotUrl('transit')); if (!r.ok) throw new Error(`no transit snapshot (${r.status})`);
  const raw = await r.json(), feats = [];
  for (const e of raw.elements || []) { const t = e.tags || {};
    const ways = (e.members || []).filter(m => m.type === 'way' && m.geometry?.length > 1).map(m => m.geometry.map(p => [p.lon, p.lat]));
    if (!ways.length) continue;
    const who = `${t.operator || ''} ${t['operator:en'] || ''} ${t.network || ''} ${t.name || ''} ${t['name:en'] || ''}`;
    const bts = /\bBTS\b|Bangkok Mass Transit System|บีทีเอส/i.test(who);
    const kind = bts ? 'sky' : t.route === 'subway' ? 'metro' : t.route === 'monorail' ? 'monorail' : 'people';
    const full = t['name:en'] || t.name || '', line = full.replace(/\s*\(.*$/, '').replace(/\s+Supplementary Route$/i, '').trim();
    feats.push({ type:'Feature', geometry:{ type:'MultiLineString', coordinates:ways }, properties:{ name: full, line, ref: t.ref || '', operator: t['operator:en'] || t.operator || '', color: /^#[0-9a-f]{3,8}$/i.test(t.colour || '') ? t.colour : '', kind } }); }
  if (!feats.length) throw new Error('empty transit snapshot');
  return { type:'FeatureCollection', features: feats };
});

// Snap a point to the nearest transit line within `maxM` metres. Returns { line, color, kind, operator } or null.
let segCache = null;
export function snapToTransit(fc, lon, lat, maxM = 100) {
  if (!fc) return null;
  if (!segCache || segCache.fc !== fc) {
    const segs = [];
    for (const f of fc.features) for (const w of f.geometry.coordinates) for (let i = 1; i < w.length; i++) segs.push([w[i-1][0], w[i-1][1], w[i][0], w[i][1], f.properties]);
    segCache = { fc, segs };
  }
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, pad = maxM / 90000;
  let best = null, bd = maxM;
  for (const [x1, y1, x2, y2, p] of segCache.segs) {
    if (lon < Math.min(x1, x2) - pad || lon > Math.max(x1, x2) + pad || lat < Math.min(y1, y2) - pad || lat > Math.max(y1, y2) + pad) continue;
    const ax = (x1 - lon) * kx, ay = (y1 - lat) * ky, bx = (x2 - lon) * kx, by = (y2 - lat) * ky, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0, dist = Math.hypot(ax + t * dx, ay + t * dy);
    if (dist < bd) { bd = dist; best = p; }
  }
  return best ? { line: best.line || best.name, color: best.color, kind: best.kind, operator: best.operator } : null;
}
export const distM = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110540);

export async function loadData() {
  const j = u => fetch(u).then(r => { if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.json(); });
  const soft = (key, p, fallback) => p.catch(e => { warnOnce(key, `${key} unavailable: ${e.message}`); return fallback; });
  const [roads, csv, radar, wx, water] = await Promise.all([
    j(FEEDS.floodRoads.url),
    soft('floodReports', fetch(FEEDS.floodReports.url).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }), ''),
    soft('radar', j(FEEDS.radar.url), null),
    soft('forecast', loadForecast(), emptyWx()),
    Promise.race([loadWaterLevel(), new Promise(r => setTimeout(() => r(null), 7000))]),
  ]);
  for (const f of roads.features) {
    const p = f.properties;
    p.sedan = p.cleared ? 'ok' : (p.verdict?.sedan || 'ok');
    p.sev = SEV[p.sedan] || 1;
    p.named = !!(p.nameEn || p.name);
    p.label = p.nameEn || p.name || `Unnamed ${p.hw || ''} road`;
    p.motorbike = p.verdict?.motorbike || ''; p.pickup = p.verdict?.pickup || ''; p.truck = p.verdict?.truck || '';
    p.srcs = (p.sources || []).join(', ');
  }
  const reports = { type:'FeatureCollection', features: csv ? parseCSV(csv)
    .filter(r => r.lat && r.lon && r.cleared !== 'true' && !BLOCKED_SOURCES.has(r.source))
    .map(r => ({ type:'Feature', geometry:{ type:'Point', coordinates:[+r.lon, +r.lat] },
      properties:{ depth: r.depth_cm ? +r.depth_cm : 0, closed: r.closed_all === 'true', source: r.source, tier: r.tier, ver: r.source === 'traffy' ? 'traffy' : r.tier === 'official' ? 'verified' : 'unverified', time: r.time_utc,
        text: r.source === 'crowd' || r.source === 'traffy' ? (r.text || '').slice(0, 140) : '' } })) : [] };
  const frames = radar?.radar ? [...radar.radar.past, ...(radar.radar.nowcast || [])].map(f => ({ kind: radar.radar.past.includes(f) ? 'radar' : 'nowcast', time:f.time, url:`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, nowcast: !radar.radar.past.includes(f) })) : [];
  const counts = { blocked:0, risky:0, caution:0, ok:0 };
  roads.features.forEach(f => counts[f.properties.sedan]++);
  const updated = Math.max(...roads.features.map(f => f.properties.updated || 0));
  return { roads, reports, frames, wx, counts, updated, water: water || { type:'FeatureCollection', features:[] } };
}

// ---- lazy extras (OSM via the shared Overpass queue, Open-Meteo grid). Each resolves to data or null (and warns once).
const memo = {};
const once = (key, fn) => memo[key] ||= fn().catch(e => { warnOnce(key, `${key} unavailable: ${e.message}`); return null; });

// OSM layers: the committed snapshot (osm-snapshot/, same queries as feeds.js, ODbL) is loaded first so the layers
// paint at once and the console stays clean. Live Overpass hosts are not called from the 2D view: they refuse or
// time out from browsers and every failed request is a console error. A 24 h localStorage copy written by
// feeds.js (if another view fetched live data) wins over the snapshot.
async function overpassRaw(key) {
  try { const c = JSON.parse(localStorage.getItem(`bkk-overpass:${key}`) || 'null'); if (c && Date.now() - c.t < 24 * 3600e3 && c.d?.elements) return c.d; } catch { /* storage blocked */ }
  const r = await fetch(snapshotUrl(key)); if (!r.ok) throw new Error(`snapshot ${key} ${r.status}`);
  return r.json();
}
export const loadPoints = key => once(key, async () => {
  const d = await overpassRaw(key);
  return { type:'FeatureCollection', features: d.elements
    .map(e => ({ lon: e.lon ?? e.center?.lon, lat: e.lat ?? e.center?.lat, tags: e.tags || {}, id: `${e.type}/${e.id}` }))
    .filter(e => Number.isFinite(e.lon) && Number.isFinite(e.lat))
    .map(e => ({ type:'Feature', id:e.id, properties:e.tags, geometry:{ type:'Point', coordinates:[e.lon, e.lat] } })) };
});

export const loadForecastGrid = () => once('forecastGrid', async () => {
  const r = await fetch(FEEDS.forecastGrid.url); if (!r.ok) throw new Error(r.status);
  const arr = await r.json();
  const q = new URL(FEEDS.forecastGrid.url).searchParams, lat = q.get('latitude').split(',').map(Number), lon = q.get('longitude').split(',').map(Number);
  return arr.map((res, i) => ({ lat: lat[i], lon: lon[i], time: res.hourly.time, mm: res.hourly.precipitation }));
});

// Open-Meteo at each district centroid (one batched call, same query as the 3x3 grid but with our own points).
export const loadDistrictRain = labels => once('districtRain', async () => {
  const pts = labels.features.slice(0, 50).map(f => ({ name: f.properties.name, lon: +f.geometry.coordinates[0].toFixed(3), lat: +f.geometry.coordinates[1].toFixed(3) }));
  if (pts.length < 2) throw new Error('too few districts');
  const u = new URL(FEEDS.forecastGrid.url);
  u.searchParams.set('latitude', pts.map(p => p.lat).join(',')); u.searchParams.set('longitude', pts.map(p => p.lon).join(','));
  const r = await fetch(u); if (!r.ok) throw new Error(r.status);
  const arr = await r.json(); if (!Array.isArray(arr)) throw new Error('unexpected response');
  return arr.map((res, i) => ({ ...pts[i], time: res.hourly.time, mm: res.hourly.precipitation }));
});

// River discharge (Open-Meteo Flood API, GloFAS 5 km cells): Chao Phraya at Bangkok plus two canal cells. m3/s, daily, 7 d back + 14 d ahead.
const FLOW_FALLBACK = 'https://flood-api.open-meteo.com/v1/flood?latitude=13.775,14.025&longitude=100.525,100.525&daily=river_discharge&past_days=7&forecast_days=14';
export const loadDischarge = () => once('discharge', async () => {
  const r = await fetch((FEEDS.riverDischarge || FEEDS.floodApi || {}).url || FLOW_FALLBACK); if (!r.ok) throw new Error(r.status);
  const arr = await r.json(); if (!Array.isArray(arr)) throw new Error('unexpected response');
  return arr.map(res => ({ name: `${Math.max(...res.daily.river_discharge) > 100 ? 'Chao Phraya main channel' : 'Canal cell'} (${res.latitude.toFixed(2)}°N)`, lat: res.latitude, lon: res.longitude, days: res.daily.time, q: res.daily.river_discharge }))
    .sort((a, b) => Math.max(...b.q) - Math.max(...a.q));
});

// Stitch member ways (arrays of [lon,lat]) into closed rings.
export function stitch(ways) {
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
  const pool = ways.filter(w => w.length > 1).map(w => w.slice()), rings = [];
  while (pool.length) {
    let cur = pool.shift();
    for (let guard = 0; guard < 500 && !eq(cur[0], cur[cur.length - 1]); guard++) {
      const end = cur[cur.length - 1];
      const i = pool.findIndex(w => eq(w[0], end) || eq(w[w.length - 1], end));
      if (i < 0) break;
      const w = pool.splice(i, 1)[0]; if (!eq(w[0], end)) w.reverse();
      cur = cur.concat(w.slice(1));
    }
    if (cur.length >= 4) { if (!eq(cur[0], cur[cur.length - 1])) cur.push(cur[0]); rings.push(cur); }
  }
  return rings;
}
const ringArea = r => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2;
function ringCentroid(r) {
  const A = ringArea(r); if (!A) return r[0];
  let cx = 0, cy = 0;
  r.forEach((p, i) => { const q = r[(i + 1) % r.length], c = p[0] * q[1] - q[0] * p[1]; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; });
  return [cx / (6 * A), cy / (6 * A)];
}
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };

// Districts (khet): polygons + label points, each with `signals` = open reports + risky/blocked road segments inside.
export const loadDistricts = d => once('districts', async () => {
  const raw = await overpassRaw('districts');
  const polys = [], labels = [], hot = [
    ...d.reports.features.map(f => f.geometry.coordinates),
    ...d.roads.features.filter(f => f.properties.sev >= 3).map(f => { const b = bbox(f.geometry); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; })];
  for (const e of raw.elements) {
    const outers = (e.members || []).filter(m => m.type === 'way' && m.role === 'outer' && m.geometry).map(m => m.geometry.map(p => [p.lon, p.lat]));
    const rings = stitch(outers); if (!rings.length) continue;
    const t = e.tags || {}, name = (t['name:en'] || t.name || '').replace(/^เขต/, '').replace(/\s+District$/i, '').trim() || 'District';
    const bb = rings.map(r => { const xs = r.map(p => p[0]), ys = r.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
    const signals = hot.filter(([x, y]) => rings.some((r, i) => x >= bb[i][0] && x <= bb[i][2] && y >= bb[i][1] && y <= bb[i][3] && inRing(x, y, r))).length;
    const props = { name, nameTh: t['name:th'] || t.name || '', population: t.population ? +t.population : 0, signals };
    polys.push({ type:'Feature', properties:props, geometry:{ type:'MultiPolygon', coordinates: rings.map(r => [r]) } });
    const big = rings.reduce((a, r) => Math.abs(ringArea(r)) > Math.abs(ringArea(a)) ? r : a);
    labels.push({ type:'Feature', properties:props, geometry:{ type:'Point', coordinates: ringCentroid(big) } });
  }
  if (!polys.length) throw new Error('no district polygons');
  return { polys:{ type:'FeatureCollection', features:polys }, labels:{ type:'FeatureCollection', features:labels } };
});

export function bbox(geom) {
  const b = [180, 90, -180, -90];
  JSON.stringify(geom.coordinates).match(/-?\d+\.?\d*,-?\d+\.?\d*/g).forEach(pair => {
    const [x, y] = pair.split(',').map(Number);
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  });
  return b;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m/60)} h ago` : `${Math.round(m/1440)} d ago`; };
export const hhmm = s => new Date(s * 1000).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Bangkok' });

export function rainSummary(wx) {
  const now = wx.current?.precipitation ?? 0, h = wx.hourly, i = h.time.findIndex(t => t >= wx.current.time.slice(0, 13));
  const next6 = h.precipitation.slice(i, i + 6).reduce((a, b) => a + b, 0);
  const maxP = Math.max(...h.precipitation_probability.slice(i, i + 24));
  return { now, next6: +next6.toFixed(1), maxP };
}

export const worst = d => d.roads.features.filter(f => f.properties.sev >= 2)
  .sort((a, b) => b.properties.sev - a.properties.sev || b.properties.named - a.properties.named || (b.properties.depthCm || 0) - (a.properties.depthCm || 0));

// Start where trouble is densest: ~2 km grid cells over hot roads + open reports inside Bangkok.
export function centerOfTrouble(d) {
  const pts = [
    ...d.roads.features.filter(f => f.properties.sev >= 3).map(f => { const b = bbox(f.geometry); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }),
    ...d.reports.features.map(f => f.geometry.coordinates),
  ].filter(([x, y]) => x > BKK_BOX[0] && x < BKK_BOX[2] && y > BKK_BOX[1] && y < BKK_BOX[3]);
  const cells = {}; for (const [x, y] of pts) { const k = `${Math.floor(x / .02)},${Math.floor(y / .02)}`; (cells[k] ||= []).push([x, y]); }
  const best = Object.values(cells).sort((a, b) => b.length - a.length)[0];
  return best ? [best.reduce((a, p) => a + p[0], 0) / best.length, best.reduce((a, p) => a + p[1], 0) / best.length] : BKK;
}

// ---- point on a road geometry (middle vertex) ----
export function midPoint(geom) {
  const lines = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
  const line = lines.reduce((a, l) => l.length > a.length ? l : a, []);
  return line[Math.floor(line.length / 2)];
}

// ---- depth words (ankle / knee / waist / over head) ----
export const depthWord = cm => cm < 35 ? 'ankle' : cm < 70 ? 'knee' : cm < 120 ? 'waist' : 'over head';
export const depthText = cm => `${depthWord(cm)} ${cm >= 150 ? '150+' : Math.round(cm)} cm`;

// Points that carry a depth: reports with depth_cm and roads with depthCm (one label per ~150 m cell, deepest wins).
export function depthPoints(d) {
  const all = [
    ...d.reports.features.filter(f => f.properties.depth > 0).map(f => ({ at:f.geometry.coordinates, cm:f.properties.depth, src:'report', road:'' })),
    ...d.roads.features.filter(f => f.properties.depthCm > 0 && f.properties.sev >= 2).map(f => ({ at:midPoint(f.geometry), cm:f.properties.depthCm, src:'road', road:f.properties.label })),
  ].sort((a, b) => b.cm - a.cm), seen = new Set(), out = [];
  for (const p of all) {
    const k = `${Math.round(p.at[0] / .0015)},${Math.round(p.at[1] / .0015)}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ type:'Feature', geometry:{ type:'Point', coordinates:p.at }, properties:{ cm:p.cm, text:depthText(p.cm), deep:p.cm >= 120 ? 1 : 0, src:p.src, road:p.road } });
  }
  return { type:'FeatureCollection', features: out };
}

// ---- derived danger grid: hex cells (circumradius HEX deg, ~2.2 km) scored from roads, reports and rain ----
const HEX = 0.02, S3 = Math.sqrt(3);
const hexOf = (x, y) => { // pointy-top axial rounding
  const q = (S3 / 3 * x - y / 3) / HEX, r = (2 / 3 * y) / HEX, cx = q, cz = r, cy = -cx - cz;
  let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
  const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return [rx, rz];
};
const hexPoly = (q, r) => { const cx = HEX * S3 * (q + r / 2), cy = HEX * 1.5 * r;
  const ring = Array.from({ length: 7 }, (_, i) => { const a = Math.PI / 180 * (60 * (i % 6) - 30); return [cx + HEX * Math.cos(a), cy + HEX * Math.sin(a)]; });
  return { ring, center:[cx, cy] }; };
const DG_LEVEL = s => s >= 12 ? 3 : s >= 4 ? 2 : s >= 1 ? 1 : 0;
export const DG_NAMES = ['', 'watch', 'warning', 'danger'];
const dgCache = new WeakMap();
// grid = loadForecastGrid() result or null. Cells with no signal are not drawn.
export function dangerGrid(d, grid) {
  const key = grid || 0; let c = dgCache.get(d); if (!c) dgCache.set(d, c = new Map());
  if (c.has(key)) return c.get(key);
  const cells = new Map(), cell = (x, y) => { const [q, r] = hexOf(x, y), k = `${q},${r}`; let o = cells.get(k); if (!o) cells.set(k, o = { q, r, blocked:0, risky:0, reports:0, closed:0, rain6:0 }); return o; };
  const inBox = ([x, y]) => x > BKK_BOX[0] && x < BKK_BOX[2] && y > BKK_BOX[1] && y < BKK_BOX[3];
  for (const f of d.roads.features) { const p = f.properties; if (p.sev < 3) continue; const m = midPoint(f.geometry); if (!inBox(m)) continue; cell(...m)[p.sev === 4 ? 'blocked' : 'risky']++; }
  for (const f of d.reports.features) { const m = f.geometry.coordinates; if (!inBox(m)) continue; const o = cell(...m); o.reports++; if (f.properties.closed) o.closed++; }
  if (grid) { // rain: cells within ~0.12 deg of a grid point that expects >= 1 mm in 6 h
    const i0 = Math.max(0, grid[0].time.findIndex(t => t >= d.wx.current.time.slice(0, 13))), n6 = g => g.mm.slice(i0, i0 + 6).reduce((a, b) => a + b, 0);
    for (const g of grid) { const mm = n6(g); if (mm < 1) continue;
      for (let dx = -.12; dx <= .12; dx += HEX) for (let dy = -.12; dy <= .12; dy += HEX) { const o = cell(g.lon + dx, g.lat + dy); o.rain6 = Math.max(o.rain6, +mm.toFixed(1)); } }
  }
  const feats = [];
  for (const o of cells.values()) {
    const score = 3 * o.blocked + o.risky + .5 * o.reports + o.closed + (o.rain6 >= 5 ? 2 : o.rain6 >= 1 ? 1 : 0), level = DG_LEVEL(score);
    if (!level) continue;
    const { ring } = hexPoly(o.q, o.r);
    feats.push({ type:'Feature', geometry:{ type:'Polygon', coordinates:[ring] }, properties:{ level, name:DG_NAMES[level], score:+score.toFixed(1), blocked:o.blocked, risky:o.risky, reports:o.reports, closed:o.closed, rain6:o.rain6 } });
  }
  const fc = { type:'FeatureCollection', features: feats }; c.set(key, fc); return fc;
}
