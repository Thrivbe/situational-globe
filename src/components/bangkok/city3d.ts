import type { Feature, FeatureCollection, Point, Polygon, Position } from 'geojson';
import type {
  ExpressionSpecification,
  LayerSpecification,
  LightSpecification,
  Map as MapLibreMap,
  SkySpecification,
} from 'maplibre-gl';
import type { Snapshot } from '@/situations/types';
import { BANGKOK_CENTRE, districtsWithSignals, featureCentre, numberValue, propertiesOf } from './helpers';
import { C3, LAYERS, type LayerKey } from './layers';
import type { BangkokView } from './types';

export const ROAD_COLOURS_3D = [C3.roadWater, C3.roadBlocked, C3.roadRisky, C3.roadCaution, C3.roadOk] as const;
export const DEPTH_COLOURS_3D = [C3.ankle, C3.knee, C3.waist, C3.head, C3.closed] as const;
export const TRANSIT_COLOURS_3D = [C3.metro, C3.rail] as const;

const hidden = { visibility: 'none' as const };
const transition = { duration: 0, delay: 0 };
const interpolate = (...stops: unknown[]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops] as ExpressionSpecification;
const featureCollection = <G extends Point | Polygon>(features: Feature<G>[]): FeatureCollection<G> =>
  ({ type: 'FeatureCollection', features });

const metres = (latitude: number, value: number): [number, number] =>
  [value / 111_320 / Math.cos(latitude * Math.PI / 180), value / 111_320];

function rectangle(longitude: number, latitude: number, halfMetres: number): Position[] {
  const [dx, dy] = metres(latitude, halfMetres);
  return [
    [longitude - dx, latitude - dy], [longitude + dx, latitude - dy],
    [longitude + dx, latitude + dy], [longitude - dx, latitude + dy],
    [longitude - dx, latitude - dy],
  ];
}

export function columns(reports: FeatureCollection): FeatureCollection<Polygon> {
  return featureCollection(reports.features.flatMap((feature): Feature<Polygon>[] => {
    if (feature.geometry?.type !== 'Point') return [];
    const properties = propertiesOf(feature);
    const depth = Math.min(numberValue(properties.depth, numberValue(properties.cm)), 150);
    const base = 45 + depth * 3.5;
    const [longitude, latitude] = feature.geometry.coordinates;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    return [{
      type: 'Feature',
      properties: { ...properties, depth, cm: depth, base, top: base + 10 },
      geometry: { type: 'Polygon', coordinates: [rectangle(longitude, latitude, 16)] },
    }];
  }));
}

export function pillars(points: FeatureCollection): FeatureCollection<Polygon> {
  return featureCollection(points.features.flatMap((feature): Feature<Polygon>[] => {
    if (feature.geometry?.type !== 'Point') return [];
    const [longitude, latitude] = feature.geometry.coordinates;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    return [{ type: 'Feature', properties: propertiesOf(feature),
      geometry: { type: 'Polygon', coordinates: [rectangle(longitude, latitude, 11)] } }];
  }));
}

function points(pointsCollection: FeatureCollection): FeatureCollection<Point> {
  return featureCollection(pointsCollection.features.flatMap((feature): Feature<Point>[] =>
    feature.geometry?.type === 'Point' ? [{ ...feature, geometry: feature.geometry }] as Feature<Point>[] : []));
}

