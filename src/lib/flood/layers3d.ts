// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- MapLibre expressions are copied from the throwaway prototype.
import type { FloodData, FloodFeatureCollection } from './data';
import { FEEDS } from './feeds';
import type { FloodLayerRegistrar } from './layers2d';

export const FLOOD_3D_LAYER_IDS = [
  'flood-parks3d',
  'flood-dz3d',
  'flood-bld3d',
  'flood-roads-ribbon',
  'flood-reports-glow',
  'flood-reports',
  'flood-reports-cap',
  'flood-transit3d',
  'flood-hospitals3d',
  'flood-shelters3d',
  'flood-pumping3d',
] as const;

const collection = (features: Array<Record<string, unknown>>): FloodFeatureCollection => ({ type: 'FeatureCollection', features });
const zoomInterpolation = (...stops: unknown[]) => ['interpolate', ['linear'], ['zoom'], ...stops];
const zoomHeight = (expression: unknown) => zoomInterpolation(12, ['*', expression, 5], 14, expression);
const metres = (latitude: number, distance: number) => [
  distance / 111_320 / Math.cos(latitude * Math.PI / 180),
  distance / 111_320,
];

function rectangle(longitude: number, latitude: number, radius: number) {
  const [dx, dy] = metres(latitude, radius);
  return [[longitude - dx, latitude - dy], [longitude + dx, latitude - dy], [longitude + dx, latitude + dy], [longitude - dx, latitude + dy], [longitude - dx, latitude - dy]];
}

function reportColumns(reports: FloodFeatureCollection): FloodFeatureCollection {
  return collection(reports.features
    .filter(feature => feature.geometry?.type === 'Point')
    .map(feature => {
      const [longitude, latitude] = feature.geometry.coordinates;
      const depth = Math.min(feature.properties.depth || 0, 150);
      const base = 45 + depth * 3.5;
      return {
        type: 'Feature',
        properties: { ...feature.properties, depth, base, top: base + 10 },
        geometry: { type: 'Polygon', coordinates: [rectangle(longitude, latitude, 16)] },
      };
    }));
}

function roadRibbons(roads: FloodFeatureCollection): FloodFeatureCollection {
  const features = [];
  for (const feature of roads.features) {
    const properties = feature.properties ?? {};
    if (properties.sev < 2) continue;
    const halfWidth = properties.sev === 4 ? 6 : properties.sev === 3 ? 4 : 3;
    const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const line of lines) for (let index = 1; index < line.length; index++) {
      const [x0, y0] = line[index - 1];
      const [x1, y1] = line[index];
      const [kx, ky] = metres(y0, 1);
      const ex = (x1 - x0) / kx;
      const ey = (y1 - y0) / ky;
      const length = Math.hypot(ex, ey);
      if (length < 0.5) continue;
      const nx = -ey / length * halfWidth * kx;
      const ny = ex / length * halfWidth * ky;
      features.push({
        type: 'Feature',
        properties: { sedan: properties.sedan, lift: properties.sev === 4 ? 40 : properties.sev === 3 ? 30 : 20 },
        geometry: { type: 'Polygon', coordinates: [[[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny], [x0 + nx, y0 + ny]]] },
      });
    }
  }
  return collection(features);
}

function pillars(points: FloodFeatureCollection): FloodFeatureCollection {
  return collection(points.features
    .filter(feature => feature.geometry?.type === 'Point')
    .map(feature => {
      const [longitude, latitude] = feature.geometry.coordinates;
      return {
        type: 'Feature',
        properties: feature.properties ?? {},
        geometry: { type: 'Polygon', coordinates: [rectangle(longitude, latitude, 11)] },
      };
    }));
}

const buildingHeight = ['case',
  ['>', ['to-number', ['get', 'render_height'], 0], 3],
  ['get', 'render_height'],
  ['+', 8, ['*', 3, ['%', ['to-number', ['id'], 0], 7]]],
];
const cappedBuildingHeight = ['min', buildingHeight, 130];
const depthBand = ['case', ['get', 'closed'], '#ff1744', ['step', ['get', 'depth'], '#4fc3ff', 35, '#f2a93b', 70, '#e5304a', 120, '#ff3d81']];
const capBand = ['case', ['get', 'closed'], '#ffffff', ['step', ['get', 'depth'], '#d8f3ff', 35, '#ffe6b8', 70, '#ffc2ca', 120, '#ffc4dc']];

