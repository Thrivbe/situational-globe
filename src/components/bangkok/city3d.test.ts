import type { FeatureCollection, Point, Polygon } from 'geojson';
import type { LayerSpecification, LightSpecification, Map as MapLibreMap, SkySpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/situations/types';
import { BANGKOK_CENTRE } from './helpers';
import { INITIAL_LAYERS, LAYERS } from './layers';
import {
  DEPTH_COLOURS_3D,
  ROAD_COLOURS_3D,
  TRANSIT_COLOURS_3D,
  addCityLayers,
  applyView,
  cameraTarget,
  pointSquares,
  points,
  reportLabels,
  ribbons,
} from './city3d';

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });
const polygon = (longitude: number, latitude: number): Polygon => ({
  type: 'Polygon', coordinates: [[
    [longitude - 0.01, latitude - 0.01], [longitude + 0.01, latitude - 0.01],
    [longitude + 0.01, latitude + 0.01], [longitude - 0.01, latitude + 0.01],
    [longitude - 0.01, latitude - 0.01],
  ]],
});

function snapshot(dangerHexes: FeatureCollection = empty()): Snapshot {
  return {
    localMap: 'bangkok-flood', situation: 'bangkok-flood-2026', builtAt: '', feedsAt: {}, level: 0, credits: [],
    flood: { roads: empty(), reports: empty(), dangerHexes, depthPoints: empty() },
    weather: { current: {}, hourly: {}, grid: [], districtRain: [], river: [] },
    osm: { builtAt: '', hospitals: empty(), shelters: empty(), pumping: empty(), fireStations: empty(),
      districts: empty(), transit: empty(), landmarks: empty() },
    stationWater: empty(),
  };
}

const BASE_PAINT: [string, string][] = [
  ['background', 'background-color'], ['landuse_residential', 'fill-color'], ['landcover_wood', 'fill-color'],
  ['landuse_park', 'fill-color'], ['water', 'fill-color'], ['waterway', 'line-color'],
  ['highway_minor', 'line-color'], ['highway_minor', 'line-width'], ['highway_minor', 'line-opacity'],
  ['highway_path', 'line-color'], ['highway_path', 'line-width'], ['highway_path', 'line-opacity'],
  ['highway_major_casing', 'line-color'], ['highway_major_casing', 'line-width'], ['highway_major_casing', 'line-opacity'],
  ['highway_major_inner', 'line-color'], ['highway_major_inner', 'line-width'], ['highway_major_inner', 'line-opacity'],
  ['highway_motorway_casing', 'line-color'], ['highway_motorway_casing', 'line-width'], ['highway_motorway_casing', 'line-opacity'],
  ['highway_motorway_inner', 'line-color'], ['highway_motorway_inner', 'line-width'], ['highway_motorway_inner', 'line-opacity'],
  ['radar', 'raster-opacity'],
];

class FakeMap {
  layers = new Map<string, LayerSpecification>();
  sources = new Map<string, unknown>([['openmaptiles', {}]]);
  paint = new Map<string, unknown>();
  layout = new Map<string, unknown>();
  addedLayers: string[] = [];
  light: LightSpecification;
  sky: SkySpecification | undefined;