function ribbons(roads: FeatureCollection): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  for (const feature of roads.features) {
    const properties = propertiesOf(feature);
    const severity = numberValue(properties.sev, 1);
    if (severity < 2 || (feature.geometry?.type !== 'LineString' && feature.geometry?.type !== 'MultiLineString')) continue;
    const halfWidth = severity >= 4 ? 6 : severity === 3 ? 4 : 3;
    const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const line of lines) for (let index = 1; index < line.length; index += 1) {
      const [x0, y0] = line[index - 1];
      const [x1, y1] = line[index];
      const [kx, ky] = metres(y0, 1);
      const ex = (x1 - x0) / kx;
      const ey = (y1 - y0) / ky;
      const length = Math.hypot(ex, ey);
      if (length < 0.5) continue;
      const nx = -ey / length * halfWidth * kx;
      const ny = ex / length * halfWidth * ky;
      features.push({ type: 'Feature', properties: { ...properties, lift: severity >= 4 ? 40 : severity === 3 ? 30 : 20 },
        geometry: { type: 'Polygon', coordinates: [[
          [x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny], [x0 + nx, y0 + ny],
        ]] } });
    }
  }
  return featureCollection(features);
}

function reportLabels(reports: FeatureCollection): FeatureCollection<Point> {
  return featureCollection(reports.features.flatMap((feature): Feature<Point>[] => {
    if (feature.geometry?.type !== 'Point') return [];
    const properties = propertiesOf(feature);
    const cm = Math.min(numberValue(properties.depth, numberValue(properties.cm)), 150);
    if (!cm && !properties.closed) return [];
    const band = cm < 35 ? 'ankle' : cm < 70 ? 'knee' : cm < 120 ? 'waist' : 'over head';
    return [{ ...feature, properties: { ...properties, cm, text: cm ? `${band} ${Math.round(cm)} cm` : 'CLOSED' }, geometry: feature.geometry }];
  }));
}

export function cameraTarget(snapshot: Snapshot): [number, number] {
  const ranked = snapshot.flood.dangerHexes.features.map((feature) => ({
    feature, level: numberValue(propertiesOf(feature).level), score: numberValue(propertiesOf(feature).score),
  })).sort((left, right) => (right.level === 3 ? 1 : 0) - (left.level === 3 ? 1 : 0) || right.score - left.score);
  const levelThree = ranked.filter((item) => item.level === 3);
  for (const item of levelThree.length ? levelThree : ranked) {
    const centre = featureCentre(item.feature);
    if (centre && Number.isFinite(centre[0]) && Number.isFinite(centre[1])) return [centre[0], centre[1]];
  }
  return BANGKOK_CENTRE;
}

const fallbackHeight = ['case', ['>', ['to-number', ['get', 'render_height'], 0], 3], ['get', 'render_height'],
  ['+', 8, ['*', 3, ['%', ['to-number', ['id'], 0], 7]]]] as ExpressionSpecification;
export const BUILDING_HEIGHT = ['min', fallbackHeight, 130] as ExpressionSpecification;
export const buildingHeightAt = (scale: number): ExpressionSpecification =>
  ['*', BUILDING_HEIGHT, scale] as ExpressionSpecification;
export const STATIC_DANGER_OPACITY = interpolate(11, 0.2, 14, 0.12, 16, 0.06);
export const STATIC_REPORT_GLOW_RADIUS = interpolate(12, 4, 14, 10, 17, 36);
export const STATIC_REPORT_GLOW_OPACITY = 0.55;

function addSource(map: MapLibreMap, id: string, data: FeatureCollection, cluster = false): void {
  if (map.getSource(id)) return;
  map.addSource(id, { type: 'geojson', data, ...(cluster ? {
    cluster: true, clusterRadius: 50, clusterMaxZoom: 12,
    clusterProperties: { maxd: ['max', ['get', 'depth']], anyClosed: ['max', ['case', ['get', 'closed'], 1, 0]] },
  } : {}) });
}

function addLayer(map: MapLibreMap, layer: LayerSpecification, before?: string): void {
  if (!layer.id.startsWith('c3-')) throw new Error(`3D layer id must start with c3-: ${layer.id}`);
  if (map.getLayer(layer.id)) return;
  map.addLayer(layer, before && map.getLayer(before) ? before : undefined);
}

const depthBand = ['case', ['get', 'closed'], C3.closed,
  ['step', ['get', 'depth'], C3.ankle, 35, C3.knee, 70, C3.waist, 120, C3.head]] as ExpressionSpecification;
