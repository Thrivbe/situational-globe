import type { FeatureCollection, Point, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/situations/types';
import { BANGKOK_CENTRE } from './helpers';
import {
  DEPTH_COLOURS_3D,
  ROAD_COLOURS_3D,
  TRANSIT_COLOURS_3D,
  cameraTarget,
  columns,
  pillars,
} from './city3d';

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });
const polygon = (longitude: number, latitude: number): Polygon => ({
  type: 'Polygon', coordinates: [[
    [longitude - 0.01, latitude - 0.01], [longitude + 0.01, latitude - 0.01],
    [longitude + 0.01, latitude + 0.01], [longitude - 0.01, latitude + 0.01],
    [longitude - 0.01, latitude - 0.01],
  ]],
});

function snapshot(dangerHexes: FeatureCollection): Snapshot {
  return {
    localMap: 'bangkok-flood', situation: 'bangkok-flood-2026', builtAt: '', feedsAt: {}, level: 0, credits: [],
    flood: { roads: empty(), reports: empty(), dangerHexes, depthPoints: empty() },
    weather: { current: {}, hourly: {}, grid: [], districtRain: [], river: [] },
    osm: { builtAt: '', hospitals: empty(), shelters: empty(), pumping: empty(), fireStations: empty(),
      districts: empty(), transit: empty(), landmarks: empty() },
    stationWater: empty(),
  };
}

describe('3D geometry builders', () => {
  const points: FeatureCollection<Point> = { type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'Point', coordinates: [100.5, 13.75] }, properties: { depth: 40 },
  }] };

  it('builds closed column and pillar polygons', () => {
    for (const feature of [...columns(points).features, ...pillars(points).features]) {
      const ring = feature.geometry.coordinates[0];
      expect(ring[0]).toEqual(ring.at(-1));
    }
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