  constructor(light: LightSpecification = {}, sky?: SkySpecification) {
    this.light = light;
    this.sky = sky;
    for (const [id, property] of BASE_PAINT) {
      if (!this.layers.has(id)) this.layers.set(id, { id, type: id === 'radar' ? 'raster' : 'fill', source: 'base' } as LayerSpecification);
      this.paint.set(`${id}:${property}`, id === 'radar' ? 0.7 : `original:${id}:${property}`);
    }
    for (const [id, visibility] of [['building', 'visible'], ['highway_major_subtle', 'none'], ['highway_motorway_subtle', 'visible']] as const) {
      this.layers.set(id, { id, type: 'fill', source: 'base' } as LayerSpecification);
      this.layout.set(`${id}:visibility`, visibility);
    }
    const localRoadLabel = { id: 'local-road-label', type: 'symbol', source: 'base', 'source-layer': 'transportation_name' } as LayerSpecification;
    this.layers.set(localRoadLabel.id, localRoadLabel);
    this.layout.set('local-road-label:visibility', 'visible');
  }

  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
  getStyle(): ReturnType<MapLibreMap['getStyle']> {
    return { version: 8, sources: Object.fromEntries(this.sources), layers: [...this.layers.values()] } as ReturnType<MapLibreMap['getStyle']>;
  }
  getLayer(id: string) { return this.layers.get(id); }
  getSource(id: string) { return this.sources.get(id); }
  addSource(id: string, source: unknown) { this.sources.set(id, source); }
  addLayer(layer: LayerSpecification) {
    this.layers.set(layer.id, layer);
    this.addedLayers.push(layer.id);
    for (const [property, value] of Object.entries((layer.paint ?? {}) as Record<string, unknown>)) {
      this.paint.set(`${layer.id}:${property}`, value);
    }
    for (const [property, value] of Object.entries((layer.layout ?? {}) as Record<string, unknown>)) {
      this.layout.set(`${layer.id}:${property}`, value);
    }
  }
  getPaintProperty(id: string, property: string) { return this.paint.get(`${id}:${property}`); }
  setPaintProperty(id: string, property: string, value: unknown) { this.paint.set(`${id}:${property}`, value); }
  getLayoutProperty(id: string, property: string) { return this.layout.get(`${id}:${property}`); }
  setLayoutProperty(id: string, property: string, value: unknown) { this.layout.set(`${id}:${property}`, value); }
  getLight() { return this.light; }
  setLight(light: LightSpecification) { this.light = light; return this.asMap(); }
  getSky() { return this.sky; }
  setSky(sky: SkySpecification) { this.sky = sky; return this.asMap(); }
}

const expectFinite = (value: unknown): void => {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(expectFinite);
  else if (value && typeof value === 'object') Object.values(value).forEach(expectFinite);
};

describe('3D geometry builders', () => {
  const validPoints: FeatureCollection<Point> = { type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'Point', coordinates: [100.5, 13.75] }, properties: { depth: 40 },
  }] };

  it('builds closed point-square polygons at either half-width', () => {
    for (const halfWidth of [11, 16]) {
      const ring = pointSquares(validPoints, halfWidth).features[0].geometry.coordinates[0];
      expect(ring[0]).toEqual(ring.at(-1));
    }
  });

  it('accepts missing and malformed input without emitting NaN or negative depth', () => {
    const malformed = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [100.5, 13.75] }, properties: { depth: -5, closed: true } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [Number.NaN, 13.75] }, properties: { depth: 20 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: null }, properties: {} },
      { type: 'Feature', geometry: null, properties: {} },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[100.5, 13.75], [null, 13.76], [100.6, 90]] }, properties: { sev: 4 } },
    ] } as unknown as FeatureCollection;

    expect(() => [pointSquares(undefined, 16), points(undefined), ribbons(undefined), reportLabels(undefined)]).not.toThrow();
    const built = [pointSquares(malformed, 16), points(malformed), ribbons(malformed), reportLabels(malformed)];
    built.forEach(expectFinite);
    expect(built[0].features[0].properties?.depth).toBe(0);
    expect(built[3].features[0].properties?.text).toBe('CLOSED');
  });
});

describe('3D colours', () => {
  it('keeps road, depth-column and transit hues disjoint', () => {
    const road = new Set<string>(ROAD_COLOURS_3D);
    const depth = new Set<string>(DEPTH_COLOURS_3D);
    const transit = new Set<string>(TRANSIT_COLOURS_3D);
    expect([...road].filter((color) => depth.has(color))).toEqual([]);
    expect([...road].filter((color) => transit.has(color))).toEqual([]);
    expect([...depth].filter((color) => transit.has(color))).toEqual([]);
  });
});