const depthCap = ['case', ['get', 'closed'], '#ffffff',
  ['step', ['get', 'depth'], '#d8f3ff', 35, '#ffe6b8', 70, '#ffc2ca', 120, '#ffc4dc']] as ExpressionSpecification;
const roadColour = ['match', ['get', 'sedan'], 'blocked', C3.roadBlocked, 'risky', C3.roadRisky,
  'caution', C3.roadCaution, C3.roadOk] as ExpressionSpecification;

function addPoi(map: MapLibreMap, key: 'hospitals' | 'shelters' | 'pumping', data: FeatureCollection, color: string, glyph: string): void {
  addSource(map, `c3-${key}`, pillars(data));
  addSource(map, `c3-${key}-points`, points(data));
  addLayer(map, { id: `c3-${key}`, type: 'fill-extrusion', source: `c3-${key}`, minzoom: 12, layout: hidden,
    paint: { 'fill-extrusion-height': interpolate(12, 120, 16, 55), 'fill-extrusion-base': 0,
      'fill-extrusion-color': color, 'fill-extrusion-opacity': 0.95 } });
  addLayer(map, { id: `c3-${key}-badge`, type: 'circle', source: `c3-${key}-points`, minzoom: 13, layout: hidden,
    paint: { 'circle-radius': interpolate(13, 7, 17, 11), 'circle-color': '#0a1424', 'circle-stroke-color': color,
      'circle-stroke-width': 2.5, 'circle-translate': [0, -34], 'circle-translate-anchor': 'viewport', 'circle-pitch-alignment': 'viewport' } });
  addLayer(map, { id: `c3-${key}-glyph`, type: 'symbol', source: `c3-${key}-points`, minzoom: 13, layout: {
    ...hidden, 'text-field': glyph, 'text-font': ['Noto Sans Bold'], 'text-size': interpolate(13, 11, 17, 17),
    'text-allow-overlap': true, 'text-ignore-placement': true, 'text-offset': [0, -2.3], 'text-pitch-alignment': 'viewport',
  }, paint: { 'text-color': '#ffffff', 'text-halo-color': color, 'text-halo-width': 0.6 } });
}

export const CITY_PACK_LAYER_IDS = ['c3-buildings', 'c3-parks'] as const;
export const CITY_PACK_LEGEND = [
  { shape: 'swatch' as const, color: '#2b3650', label: 'blue-grey buildings, capped at 130 m', thai: 'อาคารสีน้ำเงินเทา สูงไม่เกิน 130 ม.' },
  { shape: 'swatch' as const, color: '#0f2a22', label: 'parks and green space', thai: 'สวนและพื้นที่สีเขียว' },
];

