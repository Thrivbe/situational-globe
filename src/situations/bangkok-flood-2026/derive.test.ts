import { readFileSync } from 'node:fs';
import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clipToBbox,
  dangerGrid,
  depthPoints,
  DG_LEVEL,
  FORECAST_GRID_POINTS,
  normaliseRoads,
  parseReportsCsv,
  stationWater,
  stitch,
  type FloodData,
  type FloodReportFeature,
  type ForecastGridPoint,
  type RoadProps,
} from './derive';
import type { Bbox } from '../types';

const BANGKOK_BBOX: Bbox = [100.3, 13.5, 100.95, 14.05];
const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const seed = (name: string): string => readFileSync(new URL(`./osm-seed/${name}`, import.meta.url), 'utf8');

type OsmMember = { type?: string; role?: string; geometry?: { lat: number; lon: number }[] };
type OsmSeed = { elements?: { members?: OsmMember[] }[] };
type ForecastResponse = { hourly: { time: string[]; precipitation: (number | null)[] } };

let data: FloodData;
let allParsedReports: FloodReportFeature[];
let forecastGrid: ForecastGridPoint[];

const roadProperties = (overrides: Partial<RoadProps> = {}): RoadProps => ({
  sedan: 'ok', motorbike: '', pickup: '', truck: '', sev: 1, named: false,
  label: 'Unnamed road', srcs: '', depthCm: null, ...overrides,
});

const report = (coordinates: Position, depth = 0, closed = false): FloodReportFeature => ({
  type: 'Feature', geometry: { type: 'Point', coordinates },
  properties: { depth, closed, source: 'crowd', tier: 'public', ver: 'unverified', time: '', text: '' },
});

beforeAll(() => {
  const { roads } = normaliseRoads(JSON.parse(fixture('roads.geojson')));
  const parsed = parseReportsCsv(fixture('reports.csv'));
  allParsedReports = parsed.features;
  data = {
    roads: clipToBbox(roads, BANGKOK_BBOX),
    reports: clipToBbox({ type: 'FeatureCollection', features: allParsedReports }, BANGKOK_BBOX),
    wx: { current: { time: '2026-10-15T10:00' } },
  };
  const responses = JSON.parse(fixture('forecast-grid.json')) as ForecastResponse[];
  forecastGrid = responses.map((response, index) => ({
    ...FORECAST_GRID_POINTS[index], time: response.hourly.time, mm: response.hourly.precipitation,
  }));
});

describe('parseReportsCsv', () => {
  it('keeps the fixture source filter count', () => {
    expect(allParsedReports).toHaveLength(1778);
    expect(allParsedReports.some(({ properties }) => BLOCKED_REPORT_SOURCES.has(properties.source))).toBe(false);
  });

  it('parses a first-column BOM header, quoted fields, embedded newlines, and exact booleans', () => {
    const csv = '\uFEFFlat,lon,source,tier,depth_cm,closed_all,cleared,time_utc,text\r\n' +
      '13.75,100.5,crowd,public,,TRUE,false,now,"a,b"\r\n' +
      '13.76,100.51,traffy,official,30,true,false,later,"he said ""hi""\r\non next line"\r\n' +
      '13.77,100.52,crowd\r\n';
    const parsed = parseReportsCsv(csv);
    expect(parsed.dropped).toBe(1);
    expect(parsed.features).toHaveLength(2);
    expect(parsed.features[0].geometry.coordinates).toEqual([100.5, 13.75]);
    expect(parsed.features[0].properties).toMatchObject({ depth: 0, closed: false, text: 'a,b' });
    expect(parsed.features[1].properties.text).toBe('he said "hi"\r\non next line');
  });

  it('throws when a required header is missing', () => {
    expect(() => parseReportsCsv('lon,source,tier,depth_cm,closed_all,cleared,time_utc\n100.5,crowd,x,,false,false,now'))
      .toThrow(/lat/);
  });
});

const BLOCKED_REPORT_SOURCES = new Set(['news', 'social_fb']);

describe('normaliseRoads', () => {
  it('drops malformed geometries and always derives severity from the verdict', () => {
    const raw = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: null, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [100.5, 13.75] }, properties: {} },
      { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[100.5, 13.75], [null]]] }, properties: {} },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[100.5, 13.75], [100.6, 13.8]] },
        properties: { sev: 4, cleared: true, nameEn: 'Clear Road', hw: 'primary', depthCm: 40,
          verdict: { sedan: 'blocked', motorbike: 'risky' }, sources: ['official', 'crowd'] } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[100.6, 13.75], [100.7, 13.8]] },
        properties: { verdict: { sedan: '__proto__' } } },
    ] };
    const normalised = normaliseRoads(raw);
    expect(normalised.dropped).toBe(3);
    expect(normalised.roads.features).toHaveLength(2);
    expect(normalised.roads.features[0].properties).toMatchObject({
      sedan: 'ok', motorbike: 'risky', sev: 1, named: true, label: 'Clear Road',
      srcs: 'official, crowd', depthCm: 40,
    });
    expect(normalised.roads.features[1].properties).toMatchObject({ sedan: '__proto__', sev: 1 });
  });

  it('throws when the whole feed lacks a features array', () => {
    expect(() => normaliseRoads({ type: 'FeatureCollection' })).toThrow(/features array/);
  });
});