describe('cameraTarget', () => {
  it('chooses the highest-score level-3 hex before any lower level', () => {
    const dangerHexes: FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: polygon(100.4, 13.6), properties: { level: 2, score: 99 } },
      { type: 'Feature', geometry: polygon(100.6, 13.8), properties: { level: 3, score: 10 } },
      { type: 'Feature', geometry: polygon(100.7, 13.9), properties: { level: 3, score: 20 } },
    ] };
    expect(cameraTarget(snapshot(dangerHexes))).toEqual([100.7, 13.9]);
  });

  it('falls back to the highest score at any level, then the city centre', () => {
    const dangerHexes: FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: polygon(100.4, 13.6), properties: { level: 1, score: 2 } },
      { type: 'Feature', geometry: polygon(100.6, 13.8), properties: { level: 2, score: 8 } },
    ] };
    expect(cameraTarget(snapshot(dangerHexes))).toEqual([100.6, 13.8]);
    expect(cameraTarget(snapshot(empty()))).toEqual(BANGKOK_CENTRE);
  });
});

describe('city layer registry and reversible base style', () => {
  it('adds every registered c3 layer and registers every c3 layer it adds', () => {
    const map = new FakeMap();
    addCityLayers(map.asMap(), snapshot());
    const registered = new Set(LAYERS.flatMap((layer) => layer.ids3d).filter((id) => id.startsWith('c3-')));

    for (const id of registered) expect(map.getLayer(id), id).toBeTruthy();
    expect(map.addedLayers.filter((id) => id.startsWith('c3-')).every((id) => registered.has(id))).toBe(true);
  });

  it('restores every changed paint/layout value, default light, sky and radar', () => {
    const map = new FakeMap();
    addCityLayers(map.asMap(), snapshot());
    const originalPaint = new Map(BASE_PAINT.map(([id, property]) => [`${id}:${property}`, map.getPaintProperty(id, property)]));
    const originalLayout = new Map(['building', 'highway_major_subtle', 'highway_motorway_subtle', 'local-road-label']
      .map((id) => [id, map.getLayoutProperty(id, 'visibility')]));

    applyView(map.asMap(), '3d', INITIAL_LAYERS, true);
    for (const [key, value] of originalPaint) expect(map.paint.get(key), key).not.toEqual(value);
    for (const id of originalLayout.keys()) expect(map.getLayoutProperty(id, 'visibility'), id).toBe('none');
    expect(map.light).not.toEqual({});
    applyView(map.asMap(), '2d', INITIAL_LAYERS, true);

    for (const [key, value] of originalPaint) expect(map.paint.get(key), key).toEqual(value);
    for (const [id, value] of originalLayout) expect(map.getLayoutProperty(id, 'visibility'), id).toEqual(value);
    expect(map.light).toEqual({ anchor: 'viewport', color: '#ffffff', intensity: 0.5, position: [1.15, 210, 30] });
    expect(map.sky).toEqual({
      'sky-color': '#88C6FC', 'horizon-color': '#ffffff', 'fog-color': '#ffffff',
      'sky-horizon-blend': 0.8, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.5,
    });
    expect(map.getPaintProperty('radar', 'raster-opacity')).toBe(0.7);
  });

  it('restores captured light and sky values while filling unset sky defaults', () => {
    const light: LightSpecification = { anchor: 'map', color: '#abcdef', intensity: 0.2, position: [1, 20, 40] };
    const map = new FakeMap(light, { 'sky-color': '#123456' });
    addCityLayers(map.asMap(), snapshot());
    applyView(map.asMap(), '3d', INITIAL_LAYERS, true);
    applyView(map.asMap(), '2d', INITIAL_LAYERS, true);

    expect(map.light).toEqual(light);
    expect(map.sky).toMatchObject({ 'sky-color': '#123456', 'horizon-color': '#ffffff', 'fog-color': '#ffffff' });
  });
});
