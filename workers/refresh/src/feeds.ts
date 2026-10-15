import type { FeatureCollection, Geometry, Position } from 'geojson';
import type { ForecastGridPoint } from '../../../src/situations/bangkok-flood-2026/derive';

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ForecastData = {
  current: Record<string, unknown>;
  hourly: Record<string, unknown>;
};

export type DistrictRain = Record<string, unknown> & {
  name: string;
  lat: number;
  lon: number;
  time: string[];
  mm: (number | null)[];
};

export type RiverDischarge = Record<string, unknown> & {
  name: string;
  lat: number;
  lon: number;
  days: string[];
  q: number[];
};

export const USER_AGENT = 'situational-globe-refresh (+https://github.com/Thrivbe/situational-globe)';
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 15_000;

export const FEED_URLS = {
  floodRoads: 'https://floodboard.org/api/export/roads.geojson',
  floodReports: 'https://floodboard.org/api/export/reports.csv',
  forecast: 'https://api.open-meteo.com/v1/forecast?latitude=13.75&longitude=100.53&current=precipitation,rain,temperature_2m,relative_humidity_2m,wind_speed_10m,uv_index&hourly=precipitation,precipitation_probability&past_hours=12&forecast_hours=48&timezone=Asia/Bangkok',
  forecastGrid: 'https://api.open-meteo.com/v1/forecast?latitude=13.6,13.6,13.6,13.75,13.75,13.75,13.9,13.9,13.9&longitude=100.4,100.55,100.7,100.4,100.55,100.7,100.4,100.55,100.7&hourly=precipitation&past_hours=6&forecast_hours=24&timezone=Asia/Bangkok',
  riverDischarge: 'https://flood-api.open-meteo.com/v1/flood?latitude=13.775,14.025&longitude=100.525,100.525&daily=river_discharge&past_days=7&forecast_days=14',
} as const;

const GRID_POINTS = [
  { lat: 13.6, lon: 100.4 }, { lat: 13.6, lon: 100.55 }, { lat: 13.6, lon: 100.7 },
  { lat: 13.75, lon: 100.4 }, { lat: 13.75, lon: 100.55 }, { lat: 13.75, lon: 100.7 },
  { lat: 13.9, lon: 100.4 }, { lat: 13.9, lon: 100.55 }, { lat: 13.9, lon: 100.7 },
] as const;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cancelQuietly = async (body: ReadableStream<Uint8Array> | null): Promise<void> => {
  try { await body?.cancel(); } catch { /* preserve the original response error */ }
};

async function readCapped(response: Response, host: string): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    await cancelQuietly(response.body);
    throw new Error(`${host}: response body exceeds 5 MB`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* preserve the size error */ }
        throw new Error(`${host}: response body exceeds 5 MB`);
      }
      body += decoder.decode(result.value, { stream: true });
    }
    return body + decoder.decode();
  } catch (error) {
    if (error instanceof Error && error.message === `${host}: response body exceeds 5 MB`) throw error;
    throw new Error(`${host}: response body read failed`);
  }
}

export async function fetchText(
  fetcher: FetchFn,
  url: string,
  timeoutMs = FEED_TIMEOUT_MS,
): Promise<string> {
  const host = new URL(url).host;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const kind = error instanceof Error && error.name ? error.name : 'request error';
    throw new Error(`${host}: request failed (${kind})`);
  }
  if (!response.ok) {
    await cancelQuietly(response.body);
    const location = response.headers.get('location');
    const target = location && response.status >= 300 && response.status < 400
      ? ` → ${new URL(location, url).host}` : '';
    throw new Error(`${host}: HTTP ${response.status}${target}`);
  }
  return readCapped(response, host);
}