describe('dangerGrid', () => {
  it('runs on the real fixtures', () => {
    expect(dangerGrid(data, forecastGrid).features.length).toBeGreaterThan(0);
  });

  it('pins the hex polygon for a known coordinate', () => {
    const flood: FloodData = {
      roads: { type: 'FeatureCollection', features: [{
        type: 'Feature', geometry: { type: 'LineString', coordinates: [[100.5, 13.75], [100.5, 13.75]] },
        properties: roadProperties({ sedan: 'risky', sev: 3 }),
      }] },
      reports: { type: 'FeatureCollection', features: [] },
    };
    expect(dangerGrid(flood).features[0].geometry.coordinates[0]).toEqual([
      [100.51090836322194, 13.73], [100.51090836322194, 13.75],
      [100.49358785514626, 13.76], [100.47626734707057, 13.75],
      [100.47626734707057, 13.73], [100.49358785514626, 13.72],
      [100.51090836322194, 13.73],
    ]);
  });

  it('adds +2 for 5 mm rain and +1 for 1 mm rain while ignoring nulls', () => {
    const flood: FloodData = {
      roads: { type: 'FeatureCollection', features: [] }, reports: { type: 'FeatureCollection', features: [] },
      wx: { current: { time: '2026-10-15T10:00' } },
    };
    const time = ['2026-10-15T10:00', '2026-10-15T11:00'];
    const hexes = dangerGrid(flood, [
      { lat: 13.6, lon: 100.4, time, mm: [5, null] },
      { lat: 13.9, lon: 100.8, time, mm: [1, 0] },
    ]);
    expect(hexes.features.some(({ properties }) => properties.rain6 === 5 && properties.score === 2)).toBe(true);
    expect(hexes.features.some(({ properties }) => properties.rain6 === 1 && properties.score === 1)).toBe(true);
  });

  it('pins every danger-level boundary', () => {
    expect([DG_LEVEL(3.5), DG_LEVEL(4), DG_LEVEL(11.5), DG_LEVEL(12)]).toEqual([1, 2, 2, 3]);
  });
});

describe('depthPoints', () => {
  it('keeps one deepest candidate per 0.0015-degree cell without extra spacing', () => {
    const flood: FloodData = {
      roads: { type: 'FeatureCollection', features: [] },
      reports: { type: 'FeatureCollection', features: [
        report([100.5007, 13.75], 10), report([100.50074, 13.75], 50), report([100.50076, 13.75], 20),
      ] },
    };
    const points = depthPoints(flood).features;
    expect(points).toHaveLength(2);
    expect(points.map(({ properties }) => properties?.cm).sort((left, right) => Number(left) - Number(right)))
      .toEqual([20, 50]);
    expect(points.find(({ properties }) => properties?.cm === 50)?.geometry.coordinates).toEqual([100.50074, 13.75]);
  });
});

describe('clipToBbox', () => {
  it('removes a point outside the bbox', () => {
    const points: FeatureCollection<Point> = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [100.5, 13.75] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
    ] };
    expect(clipToBbox(points, BANGKOK_BBOX).features).toHaveLength(1);
  });
});

describe('stationWater', () => {
  it('uses blocked roads and only closed or 30+ cm reports within 500 metres', () => {
    const stations: FeatureCollection<Point> = { type: 'FeatureCollection', features: [
      station('road-wet', [100.4, 13.7]), station('road-dry', [100.5, 13.7]),
      station('shallow-dry', [100.6, 13.7]), station('closed-wet', [100.7, 13.7]),
    ] };
    const roads: FloodData['roads'] = { type: 'FeatureCollection', features: [
      blockedRoad([[100.4, 13.70362], [100.40001, 13.70362]]),
      blockedRoad([[100.5, 13.70543], [100.50001, 13.70543]]),
    ] };
    const reports: FloodData['reports'] = { type: 'FeatureCollection', features: [
      report([100.6, 13.7009], 20), report([100.7, 13.7009], 0, true),
    ] };
    const wet = stationWater(stations, roads, reports);
    expect(wet.features.map((feature) => feature.id)).toEqual(['road-wet', 'closed-wet']);
    expect(wet.features[0].properties).toMatchObject({ maxDepthCm: 0, n: 2 });
    expect(wet.features[1].properties).toMatchObject({ maxDepthCm: 0, n: 1 });
    expect(wet.features[0].properties).not.toHaveProperty('depthCm');
  });
});

function station(id: string, coordinates: Position): Feature<Point> {
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates }, properties: { kind: 'station' } };
}

function blockedRoad(coordinates: Position[]): Feature<LineString, RoadProps> {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates },
    properties: roadProperties({ sedan: 'blocked', sev: 4 }) };
}

describe('stitch', () => {
  it('stitches a reversed square edge and ignores an unclosed fragment', () => {
    const rings = stitch([
      [[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 1]], [[0, 1], [0, 0]],
      [[10, 10], [11, 10]],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    expect(rings[0][0]).toEqual(rings[0][4]);
  });

  it('closes district outer ways from the committed OSM seed', () => {
    const raw = JSON.parse(seed('districts.json')) as OsmSeed;
    const relation = raw.elements?.find((element) => element.members?.some((member) =>
      member.type === 'way' && member.role === 'outer' && member.geometry));
    const ways = relation?.members?.filter((member) => member.type === 'way' && member.role === 'outer' && member.geometry)
      .map((member) => (member.geometry ?? []).map((point) => [point.lon, point.lat])) ?? [];
    const rings = stitch(ways);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