export function addFlood3DLayers(registrar: FloodLayerRegistrar, data: FloodData) {
  registrar.addSource('flood-omt', { type: 'vector', url: FEEDS.vectorTiles.url });
  registrar.addLayer({
    id: 'flood-parks3d', type: 'fill', source: 'flood-omt', 'source-layer': 'park', minzoom: 11,
    paint: { 'fill-color': '#0f2a22', 'fill-opacity': 0.9 },
  });

  registrar.addSource('flood-districts3d', { type: 'geojson', data: data.districts });
  registrar.addLayer({
    id: 'flood-dz3d', type: 'fill-extrusion', source: 'flood-districts3d', maxzoom: 13.8,
    paint: {
      'fill-extrusion-height': ['*', ['min', ['get', 'signals'], 30], 12],
      'fill-extrusion-base': 0,
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'signals'], 0, '#1b2a44', 5, '#4c2a6b', 15, '#a02050', 40, '#e8456a'],
      'fill-extrusion-opacity': zoomInterpolation(10, 0.4, 12.6, 0.3, 13.8, 0),
    },
  });

  registrar.addLayer({
    id: 'flood-bld3d', type: 'fill-extrusion', source: 'flood-omt', 'source-layer': 'building', minzoom: 13.9,
    paint: {
      'fill-extrusion-height': cappedBuildingHeight,
      'fill-extrusion-base': ['min', ['coalesce', ['get', 'render_min_height'], 0], cappedBuildingHeight],
      'fill-extrusion-color': ['interpolate', ['linear'], cappedBuildingHeight, 6, '#1f2838', 25, '#2b3650', 60, '#425277', 130, '#8297c8'],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    },
  });

  registrar.addSource('flood-road-ribbons', { type: 'geojson', data: roadRibbons(data.roads) });
  registrar.addLayer({
    id: 'flood-roads-ribbon', type: 'fill-extrusion', source: 'flood-road-ribbons',
    paint: {
      'fill-extrusion-height': zoomHeight(['+', ['get', 'lift'], 6]),
      'fill-extrusion-base': zoomHeight(['get', 'lift']),
      'fill-extrusion-opacity': 0.95,
      'fill-extrusion-vertical-gradient': false,
      'fill-extrusion-color': ['match', ['get', 'sedan'], 'blocked', '#ff3b3b', 'risky', '#ff9a3c', '#ffe14a'],
    },
  });

  const columns = reportColumns(data.reports);
  registrar.addSource('flood-report-columns', { type: 'geojson', data: columns });
  registrar.addSource('flood-report-points', { type: 'geojson', data: data.reports });
  registrar.addLayer({
    id: 'flood-reports-glow', type: 'circle', source: 'flood-report-points', minzoom: 12.5,
    paint: {
      'circle-pitch-alignment': 'map',
      'circle-radius': zoomInterpolation(12, 6, 14, 16, 17, 46),
      'circle-color': depthBand,
      'circle-blur': 1,
      'circle-opacity': 0.45,
    },
  });
  registrar.addLayer({
    id: 'flood-reports', type: 'fill-extrusion', source: 'flood-report-columns', minzoom: 12.5,
    paint: {
      'fill-extrusion-height': zoomHeight(['get', 'base']),
      'fill-extrusion-base': 0,
      'fill-extrusion-color': depthBand,
      'fill-extrusion-opacity': 0.95,
    },
  });
  registrar.addLayer({
    id: 'flood-reports-cap', type: 'fill-extrusion', source: 'flood-report-columns', minzoom: 12.5,
    paint: {
      'fill-extrusion-height': zoomHeight(['get', 'top']),
      'fill-extrusion-base': zoomHeight(['get', 'base']),
      'fill-extrusion-color': capBand,
      'fill-extrusion-opacity': 1,
      'fill-extrusion-vertical-gradient': false,
    },
  });

  registrar.addSource('flood-transit3d', { type: 'geojson', data: data.transit });
  registrar.addLayer({
    id: 'flood-transit3d', type: 'line', source: 'flood-transit3d', minzoom: 10,
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': ['case', ['!=', ['coalesce', ['get', 'color'], ''], ''], ['get', 'color'], ['match', ['get', 'kind'], 'metro', '#38bdf8', 'monorail', '#e879f9', '#4ade80']],
      'line-width': zoomInterpolation(10, 1.5, 14, 2.5, 17, 6),
      'line-blur': 0.4,
      'line-opacity': 0.9,
    },
  });

  const poiLayers = [
    ['flood-hospitals3d', data.hospitals, '#2dd4bf'],
    ['flood-shelters3d', data.shelters, '#a3e635'],
    ['flood-pumping3d', data.pumping, '#818cf8'],
  ] as const;
  for (const [id, points, color] of poiLayers) {
    registrar.addSource(id, { type: 'geojson', data: pillars(points) });
    registrar.addLayer({
      id, type: 'fill-extrusion', source: id, minzoom: 12,
      paint: {
        'fill-extrusion-height': zoomInterpolation(12, 120, 16, 55),
        'fill-extrusion-base': 0,
        'fill-extrusion-color': color,
        'fill-extrusion-opacity': 0.95,
      },
    });
  }
}
