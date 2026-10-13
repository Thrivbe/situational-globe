// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- throwaway port of the Bangkok prototype's feed shaping.
import { FEEDS } from './feeds';

export type FloodFetchState = 'ok' | 'failed' | 'pending';
export type FloodFeatureCollection = { type: 'FeatureCollection'; features: Array<Record<string, unknown>> };
export type FloodRadarFrame = { time: number; url: string; nowcast: boolean };

export interface FloodData {
  roads: FloodFeatureCollection;
  reports: FloodFeatureCollection;
  districts: FloodFeatureCollection;
  hospitals: FloodFeatureCollection;
  shelters: FloodFeatureCollection;
  pumping: FloodFeatureCollection;
  transit: FloodFeatureCollection;
  frames: FloodRadarFrame[];
  radar: unknown;
  forecast: unknown;
}

const FETCH_KEYS = ['roads', 'reports', 'radar', 'forecast', 'districts', 'hospitals', 'shelters', 'pumping', 'transit'] as const;
const fetches = Object.fromEntries(FETCH_KEYS.map(key => [key, 'pending'])) as Record<(typeof FETCH_KEYS)[number], FloodFetchState>;
const EMPTY = (): FloodFeatureCollection => ({ type: 'FeatureCollection', features: [] });
const BLOCKED_SOURCES = new Set(['news', 'social_fb']);
const SEVERITY = { blocked: 4, risky: 3, caution: 2, ok: 1 };
const HOTSPOT_FALLBACK: [number, number] = [100.5608, 13.7385];
let flyToCenter: [number, number] = HOTSPOT_FALLBACK;
let floodDataPromise: Promise<FloodData> | null = null;

export function getFloodFetches(): Record<string, FloodFetchState> {
  return { ...fetches };
}

export function getFloodFlyToCenter(): [number, number] {
  return [...flyToCenter];
}

function warnFeed(key: string, error: unknown) {
  console.warn(`[flood] ${key} unavailable:`, error instanceof Error ? error.message : error);
}

async function fetchJson(key: keyof typeof fetches, url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    fetches[key] = 'ok';
    return data;
  } catch (error) {
    fetches[key] = 'failed';
    warnFeed(key, error);
    return EMPTY();
  }
}

async function fetchText(key: keyof typeof fetches, url: string): Promise<string | FloodFeatureCollection> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.text();
    fetches[key] = 'ok';
    return data;
  } catch (error) {
    fetches[key] = 'failed';
    warnFeed(key, error);
    return EMPTY();
  }
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() ?? []).map(header => header.replace(/^﻿/, ''));
  return rows
    .filter(values => values.length === headers.length)
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

function shapeRoads(raw: unknown): FloodFeatureCollection {
  const roads = raw?.type === 'FeatureCollection' && Array.isArray(raw.features) ? raw : EMPTY();
  return {
    type: 'FeatureCollection',
    features: roads.features.map(feature => {
      const properties = { ...(feature.properties ?? {}) };
      const sedan = properties.cleared ? 'ok' : (properties.verdict?.sedan || 'ok');
      return {
        ...feature,
        properties: {
          ...properties,
          sedan,
          sev: SEVERITY[sedan] || 1,
          label: properties.nameEn || properties.name || `Unnamed ${properties.hw || ''} road`,
        },
      };
    }),
  };
}

function shapeReports(raw: string | FloodFeatureCollection): FloodFeatureCollection {
  if (typeof raw !== 'string') return EMPTY();
  return {
    type: 'FeatureCollection',
    features: parseCsv(raw)
      .filter(row => row.lat && row.lon && row.cleared !== 'true' && !BLOCKED_SOURCES.has(row.source))
      .map(row => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [+row.lon, +row.lat] },
        properties: {
          depth: row.depth_cm ? +row.depth_cm : 0,
          closed: row.closed_all === 'true',
          source: row.source,
          tier: row.tier,
          verified: row.tier === 'official',
          time: row.time_utc,
        },
      }))
      .filter(feature => feature.geometry.coordinates.every(Number.isFinite)),
  };
}

