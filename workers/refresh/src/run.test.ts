import { readFileSync } from 'node:fs';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { Situation, Snapshot } from '../../../src/situations/types';
import { SITUATIONS } from '../../../src/situations/registry';
import {
  stationWater,
  type FloodData,
  type RoadProps,
} from '../../../src/situations/bangkok-flood-2026/derive';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type FeedPart } from './build';
import {
  districtCentres,
  FEED_URLS,
  fetchText,
  MAX_BODY_BYTES,
  USER_AGENT,
  type FetchFn,
} from './feeds';
import {
  runRefresh,
  type Env,
  type Reporter,
  type RunOptions,
  type SnapshotStore,
} from './run';
import {
  OSM_KEYS,
  OVERPASS_HOSTS,
  overpassUrl,
  seedOsm,
  type OsmKey,
} from './osm';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../src/situations/bangkok-flood-2026/__fixtures__/${name}`, import.meta.url), 'utf8');
const osmFixture = (key: OsmKey): unknown => JSON.parse(readFileSync(
  new URL(`../../../src/situations/bangkok-flood-2026/osm-seed/${key}.json`, import.meta.url), 'utf8',
)) as unknown;

const ROADS = fixture('roads.geojson');
const REPORTS = fixture('reports.csv');
const GRID = fixture('forecast-grid.json');
const SEED_OSM = seedOsm();
const SEED_RAW = Object.fromEntries(OSM_KEYS.map((key) => [key, osmFixture(key)])) as Record<OsmKey, unknown>;
const FEED_PARTS: FeedPart[] = ['roads', 'reports', 'forecast', 'grid', 'districtRain', 'river'];

const FORECAST = {
  current: {
    time: '2026-10-15T10:00', precipitation: 0.2, rain: 0.2,
    temperature_2m: 31, relative_humidity_2m: 78, wind_speed_10m: 8, uv_index: 4,
  },
  hourly: {
    time: ['2026-10-15T10:00', '2026-10-15T11:00'],
    precipitation: [0.2, 1.4],
    precipitation_probability: [40, 80],
  },
};

const RIVER = [
  {
    latitude: 13.775,
    longitude: 100.525,
    daily: { time: ['2026-10-15', '2026-10-16'], river_discharge: [12, 14] },
  },
  {
    latitude: 14.025,
    longitude: 100.525,
    daily: { time: ['2026-10-15', '2026-10-16'], river_discharge: [5_100, 5_300] },
  },
];

const rainResults = (count: number): unknown[] => Array.from({ length: count }, () => ({
  hourly: {
    time: ['2026-10-15T10:00', '2026-10-15T11:00'],
    precipitation: [0.1, 0.8],
  },
}));

function expectedDistrictRainUrl(districts: FeatureCollection): string {
  const points = districtCentres(districts);
  const url = new URL(FEED_URLS.forecastGrid);
  url.searchParams.set('latitude', points.map((point) => point.lat).join(','));
  url.searchParams.set('longitude', points.map((point) => point.lon).join(','));
  return url.toString();
}

class FakeR2 implements SnapshotStore {
  readonly objects = new Map<string, string>();
  readonly getErrors = new Set<string>();
  readonly puts: { key: string; value: string; contentType: string }[] = [];

  async get(key: string): Promise<{ json(): Promise<unknown> } | null> {
    if (this.getErrors.has(key)) throw new Error('R2 unavailable');
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return { json: async () => JSON.parse(value) as unknown };
  }

  async put(
    key: string,
    value: string,
    options: { httpMetadata: { contentType: string } },
  ): Promise<void> {
    this.objects.set(key, value);
    this.puts.push({ key, value, contentType: options.httpMetadata.contentType });
  }
}

type FetchCall = { url: string; init?: RequestInit };

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function mappedFetch(responses: Map<string, Response>, calls: FetchCall[] = []): FetchFn {
  return async (input, init) => {
    const url = requestUrl(input);
    calls.push({ url, init });
    const response = responses.get(url);
    if (!response) throw new Error(`unexpected request to ${new URL(url).host}`);
    if (!response.ok) return new Response(null, { status: response.status, headers: response.headers });
    return response.clone();
  };
}

function goodResponses(): Map<string, Response> {
  const points = districtCentres(SEED_OSM.districts);
  return new Map<string, Response>([
    [FEED_URLS.floodRoads, new Response(ROADS, { status: 200 })],
    [FEED_URLS.floodReports, new Response(REPORTS, { status: 200 })],
    [FEED_URLS.forecast, Response.json(FORECAST)],
    [FEED_URLS.forecastGrid, new Response(GRID, { status: 200 })],
    [expectedDistrictRainUrl(SEED_OSM.districts), Response.json(rainResults(points.length))],
    [FEED_URLS.riverDischarge, Response.json(RIVER)],
  ]);
}

function addSeedOverpass(responses: Map<string, Response>): void {
  for (const key of OSM_KEYS) responses.set(overpassUrl(key, OVERPASS_HOSTS[0]), Response.json(SEED_RAW[key]));
}

type Warning = { message: string; key: { localMap: string; part: string } };
type RunResult = { warnings: Warning[]; errors: unknown[]; sleeps: number[]; calls: FetchCall[] };

async function run(
  store: FakeR2,
  responses: Map<string, Response>,
  now: string,
  options: {
    scheduledTime?: string | number;
    situations?: readonly Situation[];
    calls?: FetchCall[];
    fetcher?: FetchFn;
    clock?: () => Date;
    builder?: RunOptions['builder'];
  } = {},
): Promise<RunResult> {
  const warnings: Warning[] = [];
  const errors: unknown[] = [];
  const sleeps: number[] = [];
  const calls = options.calls ?? [];
  const reporter: Reporter = {
    warn: (message, key) => { warnings.push({ message, key }); },
    error: (error) => { errors.push(error); },
  };
  const env: Env = { SNAPSHOTS: store, SENTRY_DSN: 'https://public@example.invalid/1' };
  const scheduledTime = typeof options.scheduledTime === 'number'
    ? options.scheduledTime : new Date(options.scheduledTime ?? now).getTime();
  await runRefresh(scheduledTime, env, {
    fetcher: options.fetcher ?? mappedFetch(responses, calls),
    reporter,
    now: options.clock ?? (() => new Date(now)),
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    ...(options.situations ? { situations: options.situations } : {}),
    ...(options.builder ? { builder: options.builder } : {}),
  });
  return { warnings, errors, sleeps, calls };
}

function snapshot(store: FakeR2, localMap = 'bangkok-flood'): Snapshot {
  const value = store.objects.get(`snapshots/${localMap}.json`);
  if (!value) throw new Error('snapshot was not written');
  return JSON.parse(value) as Snapshot;
}

async function previousSnapshot(now = '2026-10-15T10:00:00.000Z'): Promise<{ store: FakeR2; previous: Snapshot }> {
  const store = new FakeR2();
  await run(store, goodResponses(), now);
  store.puts.length = 0;
  return { store, previous: snapshot(store) };
}

const everyFeedFails = (): Map<string, Response> => new Map(
  [...goodResponses().keys()].map((url) => [url, new Response('upstream unavailable', { status: 503 })]),
);

function points(count: number): unknown {
  return {
    elements: Array.from({ length: count }, (_, index) => ({
      type: 'node', id: index + 1, lat: 13.7 + index / 100_000, lon: 100.5, tags: { name: `Point ${index}` },
    })),
  };
}

describe('refresh Worker', () => {
  it('writes a complete quarter-hour snapshot with feed request safeguards', async () => {
    const store = new FakeR2();
    const calls: FetchCall[] = [];
    const result = await run(store, goodResponses(), '2026-10-15T10:00:00.000Z', { calls });
    const value = snapshot(store);

    expect(Object.keys(value).sort()).toEqual([
      'builtAt', 'credits', 'feedsAt', 'flood', 'level', 'localMap', 'osm', 'situation', 'stationWater', 'weather',
    ]);
    expect(Object.keys(value.feedsAt).sort()).toEqual([...FEED_PARTS].sort());
    expect(store.puts).toHaveLength(1);
    expect(result).toMatchObject({ warnings: [], errors: [], sleeps: [] });
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call.init?.redirect).toBe('manual');
      expect(new Headers(call.init?.headers).get('User-Agent')).toBe(USER_AGENT);
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('at 03:00 writes fresh feeds first, refreshes OSM once, then writes the OSM snapshot', async () => {
    const { store, previous } = await previousSnapshot('2026-10-14T03:00:00.000Z');
    const responses = goodResponses();
    addSeedOverpass(responses);
    const now = '2026-10-15T03:00:30.000Z';
    const result = await run(store, responses, now, { scheduledTime: '2026-10-15T03:00:00.000Z' });

    expect(store.puts).toHaveLength(2);
    const first = JSON.parse(store.puts[0].value) as Snapshot;
    const second = JSON.parse(store.puts[1].value) as Snapshot;
    expect(first.feedsAt.roads).toBe(now);
    expect(first.osm.builtAt).toBe(previous.osm.builtAt);
    expect(second.osm.builtAt).toBe(now);
    expect({ ...second, osm: first.osm, stationWater: first.stationWater }).toEqual(first);
    expect(result.calls.filter((call) => call.url.includes('/api/interpreter'))).toHaveLength(OSM_KEYS.length);
  });

  it('at 03:15 makes no Overpass call', async () => {
    const { store } = await previousSnapshot();
    const result = await run(store, goodResponses(), '2026-10-15T03:15:30.000Z', {
      scheduledTime: '2026-10-15T03:15:00.000Z',
    });
    expect(store.puts).toHaveLength(1);
    expect(result.calls.some((call) => call.url.includes('/api/interpreter'))).toBe(false);
  });

  it('stops starting OSM keys after ten minutes and keeps unreached values', async () => {
    const { store, previous } = await previousSnapshot('2026-10-14T03:00:00.000Z');
    const responses = goodResponses();
    addSeedOverpass(responses);
    const calls: FetchCall[] = [];
    const baseFetch = mappedFetch(responses, calls);
    let clock = new Date('2026-10-15T03:00:00.000Z').getTime();
    const fetcher: FetchFn = async (input, init) => {
      const response = await baseFetch(input, init);
      if (requestUrl(input).includes('/api/interpreter')) clock += 4 * 60 * 1_000;
      return response;
    };
    await run(store, responses, new Date(clock).toISOString(), {
      scheduledTime: clock,
      calls,
      fetcher,
      clock: () => new Date(clock),
    });

    const attempted = calls.filter((call) => call.url.includes('/api/interpreter'));
    expect(attempted.map((call) => OSM_KEYS.find((key) => call.url === overpassUrl(key, OVERPASS_HOSTS[0]))))
      .toEqual(OSM_KEYS.slice(0, 3));
    const value = snapshot(store);
    for (const key of OSM_KEYS.slice(3)) expect(value.osm[key]).toEqual(previous.osm[key]);
    expect(value.osm.builtAt).toBe(previous.osm.builtAt);
  });

  it('reports corrupt JSON as invalid, seeds OSM, and still writes', async () => {
    const store = new FakeR2();
    store.objects.set('snapshots/bangkok-flood.json', '{bad JSON');
    const result = await run(store, goodResponses(), '2026-10-15T10:00:00.000Z');
    expect(result.errors).toHaveLength(1);
    expect(String(result.errors[0])).toMatch(/invalid previous snapshot.*JSON is invalid/);
    expect(snapshot(store).osm.builtAt).toBe(SEED_OSM.builtAt);
    expect(store.puts).toHaveLength(1);
  });

  it('rejects a previous snapshot with another localMap id and uses the seed', async () => {
    const { store, previous } = await previousSnapshot();
    store.objects.set('snapshots/bangkok-flood.json', JSON.stringify({
      ...previous,
      localMap: 'another-map',
      osm: { ...previous.osm, builtAt: '2000-01-01T00:00:00.000Z' },
    }));
    const result = await run(store, goodResponses(), '2026-10-15T10:15:00.000Z');
    expect(result.errors).toHaveLength(1);
    expect(String(result.errors[0])).toMatch(/invalid previous snapshot.*expected bangkok-flood-2026\/bangkok-flood/);
    expect(snapshot(store).osm.builtAt).toBe(SEED_OSM.builtAt);
  });

  it('rejects a previous snapshot whose copied-forward parts have the wrong containers', async () => {
    const { store, previous } = await previousSnapshot();
    store.objects.set('snapshots/bangkok-flood.json', JSON.stringify({
      ...previous,
      weather: { ...previous.weather, grid: {} },
    }));
    const result = await run(store, goodResponses(), '2026-10-15T10:15:00.000Z');
    expect(result.errors).toHaveLength(1);
    expect(String(result.errors[0])).toMatch(/invalid previous snapshot.*wrong container/);
    expect(store.puts).toHaveLength(1);
  });

  it('skips a map write when R2 get throws', async () => {
    const store = new FakeR2();
    store.getErrors.add('snapshots/bangkok-flood.json');
    const result = await run(store, goodResponses(), '2026-10-15T10:00:00.000Z');
    expect(result.errors).toHaveLength(1);
    expect(String(result.errors[0])).toMatch(/previous snapshot read failed.*R2 unavailable/);
    expect(result.calls).toHaveLength(0);
    expect(store.puts).toHaveLength(0);
  });

  it('keeps an OSM key when both hosts return a runtime-error remark', async () => {
    const { store, previous } = await previousSnapshot('2026-10-14T03:00:00.000Z');
    const responses = goodResponses();
    addSeedOverpass(responses);
    for (const host of OVERPASS_HOSTS) {
      responses.set(overpassUrl('hospitals', host), Response.json({
        remark: 'runtime error: Query timed out', elements: SEED_RAW.hospitals,
      }));
    }
    const result = await run(store, responses, '2026-10-15T03:00:00.000Z');
    expect(snapshot(store).osm.hospitals).toEqual(previous.osm.hospitals);
    expect(result.warnings.some(({ key }) => key.part === 'osm.hospitals')).toBe(true);
  });

  it('keeps 251 previous hospitals when Overpass returns only three', async () => {
    const { store, previous } = await previousSnapshot('2026-10-14T03:00:00.000Z');
    expect(previous.osm.hospitals.features).toHaveLength(251);
    const responses = goodResponses();
    addSeedOverpass(responses);
    for (const host of OVERPASS_HOSTS) responses.set(overpassUrl('hospitals', host), Response.json(points(3)));
    const result = await run(store, responses, '2026-10-15T03:00:00.000Z');
    expect(snapshot(store).osm.hospitals).toEqual(previous.osm.hospitals);
    expect(result.warnings.find(({ key }) => key.part === 'osm.hospitals')?.message).toMatch(/3 features.*251/);
  });

  it('rejects a roads regression from 1541 features to ten', async () => {
    const { store, previous } = await previousSnapshot();
    const tenRoads = previous.flood.roads.features.slice(0, 10);
    previous.flood.roads.features = Array.from({ length: 1_541 }, (_, index) =>
      previous.flood.roads.features[index % previous.flood.roads.features.length]);
    store.objects.set('snapshots/bangkok-flood.json', JSON.stringify(previous));
    const responses = goodResponses();
    responses.set(FEED_URLS.floodRoads, Response.json({ type: 'FeatureCollection', features: tenRoads }));
    const result = await run(store, responses, '2026-10-15T10:15:00.000Z');
    expect(snapshot(store).flood.roads.features).toHaveLength(1_541);
    expect(result.warnings.find(({ key }) => key.part === 'roads')?.message).toMatch(/10 features.*1541/);
  });

  it('rejects a flood feed that drops more than five percent of its records', async () => {
    const store = new FakeR2();
    const raw = JSON.parse(ROADS) as { features: unknown[] };
    const responses = goodResponses();
    responses.set(FEED_URLS.floodRoads, Response.json({
      type: 'FeatureCollection', features: [...raw.features.slice(0, 18), null, null],
    }));
    const result = await run(store, responses, '2026-10-15T10:00:00.000Z');
    expect(snapshot(store).flood.roads.features).toHaveLength(0);
    expect(result.warnings.find(({ key }) => key.part === 'roads')?.message).toMatch(/dropped 2 of 20.*10.0%/);
  });

  it('accepts zero reports only after the previous reports feed is more than three hours old', async () => {
    const { store, previous } = await previousSnapshot();
    expect(previous.flood.reports.features.length).toBeGreaterThan(50);
    const responses = goodResponses();
    responses.set(FEED_URLS.floodReports, new Response(
      'lat,lon,source,tier,depth_cm,closed_all,cleared,time_utc,text\n', { status: 200 },
    ));
    const recent = await run(store, responses, '2026-10-15T12:59:59.000Z');
    expect(snapshot(store).flood.reports.features.length).toBeGreaterThan(50);
    expect(recent.warnings.some(({ key }) => key.part === 'reports')).toBe(true);

    store.objects.set('snapshots/bangkok-flood.json', JSON.stringify(previous));
    const stale = await run(store, responses, '2026-10-15T13:00:01.000Z');
    expect(snapshot(store).flood.reports.features).toHaveLength(0);
    expect(stale.warnings.some(({ key }) => key.part === 'reports')).toBe(false);
  });

  it('rejects an all-null forecast grid', async () => {
    const { store, previous } = await previousSnapshot();
    const responses = goodResponses();
    responses.set(FEED_URLS.forecastGrid, Response.json(Array.from({ length: 9 }, () => ({
      hourly: { time: ['2026-10-15T10:00'], precipitation: [null] },
    }))));
    const result = await run(store, responses, '2026-10-15T10:15:00.000Z');
    expect(snapshot(store).weather.grid).toEqual(previous.weather.grid);
    expect(result.warnings.find(({ key }) => key.part === 'grid')?.message).toMatch(/no precipitation/);
  });

  it('rejects a forecast without current.time', async () => {
    const { store, previous } = await previousSnapshot();
    const responses = goodResponses();
    responses.set(FEED_URLS.forecast, Response.json({ ...FORECAST, current: { rain: 1 } }));
    const result = await run(store, responses, '2026-10-15T10:15:00.000Z');
    expect(snapshot(store).weather.current).toEqual(previous.weather.current);
    expect(result.warnings.some(({ key }) => key.part === 'forecast')).toBe(true);
  });

  it('rejects wrong-shape forecast, grid, and river responses even with HTTP 200', async () => {
    const { store, previous } = await previousSnapshot();
    const responses = goodResponses();
    responses.set(FEED_URLS.forecast, Response.json({ current: { time: 'now' }, hourly: { time: 'wrong' } }));
    responses.set(FEED_URLS.forecastGrid, Response.json([{}]));
    responses.set(FEED_URLS.riverDischarge, Response.json([{}]));
    const result = await run(store, responses, '2026-10-15T10:15:00.000Z');
    expect(result.warnings.filter(({ key }) => ['forecast', 'grid', 'river'].includes(key.part))).toHaveLength(3);
    expect(snapshot(store).weather).toEqual(previous.weather);
  });

  it('reports a redirect target by host and requests redirects manually', async () => {
    const { store } = await previousSnapshot();
    const responses = goodResponses();
    responses.set(FEED_URLS.floodRoads, new Response(null, {
      status: 301,
      headers: { location: 'https://redirected.example/private/path?token=nope' },
    }));
    const calls: FetchCall[] = [];
    const result = await run(store, responses, '2026-10-15T10:15:00.000Z', { calls });
    const roadsCall = calls.find((call) => call.url === FEED_URLS.floodRoads);
    const warning = result.warnings.find(({ key }) => key.part === 'roads')?.message ?? '';
    expect(roadsCall?.init?.redirect).toBe('manual');
    expect(warning).toContain('HTTP 301 → redirected.example');
    expect(warning).not.toContain('/private/path');
  });

  it('rejects a declared content length above 5 MB', async () => {
    const fetcher: FetchFn = async () => new Response('small', {
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
    });
    await expect(fetchText(fetcher, FEED_URLS.floodReports)).rejects.toThrow(/exceeds 5 MB/);
  });

  it('does not let a body cancellation rejection mask the size error', async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() { throw new Error('cancel exploded'); },
    });
    const fetcher: FetchFn = async () => new Response(body, {
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
    });
    await expect(fetchText(fetcher, FEED_URLS.floodReports)).rejects.toThrow(/exceeds 5 MB/);
  });

  it('aborts a stream that keeps producing past 5 MB without ending', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    const fetcher: FetchFn = async () => new Response(body);
    await expect(fetchText(fetcher, FEED_URLS.floodReports)).rejects.toThrow(/exceeds 5 MB/);
    expect(cancelled).toBe(true);
  });

  it('continues to map 2 when the builder throws for map 1', async () => {
    const store = new FakeR2();
    const situation: Situation = {
      ...SITUATIONS[0],
      localMaps: [
        { ...SITUATIONS[0].localMaps[0], id: 'map-1' },
        { ...SITUATIONS[0].localMaps[0], id: 'map-2' },
      ],
    };
    const result = await run(store, goodResponses(), '2026-10-15T10:00:00.000Z', {
      situations: [situation],
      builder: (input) => {
        if (input.localMap.id === 'map-1') throw new Error('map 1 build exploded');
        return buildSnapshot(input);
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(store.puts.map(({ key }) => key)).toEqual(['snapshots/map-2.json']);
  });

  it('passes localMap and part to reporter.warn', async () => {
    const { store } = await previousSnapshot();
    const responses = goodResponses();
    responses.set(FEED_URLS.floodReports, new Response('failure', { status: 500 }));
    const result = await run(store, responses, '2026-10-15T10:15:00.000Z');
    expect(result.warnings).toContainEqual({
      message: expect.stringContaining('reports failed'),
      key: { localMap: 'bangkok-flood', part: 'reports' },
    });
  });

  it('reports an error and preserves previous parts when every feed fails', async () => {
    const { store, previous } = await previousSnapshot();
    const result = await run(store, everyFeedFails(), '2026-10-15T10:15:00.000Z');
    const value = snapshot(store);
    expect(result.warnings).toHaveLength(6);
    expect(result.errors).toHaveLength(1);
    expect(value.flood.roads).toEqual(previous.flood.roads);
    expect(value.weather).toEqual(previous.weather);
  });

  it('skips past situations without fetching or writing', async () => {
    const store = new FakeR2();
    const past: Situation = { ...SITUATIONS[0], status: 'past' };
    const result = await run(store, new Map(), '2026-10-15T10:00:00.000Z', { situations: [past] });
    expect(store.puts).toHaveLength(0);
    expect(result).toMatchObject({ warnings: [], errors: [], calls: [] });
  });
});

describe('transit stations', () => {
  it('converts at least 100 real seed stations to Points and stationWater finds one beside a blocked road', () => {
    const stations = SEED_OSM.transit.features.filter((feature) => feature.properties?.kind === 'station');
    expect(stations.length).toBeGreaterThanOrEqual(100);
    expect(stations.every((feature) => feature.geometry?.type === 'Point')).toBe(true);
    const raw = JSON.parse(readFileSync(
      new URL('../../../src/situations/bangkok-flood-2026/osm-seed/transit.json', import.meta.url), 'utf8',
    )) as { elements: { members?: { type: string; ref: number; role: string }[] }[] };
    const roles = new Map<number, Set<string>>();
    for (const m of raw.elements.flatMap((e) => e.members ?? []).filter((m) => m.type === 'node')) {
      roles.set(m.ref, (roles.get(m.ref) ?? new Set()).add(m.role));
    }
    const inactiveOnly = [...roles].filter(([, r]) => r.size === 1 && r.has('stop_inactive')).map(([ref]) => `node/${ref}`);
    expect(inactiveOnly.length).toBeGreaterThan(0);
    expect(stations.some((feature) => inactiveOnly.includes(String(feature.id)))).toBe(false);
    const station = stations[0] as Feature<Point>;
    const position = station.geometry.coordinates;
    const decoy: Feature<Point> = {
      type: 'Feature', id: 'not-a-station', geometry: station.geometry, properties: { kind: 'line' },
    };
    const roadProperties: RoadProps = {
      sedan: 'blocked', motorbike: '', pickup: '', truck: '', sev: 4,
      named: false, label: 'Blocked', srcs: '', depthCm: null,
    };
    const roads: FloodData['roads'] = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [position, [position[0] + 0.00001, position[1]]] },
        properties: roadProperties,
      } satisfies Feature<LineString, RoadProps>],
    };
    const reports: FloodData['reports'] = { type: 'FeatureCollection', features: [] };
    const transit = { ...SEED_OSM.transit, features: [...SEED_OSM.transit.features, decoy] };
    const wetIds = stationWater(transit, roads, reports).features.map((feature) => feature.id);
    expect(wetIds).toContain(station.id);
    expect(wetIds).not.toContain(decoy.id);
  });
});