export async function fetchJson(fetcher: FetchFn, url: string, timeoutMs = FEED_TIMEOUT_MS): Promise<unknown> {
  const text = await fetchText(fetcher, url, timeoutMs);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${new URL(url).host}: invalid JSON`);
  }
}

function arrays(value: unknown, block: string, left: string, right: string): [unknown[], unknown[]] {
  if (!isRecord(value) || !isRecord(value[block])) throw new Error(`${block} data is missing`);
  const container = value[block];
  const first = container[left];
  const second = container[right];
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
    throw new Error(`${block}.${left} and ${block}.${right} arrays do not match`);
  }
  return [first, second];
}

function hourlyRain(value: unknown): { time: string[]; mm: (number | null)[] } {
  const [time, mm] = arrays(value, 'hourly', 'time', 'precipitation');
  return { time: time as string[], mm: mm as (number | null)[] };
}

export const fetchFloodRoads = (fetcher: FetchFn): Promise<unknown> => fetchJson(fetcher, FEED_URLS.floodRoads);
export const fetchFloodReports = (fetcher: FetchFn): Promise<string> => fetchText(fetcher, FEED_URLS.floodReports);

export async function fetchForecast(fetcher: FetchFn): Promise<ForecastData> {
  const value = await fetchJson(fetcher, FEED_URLS.forecast);
  if (!isRecord(value) || !isRecord(value.current) || !isRecord(value.hourly) ||
    typeof value.current.time !== 'string') {
    throw new Error('forecast response is missing current or hourly data');
  }
  const [time, precipitation] = arrays(value, 'hourly', 'time', 'precipitation');
  const probability = value.hourly.precipitation_probability;
  if (!Array.isArray(probability) || probability.length !== time.length || time.length === 0) {
    throw new Error('forecast hourly arrays do not match');
  }
  return {
    current: { ...value.current },
    hourly: { ...value.hourly, time, precipitation, precipitation_probability: probability },
  };
}

export async function fetchForecastGrid(fetcher: FetchFn): Promise<ForecastGridPoint[]> {
  const value = await fetchJson(fetcher, FEED_URLS.forecastGrid);
  if (!Array.isArray(value) || value.length !== GRID_POINTS.length) {
    throw new Error('forecast grid must contain nine results');
  }
  const grid = value.map((result, index) => ({ ...GRID_POINTS[index], ...hourlyRain(result) }));
  if (grid.flatMap((point) => point.mm).every((amount) => amount === null)) {
    throw new Error('forecast grid contains no precipitation values');
  }
  return grid;
}

function firstOuterRing(geometry: Geometry | null): Position[] {
  if (geometry?.type === 'Polygon') return geometry.coordinates[0] ?? [];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates[0]?.[0] ?? [];
  return [];
}

export function districtCentres(districts: FeatureCollection): { name: string; lat: number; lon: number }[] {
  return districts.features.flatMap((feature) => {
    const ring = firstOuterRing(feature.geometry);
    if (!ring.length) return [];
    const [longitude, latitude] = ring.reduce<[number, number]>(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0],
    ).map((sum) => sum / ring.length);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    const name = typeof feature.properties?.name === 'string' ? feature.properties.name : 'District';
    return [{ name, lon: Number(longitude.toFixed(3)), lat: Number(latitude.toFixed(3)) }];
  }).slice(0, 50);
}

export async function fetchDistrictRain(fetcher: FetchFn, districts: FeatureCollection): Promise<DistrictRain[]> {
  const points = districtCentres(districts);
  if (points.length < 2) throw new Error('too few districts');
  const url = new URL(FEED_URLS.forecastGrid);
  url.searchParams.set('latitude', points.map((point) => point.lat).join(','));
  url.searchParams.set('longitude', points.map((point) => point.lon).join(','));
  // ponytail: Open-Meteo took ~16 s for 50 points on 2026-10-15; the other feeds keep 15 s.
  const value = await fetchJson(fetcher, url.toString(), 30_000);
  if (!Array.isArray(value) || value.length !== points.length) {
    throw new Error('district rain result count does not match district centres');
  }
  return value.map((result, index) => ({ ...points[index], ...hourlyRain(result) }));
}

export async function fetchRiverDischarge(fetcher: FetchFn): Promise<RiverDischarge[]> {
  const value = await fetchJson(fetcher, FEED_URLS.riverDischarge);
  if (!Array.isArray(value) || value.length === 0) throw new Error('river response must be a non-empty array');
  return value.map((result, index) => {
    if (!isRecord(result) || typeof result.latitude !== 'number' || typeof result.longitude !== 'number') {
      throw new Error(`river result[${index}] has an invalid location`);
    }
    const [days, discharge] = arrays(result, 'daily', 'time', 'river_discharge');
    if (!days.length) throw new Error(`river result[${index}] daily arrays are empty`);
    const q = discharge as number[];
    const name = `${Math.max(...q) > 100 ? 'Chao Phraya main channel' : 'Canal cell'} (${result.latitude.toFixed(2)}°N)`;
    return { name, lat: result.latitude, lon: result.longitude, days: days as string[], q };
  }).sort((left, right) => Math.max(...right.q) - Math.max(...left.q));
}