export function addCityLayers(map: MapLibreMap, snapshot: Snapshot): void {
  const firstSymbol = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
  const hot = ['>=', ['get', 'sev'], 3] as ExpressionSpecification;
  const cap = { 'line-cap': 'round' as const, 'line-join': 'round' as const };

  addSource(map, 'c3-roads', snapshot.flood.roads);
  addSource(map, 'c3-ribbons', ribbons(snapshot.flood.roads));
  addSource(map, 'c3-report-columns', columns(snapshot.flood.reports));
  addSource(map, 'c3-report-points', snapshot.flood.reports, true);
  addSource(map, 'c3-report-labels', reportLabels(snapshot.flood.reports));
  addSource(map, 'c3-danger', snapshot.flood.dangerHexes);
  addSource(map, 'c3-districts', districtsWithSignals(snapshot.osm.districts, snapshot.flood.dangerHexes));
  addSource(map, 'c3-transit', snapshot.osm.transit);
  addSource(map, 'c3-station-water', snapshot.stationWater);

  if (map.getSource('openmaptiles')) {
    addLayer(map, { id: 'c3-parks', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', minzoom: 11, layout: hidden,
      paint: { 'fill-color': '#0f2a22', 'fill-opacity': 0.9 } }, firstSymbol);
    addLayer(map, { id: 'c3-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14, layout: hidden,
      paint: { 'fill-extrusion-height': BUILDING_HEIGHT,
        'fill-extrusion-height-transition': transition,
        'fill-extrusion-base': ['min', ['coalesce', ['get', 'render_min_height'], 0], BUILDING_HEIGHT],
        'fill-extrusion-base-transition': transition,
        'fill-extrusion-color': ['interpolate', ['linear'], BUILDING_HEIGHT, 6, '#1f2838', 25, '#2b3650', 60, '#425277', 130, '#8297c8'],
        'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true } });
    addLayer(map, { id: 'c3-transit-osm', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 10,
      filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]], layout: { ...hidden, 'line-cap': 'round' },
      paint: { 'line-color': C3.rail, 'line-width': interpolate(10, 1, 14, 2, 17, 5), 'line-opacity': 0.82 } });
    addLayer(map, { id: 'c3-transit-osm-stations', type: 'circle', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 11.5,
      filter: ['all', ['==', ['get', 'class'], 'railway'],
        ['in', ['get', 'subclass'], ['literal', ['station', 'halt', 'subway', 'light_rail', 'monorail', 'tram']]]], layout: hidden,
      paint: { 'circle-radius': interpolate(12, 3, 16, 7), 'circle-color': '#ffffff', 'circle-stroke-color': C3.metro,
        'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' } });
    addLayer(map, { id: 'c3-transit-osm-station-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 12.5,
      filter: ['all', ['==', ['get', 'class'], 'railway'],
        ['in', ['get', 'subclass'], ['literal', ['station', 'halt', 'subway', 'light_rail', 'monorail', 'tram']]]], layout: {
        ...hidden, 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']],
        'text-font': ['Noto Sans Bold'], 'text-size': interpolate(12, 9, 16, 12), 'text-offset': [0, -1.1],
        'text-anchor': 'bottom', 'text-optional': true, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1,
      }, paint: { 'text-color': '#f3e8ff', 'text-halo-color': 'rgba(7,9,13,.9)', 'text-halo-width': 1.5 } });
  }

  addLayer(map, { id: 'c3-districts', type: 'fill-extrusion', source: 'c3-districts', maxzoom: 13.8, layout: hidden,
    paint: { 'fill-extrusion-height': ['*', ['min', ['get', 'signals'], 30], 12], 'fill-extrusion-base': 0,
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'signals'], 0, '#1b2a44', 5, '#4c2a6b', 15, '#a02050', 40, '#e8456a'],
      'fill-extrusion-opacity': interpolate(10, 0.4, 12.6, 0.3, 13.8, 0) } }, firstSymbol);
  addLayer(map, { id: 'c3-danger', type: 'fill', source: 'c3-danger', filter: ['>=', ['get', 'level'], 2], layout: hidden,
    paint: { 'fill-color': ['match', ['get', 'level'], 3, '#b3263a', '#7a4a12'], 'fill-opacity': STATIC_DANGER_OPACITY,
      'fill-opacity-transition': transition } }, firstSymbol);
  addLayer(map, { id: 'c3-danger-line', type: 'line', source: 'c3-danger', layout: hidden,
    paint: { 'line-color': ['match', ['get', 'level'], 3, '#ff5a6e', 2, '#f2a93b', '#2f7fe0'],
      'line-width': ['match', ['get', 'level'], 3, 1.4, 2, 1, 0.6], 'line-blur': 0.6,
      'line-opacity': ['match', ['get', 'level'], 3, 0.7, 2, 0.45, 0.12] } }, firstSymbol);

  addLayer(map, { id: 'c3-glow-plus-wide', type: 'line', source: 'c3-roads', filter: hot, layout: { ...hidden, ...cap },
    paint: { 'line-color': '#1679ff', 'line-width': interpolate(10, 18, 14, 52, 17, 108),
      'line-blur': interpolate(10, 13, 14, 30, 17, 58), 'line-opacity': 0.18 } }, firstSymbol);
  addLayer(map, { id: 'c3-glow-plus-mid', type: 'line', source: 'c3-roads', filter: hot, layout: { ...hidden, ...cap },
    paint: { 'line-color': ['match', ['get', 'sedan'], 'blocked', '#ff244f', 'risky', '#ff982b', C3.roadWater],
      'line-width': interpolate(10, 9, 14, 27, 17, 55), 'line-blur': interpolate(10, 7, 14, 16, 17, 30), 'line-opacity': 0.24 } }, firstSymbol);
  addLayer(map, { id: 'c3-water-sheen-fill', type: 'line', source: 'c3-roads', filter: hot, layout: { ...hidden, ...cap },
    paint: { 'line-color': '#087bd8', 'line-width': interpolate(10, 10, 14, 38, 17, 82),
      'line-blur': interpolate(10, 2, 14, 7, 17, 16), 'line-opacity': 0.3 } }, firstSymbol);
  addLayer(map, { id: 'c3-water-sheen-edge', type: 'line', source: 'c3-roads', filter: hot, layout: { ...hidden, ...cap },
    paint: { 'line-color': '#9de8ff', 'line-width': interpolate(10, 0.8, 14, 2.2, 17, 5), 'line-blur': 0.5,
      'line-opacity': 0.62, 'line-translate': [0, -2], 'line-translate-anchor': 'viewport' } }, firstSymbol);
  addLayer(map, { id: 'c3-roads-water', type: 'line', source: 'c3-roads', filter: hot, layout: { ...hidden, ...cap },
    paint: { 'line-color': C3.roadWater, 'line-width': interpolate(10, 8, 14, 30, 17, 60),
      'line-blur': interpolate(10, 5, 14, 16, 17, 30), 'line-opacity': 0.4 } }, firstSymbol);
  addLayer(map, { id: 'c3-roads-halo', type: 'line', source: 'c3-roads', filter: hot, layout: { ...hidden, ...cap },
    paint: { 'line-color': roadColour, 'line-width': interpolate(10, 5, 14, 16, 17, 32),
      'line-blur': interpolate(10, 4, 14, 9, 17, 18), 'line-opacity': 0.75 } }, firstSymbol);
  addLayer(map, { id: 'c3-roads-glow', type: 'line', source: 'c3-roads', filter: hot, layout: { ...hidden, ...cap },
    paint: { 'line-color': roadColour, 'line-width': interpolate(10, 2.5, 14, 6, 17, 12), 'line-blur': 1.2, 'line-opacity': 0.95 } }, firstSymbol);
  addLayer(map, { id: 'c3-roads-core', type: 'line', source: 'c3-roads', layout: { ...hidden, ...cap },
    paint: { 'line-color': ['case', hot, ['match', ['get', 'sedan'], 'blocked', '#ffe1e1', '#fff0dc'], roadColour],
      'line-width': interpolate(10, ['case', hot, 0.8, 0.6], 14, ['case', hot, 1.6, 1.4], 17, 3),
      'line-opacity': ['match', ['get', 'sev'], 1, 0.15, 2, 0.45, 1] } }, firstSymbol);
  addLayer(map, { id: 'c3-roads-dash', type: 'line', source: 'c3-roads', filter: ['>=', ['get', 'sev'], 4],
    layout: { ...hidden, 'line-join': 'round' }, paint: { 'line-color': '#ffd1d9',
      'line-width': interpolate(10, 1, 14, 2.4, 17, 4.5), 'line-opacity': 0.9, 'line-dasharray': [2, 2.5] } }, firstSymbol);
  addLayer(map, { id: 'c3-roads-ribbon', type: 'fill-extrusion', source: 'c3-ribbons', layout: hidden,
    paint: { 'fill-extrusion-height': ['+', ['get', 'lift'], 6], 'fill-extrusion-base': ['get', 'lift'],
      'fill-extrusion-opacity': 0.95, 'fill-extrusion-vertical-gradient': false, 'fill-extrusion-color': roadColour } });

  addLayer(map, { id: 'c3-glow-plus-columns', type: 'circle', source: 'c3-report-points', filter: ['!', ['has', 'point_count']], minzoom: 12.5, layout: hidden,
    paint: { 'circle-pitch-alignment': 'map', 'circle-radius': interpolate(12, 11, 14, 30, 17, 105),
      'circle-color': ['case', ['get', 'closed'], C3.closed, '#31b9ff'], 'circle-blur': 1, 'circle-opacity': 0.28 } }, firstSymbol);
  addLayer(map, { id: 'c3-reports-cluster', type: 'circle', source: 'c3-report-points', filter: ['has', 'point_count'], maxzoom: 13, layout: hidden,
    paint: { 'circle-radius': ['step', ['get', 'point_count'], 14, 10, 19, 40, 25], 'circle-opacity': 0.85,
      'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff',
      'circle-color': ['case', ['>', ['get', 'anyClosed'], 0], C3.closed, ['step', ['get', 'maxd'], C3.ankle, 35, C3.knee, 70, C3.waist, 120, C3.head]] } }, firstSymbol);
  addLayer(map, { id: 'c3-reports-cluster-count', type: 'symbol', source: 'c3-report-points', filter: ['has', 'point_count'], maxzoom: 13,
    layout: { ...hidden, 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
    paint: { 'text-color': '#111827' } }, firstSymbol);
  addLayer(map, { id: 'c3-report-ring', type: 'circle', source: 'c3-report-points', filter: ['!', ['has', 'point_count']], minzoom: 12.5, layout: hidden,
    paint: { 'circle-pitch-alignment': 'map', 'circle-radius': interpolate(12, 6, 14, 18, 17, 70), 'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': interpolate(12, 1.5, 16, 3), 'circle-stroke-color': depthBand, 'circle-blur': 0.3, 'circle-stroke-opacity': 0.95 } }, firstSymbol);
  addLayer(map, { id: 'c3-report-glow', type: 'circle', source: 'c3-report-points', filter: ['!', ['has', 'point_count']], minzoom: 12.5, layout: hidden,
    paint: { 'circle-pitch-alignment': 'map', 'circle-radius': STATIC_REPORT_GLOW_RADIUS, 'circle-radius-transition': transition,
      'circle-color': depthBand, 'circle-blur': 1, 'circle-opacity': STATIC_REPORT_GLOW_OPACITY, 'circle-opacity-transition': transition } }, firstSymbol);
  addLayer(map, { id: 'c3-report-columns', type: 'fill-extrusion', source: 'c3-report-columns', minzoom: 12.5, layout: hidden,
    paint: { 'fill-extrusion-height': ['get', 'base'], 'fill-extrusion-base': 0, 'fill-extrusion-color': depthBand, 'fill-extrusion-opacity': 0.95 } });
  addLayer(map, { id: 'c3-report-caps', type: 'fill-extrusion', source: 'c3-report-columns', minzoom: 12.5, layout: hidden,
    paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-color': depthCap,
      'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': false } });
  addLayer(map, { id: 'c3-depth-labels', type: 'symbol', source: 'c3-report-labels', minzoom: 12.5, layout: {
    ...hidden, 'text-field': ['get', 'text'], 'text-font': ['Noto Sans Bold'], 'text-size': interpolate(12, 10, 16, 13),
    'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-variable-anchor': ['bottom', 'top', 'left', 'right'],
    'text-radial-offset': 2.2, 'text-max-width': 14, 'symbol-sort-key': ['-', 0, ['get', 'cm']], 'text-padding': 6,
    'text-allow-overlap': false, 'text-ignore-placement': false, 'text-pitch-alignment': 'viewport',
  }, paint: { 'text-color': '#ffffff', 'text-halo-color': ['case', ['get', 'closed'], '#b30026', 'rgba(7,9,13,.9)'], 'text-halo-width': 1.8 } });

  addLayer(map, { id: 'c3-transit', type: 'line', source: 'c3-transit', minzoom: 10, filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
    layout: { ...hidden, 'line-cap': 'round' }, paint: { 'line-color': C3.metro, 'line-width': interpolate(10, 1.5, 14, 2.5, 17, 6),
      'line-blur': 0.4, 'line-opacity': 0.9 } });
  addLayer(map, { id: 'c3-transit-stations', type: 'circle', source: 'c3-transit', minzoom: 11.5,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], 'station']], layout: hidden,
    paint: { 'circle-radius': interpolate(12, 3, 16, 7), 'circle-color': '#ffffff', 'circle-stroke-color': C3.metro,
      'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' } });
  addLayer(map, { id: 'c3-transit-station-labels', type: 'symbol', source: 'c3-transit', minzoom: 12.5,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], 'station']], layout: {
      ...hidden, 'text-field': ['coalesce', ['get', 'name'], ['get', 'ref']], 'text-font': ['Noto Sans Bold'],
      'text-size': interpolate(12, 9, 16, 12), 'text-offset': [0, -1.1], 'text-anchor': 'bottom', 'text-optional': true,
      'text-transform': 'uppercase', 'text-letter-spacing': 0.1,
    }, paint: { 'text-color': '#f3e8ff', 'text-halo-color': 'rgba(7,9,13,.9)', 'text-halo-width': 1.5 } });
  addLayer(map, { id: 'c3-station-water', type: 'symbol', source: 'c3-station-water', minzoom: 10.3, layout: {
    ...hidden, 'text-field': ['concat', ['coalesce', ['get', 'name'], ['get', 'ref'], 'Station'], ' · ',
      ['to-string', ['round', ['get', 'maxDepthCm']]], ' cm'], 'text-font': ['Noto Sans Bold'], 'text-size': 12,
    'text-anchor': 'top', 'text-offset': [0, 1.3], 'text-padding': 5, 'symbol-sort-key': ['-', 0, ['get', 'maxDepthCm']],
    'text-max-width': 40, 'text-allow-overlap': false, 'text-optional': false, 'text-pitch-alignment': 'viewport',
  }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#b30026', 'text-halo-width': 2.2 } });

  addPoi(map, 'hospitals', snapshot.osm.hospitals, C3.hospital, 'H');
  addPoi(map, 'shelters', snapshot.osm.shelters, C3.shelter, 'S');
  addPoi(map, 'pumping', snapshot.osm.pumping, C3.pump, 'P');
}

type SavedProperty = { id: string; property: string; value: unknown };
type BaseState = { paint: SavedProperty[]; layout: SavedProperty[]; light: LightSpecification; sky: SkySpecification | undefined; applied: boolean };
const baseStates = new WeakMap<MapLibreMap, BaseState>();

const paintChanges: [string, string, unknown][] = [
  ['background', 'background-color', '#07090d'], ['landuse_residential', 'fill-color', '#0b0e13'],
  ['landcover_wood', 'fill-color', '#0b0e13'], ['landuse_park', 'fill-color', '#0b0e13'],
  ['water', 'fill-color', '#0a1a33'], ['waterway', 'line-color', '#12345e'],
  ['highway_minor', 'line-color', '#161b24'], ['highway_minor', 'line-width', interpolate(11, 0.2, 14, 0.6, 17, 4)],
  ['highway_minor', 'line-opacity', 1], ['highway_path', 'line-color', '#12161d'],
  ['highway_path', 'line-width', interpolate(11, 0.1, 14, 0.3, 17, 1.5)], ['highway_path', 'line-opacity', 1],
  ['highway_major_casing', 'line-color', '#232933'], ['highway_major_casing', 'line-width', interpolate(11, 0.9, 14, 2.6, 17, 11)],
  ['highway_major_casing', 'line-opacity', 1], ['highway_major_inner', 'line-color', '#1a1f28'],
  ['highway_major_inner', 'line-width', interpolate(11, 0.4, 14, 1.3, 17, 8)], ['highway_major_inner', 'line-opacity', 1],
  ['highway_motorway_casing', 'line-color', '#2a303a'], ['highway_motorway_casing', 'line-width', interpolate(11, 1.3, 14, 3.6, 17, 13)],
  ['highway_motorway_casing', 'line-opacity', 1], ['highway_motorway_inner', 'line-color', '#1d232d'],
  ['highway_motorway_inner', 'line-width', interpolate(11, 0.7, 14, 2.2, 17, 10)], ['highway_motorway_inner', 'line-opacity', 1],
];

function captureBase(map: MapLibreMap): BaseState {
  const previous = baseStates.get(map);
  if (previous) return previous;
  const paint = paintChanges.flatMap(([id, property]): SavedProperty[] => map.getLayer(id)
    ? [{ id, property, value: map.getPaintProperty(id, property as never) }] : []);
  const layoutIds = ['building', 'highway_major_subtle', 'highway_motorway_subtle',
    ...(map.getStyle().layers ?? []).filter((layer) => layer.type === 'symbol' && layer['source-layer'] === 'transportation_name' &&
      !/motorway|trunk|primary/.test(layer.id)).map((layer) => layer.id)];
  const layout = [...new Set(layoutIds)].flatMap((id): SavedProperty[] => map.getLayer(id)
    ? [{ id, property: 'visibility', value: map.getLayoutProperty(id, 'visibility') ?? 'visible' }] : []);
  const state = { paint, layout, light: map.getLight(), sky: map.getSky(), applied: false };
  baseStates.set(map, state);
  return state;
}

function applyNightBase(map: MapLibreMap): void {
  const state = captureBase(map);
  if (state.applied) return;
  for (const [id, property, value] of paintChanges) if (map.getLayer(id)) map.setPaintProperty(id, property as never, value as never);
  for (const saved of state.layout) if (map.getLayer(saved.id)) map.setLayoutProperty(saved.id, 'visibility', 'none');
  map.setLight({ anchor: 'viewport', color: '#b4c6e6', intensity: 0.6, position: [1.2, 210, 40] });
  map.setSky({ 'sky-color': '#0b1020', 'horizon-color': '#1b2a4a', 'fog-color': '#07090d',
    'sky-horizon-blend': 0.12, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.6 });
  state.applied = true;
}

function restoreBase(map: MapLibreMap): void {
  const state = baseStates.get(map);
  if (!state?.applied) return;
  for (const saved of state.paint) if (map.getLayer(saved.id)) {
    map.setPaintProperty(saved.id, saved.property as never, (saved.value ?? null) as never);
  }
  for (const saved of state.layout) if (map.getLayer(saved.id)) {
    map.setLayoutProperty(saved.id, saved.property as never, saved.value as never);
  }
  map.setLight(state.light);
  (map.setSky as (sky?: SkySpecification) => MapLibreMap)(state.sky);
  state.applied = false;
}

export function applyView(
  map: MapLibreMap,
  view: BangkokView,
  active: Record<LayerKey, boolean>,
  city3d: boolean,
): void {
  for (const layer of LAYERS) {
    const ids = new Set([...layer.ids2d, ...layer.ids3d]);
    for (const id of ids) if (map.getLayer(id)) {
      const inView = view === '2d' ? layer.ids2d.includes(id) : layer.ids3d.includes(id);
      map.setLayoutProperty(id, 'visibility', active[layer.key] && inView ? 'visible' : 'none');
    }
  }
  for (const id of CITY_PACK_LAYER_IDS) if (map.getLayer(id)) {
    map.setLayoutProperty(id, 'visibility', view === '3d' && city3d ? 'visible' : 'none');
  }
  if (view === '3d') applyNightBase(map);
  else restoreBase(map);
}