function shapeRadar(raw: unknown): FloodRadarFrame[] {
  if (!raw?.radar) return [];
  const past = Array.isArray(raw.radar.past) ? raw.radar.past : [];
  const nowcast = Array.isArray(raw.radar.nowcast) ? raw.radar.nowcast : [];
  return [...past, ...nowcast]
    .filter(frame => frame && Number.isFinite(frame.time) && typeof frame.path === 'string' && typeof raw.host === 'string')
    .map(frame => ({
      time: frame.time,
      url: `${raw.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
      nowcast: nowcast.includes(frame),
    }));
}

function shapePoints(raw: unknown): FloodFeatureCollection {
  const elements = Array.isArray(raw?.elements) ? raw.elements : [];
  return {
    type: 'FeatureCollection',
    features: elements
      .map(element => ({
        element,
        lon: element.lon ?? element.center?.lon,
        lat: element.lat ?? element.center?.lat,
      }))
      .filter(item => Number.isFinite(item.lon) && Number.isFinite(item.lat))
      .map(({ element, lon, lat }) => ({
        type: 'Feature',
        id: `${element.type}/${element.id}`,
        properties: element.tags ?? {},
        geometry: { type: 'Point', coordinates: [lon, lat] },
      })),
  };
}

function shapeTransit(raw: unknown): FloodFeatureCollection {
  const features = [];
  for (const element of Array.isArray(raw?.elements) ? raw.elements : []) {
    const tags = element.tags ?? {};
    const ways = (element.members ?? [])
      .filter(member => member.type === 'way' && member.geometry?.length > 1)
      .map(member => member.geometry.map(point => [point.lon, point.lat]));
    if (!ways.length) continue;
    const who = `${tags.operator || ''} ${tags['operator:en'] || ''} ${tags.network || ''} ${tags.name || ''} ${tags['name:en'] || ''}`;
    const bts = /\bBTS\b|Bangkok Mass Transit System|บีทีเอส/i.test(who);
    const kind = bts ? 'sky' : tags.route === 'subway' ? 'metro' : tags.route === 'monorail' ? 'monorail' : 'people';
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: ways },
      properties: {
        name: tags['name:en'] || tags.name || '',
        operator: tags['operator:en'] || tags.operator || '',
        color: /^#[0-9a-f]{3,8}$/i.test(tags.colour || '') ? tags.colour : '',
        kind,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function stitch(ways: number[][][]): number[][][] {
  const equal = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];
  const pool = ways.filter(way => way.length > 1).map(way => way.slice());
  const rings = [];
  while (pool.length) {
    let current = pool.shift();
    for (let guard = 0; guard < 500 && !equal(current[0], current[current.length - 1]); guard++) {
      const end = current[current.length - 1];
      const index = pool.findIndex(way => equal(way[0], end) || equal(way[way.length - 1], end));
      if (index < 0) break;
      const way = pool.splice(index, 1)[0];
      if (!equal(way[0], end)) way.reverse();
      current = current.concat(way.slice(1));
    }
    if (current.length >= 4) {
      if (!equal(current[0], current[current.length - 1])) current.push(current[0]);
      rings.push(current);
    }
  }
  return rings;
}

function geometryPoints(geometry: unknown): number[][] {
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  const points = [];
  const visit = value => {
    if (Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)) points.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  visit(coordinates);
  return points;
}

function middle(geometry: unknown): number[] | null {
  const points = geometryPoints(geometry);
  return points.length ? points[Math.floor(points.length / 2)] : null;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > y) !== (ring[j][1] > y)
      && x < (ring[j][0] - ring[i][0]) * (y - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
  }
  return inside;
}

function shapeDistricts(raw: unknown, roads: FloodFeatureCollection, reports: FloodFeatureCollection): FloodFeatureCollection {
  const hot = [
    ...reports.features.map(feature => feature.geometry?.coordinates),
    ...roads.features.filter(feature => feature.properties?.sev >= 3).map(feature => middle(feature.geometry)),
  ].filter(point => Array.isArray(point));
  const features = [];
  for (const element of Array.isArray(raw?.elements) ? raw.elements : []) {
    const outerWays = (element.members ?? [])
      .filter(member => member.type === 'way' && member.role === 'outer' && member.geometry)
      .map(member => member.geometry.map(point => [point.lon, point.lat]));
    const rings = stitch(outerWays);
    if (!rings.length) continue;
    const tags = element.tags ?? {};
    const signals = hot.filter(([x, y]) => rings.some(ring => inRing(x, y, ring))).length;
    features.push({
      type: 'Feature',
      properties: {
        name: (tags['name:en'] || tags.name || 'District').replace(/^เขต/, '').replace(/\s+District$/i, '').trim(),
        nameTh: tags['name:th'] || tags.name || '',
        signals,
      },
      geometry: { type: 'MultiPolygon', coordinates: rings.map(ring => [ring]) },
    });
  }
  return { type: 'FeatureCollection', features };
}

// Prototype hotspot: a smoothed flood-signal cluster, biased toward Bangkok's dense building core.
function hotspot(data: Pick<FloodData, 'roads' | 'reports'>): [number, number] {
  const cells = new Map<string, number>();
  const add = (x: number, y: number, weight: number) => {
    const key = `${Math.floor(x / 0.01)},${Math.floor(y / 0.01)}`;
    cells.set(key, (cells.get(key) ?? 0) + weight);
  };
  const near = (x: number, y: number) => Math.hypot((x - HOTSPOT_FALLBACK[0]) * 108, (y - HOTSPOT_FALLBACK[1]) * 111) < 30;
  for (const feature of data.reports.features) {
    const [x, y] = feature.geometry.coordinates;
    if (near(x, y)) add(x, y, feature.properties.closed ? 3 : 1.5);
  }
  for (const feature of data.roads.features) {
    if (feature.properties.sev < 3) continue;
    const weight = feature.properties.sev === 4 ? 1 : 0.6;
    for (const [x, y] of geometryPoints(feature.geometry)) if (near(x, y)) add(x, y, weight);
  }
  let best: [number, number] | null = null;
  let bestScore = 0;
  for (const key of cells.keys()) {
    const [i, j] = key.split(',').map(Number);
    let score = 0;
    let sx = 0;
    let sy = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const value = cells.get(`${i + a},${j + b}`) ?? 0;
      score += value;
      sx += value * (i + a + 0.5);
      sy += value * (j + b + 0.5);
    }
    const center: [number, number] = [sx / score * 0.01, sy / score * 0.01];
    const km = Math.hypot((center[0] - HOTSPOT_FALLBACK[0]) * 108, (center[1] - HOTSPOT_FALLBACK[1]) * 111);
    score *= 1 + 1.2 * Math.exp(-((km / 12) ** 2));
    if (score > bestScore) { bestScore = score; best = center; }
  }
  return best
    ? [HOTSPOT_FALLBACK[0] + 0.85 * (best[0] - HOTSPOT_FALLBACK[0]), HOTSPOT_FALLBACK[1] + 0.85 * (best[1] - HOTSPOT_FALLBACK[1])]
    : HOTSPOT_FALLBACK;
}

async function fetchFloodData(): Promise<FloodData> {
  const [roadsRaw, reportsRaw, radarRaw, forecast, districtsRaw, hospitalsRaw, sheltersRaw, pumpingRaw, transitRaw] = await Promise.all([
    fetchJson('roads', FEEDS.floodRoads.url),
    fetchText('reports', FEEDS.floodReports.url),
    fetchJson('radar', FEEDS.radar.url),
    fetchJson('forecast', FEEDS.forecast.url),
    fetchJson('districts', FEEDS.districts.url),
    fetchJson('hospitals', FEEDS.hospitals.url),
    fetchJson('shelters', FEEDS.shelters.url),
    fetchJson('pumping', FEEDS.pumping.url),
    fetchJson('transit', FEEDS.transit.url),
  ]);
  const roads = shapeRoads(roadsRaw);
  const reports = shapeReports(reportsRaw);
  const data: FloodData = {
    roads,
    reports,
    radar: radarRaw,
    frames: shapeRadar(radarRaw),
    forecast,
    districts: shapeDistricts(districtsRaw, roads, reports),
    hospitals: shapePoints(hospitalsRaw),
    shelters: shapePoints(sheltersRaw),
    pumping: shapePoints(pumpingRaw),
    transit: shapeTransit(transitRaw),
  };
  flyToCenter = hotspot(data);
  return data;
}

export function loadFloodData(): Promise<FloodData> {
  floodDataPromise ??= fetchFloodData().catch(error => {
    warnFeed('load', error);
    for (const key of FETCH_KEYS) if (fetches[key] === 'pending') fetches[key] = 'failed';
    return {
      roads: EMPTY(), reports: EMPTY(), districts: EMPTY(), hospitals: EMPTY(), shelters: EMPTY(), pumping: EMPTY(), transit: EMPTY(),
      frames: [], radar: EMPTY(), forecast: EMPTY(),
    };
  });
  return floodDataPromise;
}
