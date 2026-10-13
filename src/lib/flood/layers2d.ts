// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- MapLibre expressions are copied from the throwaway prototype.
import type * as maplibregl from 'maplibre-gl';
import type { FloodData } from './data';

export interface FloodLayerRegistrar {
  addSource(id: string, source: maplibregl.SourceSpecification): void;
  addLayer(layer: maplibregl.LayerSpecification): void;
}

export const FLOOD_2D_LAYER_IDS = [
  'flood-districts-line',
  'flood-radar',
  'flood-roads-glow',
  'flood-roads',
  'flood-hospitals',
  'flood-shelters',
  'flood-pumping',
  'flood-reports-cluster',
  'flood-reports-cluster-count',
  'flood-reports',
] as const;

const ROAD_COLOR = ['match', ['get', 'sedan'],
  'blocked', '#ef4444',
  'risky', '#fb923c',
  'caution', '#facc15',
  '#4ade80'];

const pointLayer = (id: string, color: string, minzoom: number): maplibregl.CircleLayerSpecification => ({
  id,
  type: 'circle',
  source: id,
  minzoom,
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], minzoom, 3, 12, 6, 16, 10],
    'circle-color': color,
    'circle-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0.45, minzoom + 1, 0.95],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1.2,
  },
});

export function addFlood2DLayers(registrar: FloodLayerRegistrar, data: FloodData) {
  registrar.addSource('flood-districts', { type: 'geojson', data: data.districts });
  registrar.addLayer({
    id: 'flood-districts-line', type: 'line', source: 'flood-districts',
    paint: {
      'line-color': ['step', ['get', 'signals'], '#64748b', 1, '#facc15', 12, '#fb923c', 40, '#ef4444'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 13, 2],
      'line-dasharray': [3, 2],
      'line-opacity': 0.9,
    },
  });

  const radar = data.frames.findLast(frame => !frame.nowcast) ?? data.frames[0];
  if (radar) {
    registrar.addSource('flood-radar', { type: 'raster', tiles: [radar.url], tileSize: 256, maxzoom: 7 });
    registrar.addLayer({
      id: 'flood-radar', type: 'raster', source: 'flood-radar',
      paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
    });
  }

  registrar.addSource('flood-roads', { type: 'geojson', data: data.roads });
  registrar.addLayer({
    id: 'flood-roads-glow', type: 'line', source: 'flood-roads',
    filter: ['>=', ['get', 'sev'], 3],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ROAD_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 14, 12, 23, 15, 36],
      'line-blur': 8,
      'line-opacity': 0.75,
    },
  });
  registrar.addLayer({
    id: 'flood-roads', type: 'line', source: 'flood-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'sev'] },
    paint: {
      'line-color': ROAD_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 11, 5, 13, 7.5, 16, 11],
      'line-opacity': ['match', ['get', 'sev'], 1, 0.22, 2, 0.85, 1],
    },
  });

  const points = [
    ['flood-hospitals', data.hospitals, '#ec4899', 11.5],
    ['flood-shelters', data.shelters, '#14b8a6', 10],
    ['flood-pumping', data.pumping, '#c2855a', 10.3],
  ] as const;
  for (const [id, collection, color, minzoom] of points) {
    registrar.addSource(id, { type: 'geojson', data: collection });
    registrar.addLayer(pointLayer(id, color, minzoom));
  }

  registrar.addSource('flood-reports', {
    type: 'geojson',
    data: data.reports,
    cluster: true,
    clusterRadius: 40,
    clusterMaxZoom: 12,
    clusterProperties: { closed: ['+', ['case', ['get', 'closed'], 1, 0]] },
  });
  registrar.addLayer({
    id: 'flood-reports-cluster', type: 'circle', source: 'flood-reports', filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 12, 10, 15, 40, 19, 120, 24, 300, 29],
      'circle-color': '#0e3a5c',
      'circle-opacity': 0.92,
      'circle-stroke-color': ['case', ['>', ['get', 'closed'], 0], '#ef4444', '#38bdf8'],
      'circle-stroke-width': 2.2,
    },
  });
  registrar.addLayer({
    id: 'flood-reports-cluster-count', type: 'symbol', source: 'flood-reports', filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Open Sans Bold'],
      'text-size': 12,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff' },
  });
  registrar.addLayer({
    id: 'flood-reports', type: 'circle', source: 'flood-reports', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 12, 4.5, 15, 8],
      'circle-color': ['case', ['get', 'closed'], '#ef4444', ['get', 'verified'], '#38bdf8', 'rgba(11,15,20,.25)'],
      'circle-stroke-color': ['case', ['get', 'closed'], '#fecaca', ['get', 'verified'], '#0b0f14', '#7dd3fc'],
      'circle-stroke-width': ['case', ['get', 'verified'], 1, 2],
      'circle-opacity': 0.95,
    },
  });
}
