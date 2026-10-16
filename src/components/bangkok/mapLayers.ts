import type { Feature, FeatureCollection, Point } from 'geojson';
import type { CircleLayerSpecification, Map as MapLibreMap, SymbolLayerSpecification } from 'maplibre-gl';
import type { Snapshot } from '@/situations/types';
import {
  districtsWithSignals,
  featureCentre,
  metricsAt,
  propertiesOf,
  rainRows,
  textValue,
} from './helpers';
import { C, LAYERS_2D, type LayerKey } from './layers';

const DG = ['', 'rgba(56,189,248,.12)', 'rgba(251,146,60,.17)', 'rgba(239,68,68,.27)'];
const OSM_SOURCE = 'openmaptiles';
const currentTime = (snapshot: Snapshot): string => textValue(snapshot.weather.current.time).slice(0, 13);

function rainGridCollection(snapshot: Snapshot): FeatureCollection<Point> {
  const now = currentTime(snapshot);
  const features = rainRows(snapshot.weather.grid).map((row): Feature<Point> => {
    const rain = metricsAt(row.mm, now ? row.time.findIndex((item) => item >= now) : -1);
    const rainClass = !Number.isFinite(rain.next6) ? 'unavailable'
      : rain.next6 >= 0.5 ? 'soon' : rain.next24 >= 1 ? 'later' : 'dry';
    const label = rainClass === 'soon' ? `rain soon ${Math.round(rain.next6)} mm`
      : rainClass === 'later' ? `rain later ${Math.round(rain.next24)} mm`
        : rainClass === 'dry' ? 'dry' : 'forecast unavailable';
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
      properties: { cls: rainClass, label,
        mm: Number.isFinite(rain.now) ? rain.now : null,
        n3: Number.isFinite(rain.next3) ? rain.next3 : null,
        n6: Number.isFinite(rain.next6) ? rain.next6 : null,
        n24: Number.isFinite(rain.next24) ? rain.next24 : null } };
  });
  return { type: 'FeatureCollection', features };
}

function districtRainCollection(snapshot: Snapshot): FeatureCollection<Point> {
  const now = currentTime(snapshot);
  const features = rainRows(snapshot.weather.districtRain).flatMap((row): Feature<Point>[] => {
    const rain = metricsAt(row.mm, now ? row.time.findIndex((item) => item >= now) : -1);
    if (!Number.isFinite(rain.next6) || rain.next6 < 1) return [];
    const name = row.name ?? 'District';
    return [{ type: 'Feature', geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
      properties: { name, label: `${name} · rain ${rain.next6 < 10 ? rain.next6 : Math.round(rain.next6)} mm in 6 h`,
        n3: rain.next3, n6: rain.next6, n24: rain.next24 } }];
  });
  return { type: 'FeatureCollection', features };
}

function districtLabelCollection(collection: FeatureCollection): FeatureCollection<Point> {
  const features = collection.features.flatMap((feature): Feature<Point>[] => {
    const centre = featureCentre(feature);
    if (!centre) return [];
    return [{ type: 'Feature', geometry: { type: 'Point', coordinates: centre }, properties: propertiesOf(feature) }];
  });
  return { type: 'FeatureCollection', features };
}

const pointLayer = (id: string, source: string, color: string, minzoom: number, scale = 1): CircleLayerSpecification => ({
  id, type: 'circle', source, minzoom,
  paint: {
    'circle-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0.35, minzoom + 1, 1],
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.8 * scale, 12, 6.5 * scale, 16, 12 * scale],
    'circle-color': color,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 12, 1.2],
  },
});

const glyphLayer = (id: string, source: string, glyph: string, color: string, minzoom: number): SymbolLayerSpecification => ({
  id: `${id}-g`, type: 'symbol', source, minzoom,
  layout: {
    'text-field': glyph,
    'text-font': ['Noto Sans Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], minzoom, 9, 14, 12, 16, 14],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  },
  paint: { 'text-color': color },
});

function addGeoJson(map: MapLibreMap, id: string, data: FeatureCollection, cluster = false): void {
  map.addSource(id, { type: 'geojson', data, ...(cluster ? {
    cluster: true,
    clusterRadius: 40,
    clusterMaxZoom: 12,
    clusterProperties: {
      closed: ['+', ['case', ['get', 'closed'], 1, 0]],
      verified: ['+', ['case', ['==', ['get', 'ver'], 'verified'], 1, 0]],
    },
  } : {}) });
}

function addPointPair(map: MapLibreMap, id: string, data: FeatureCollection, color: string, glyph: string, minzoom: number, scale = 1): void {
  addGeoJson(map, id, data);
  map.addLayer(pointLayer(id, id, color, minzoom, scale));
  map.addLayer(glyphLayer(id, id, glyph, color === C.fire ? '#0b0f14' : '#ffffff', minzoom + 0.7));
}

export function addSnapshotLayers(map: MapLibreMap, snapshot: Snapshot): void {
  const styleLayers = map.getStyle().layers ?? [];
  const firstRoad = styleLayers.some((layer) => layer.id === 'highway_path') ? 'highway_path' : undefined;
  const firstLabel = styleLayers.find((layer) => layer.type === 'symbol')?.id;
  const roads = snapshot.flood.roads;
  const reports = snapshot.flood.reports;
  const danger = snapshot.flood.dangerHexes;
  const depth = snapshot.flood.depthPoints;
  const districts = districtsWithSignals(snapshot.osm.districts, danger);

  addGeoJson(map, 'districts', districts);
  addGeoJson(map, 'district-labels', districtLabelCollection(districts));
  addGeoJson(map, 'danger', danger);
  map.addLayer({ id: 'districts-fill', type: 'fill', source: 'districts', paint: {
    'fill-color': ['step', ['get', 'signals'], 'rgba(0,0,0,0)', 1, 'rgba(250,204,21,.05)', 12, 'rgba(251,146,60,.11)', 40, 'rgba(239,68,68,.17)'],
  } }, firstRoad);
  map.addLayer({ id: 'districts-line', type: 'line', source: 'districts', paint: {
    'line-color': '#5b6b7c', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 13, 1.4],
    'line-dasharray': [3, 2], 'line-opacity': 0.8,
  } }, firstRoad);
  map.addLayer({ id: 'danger-grid', type: 'fill', source: 'danger', paint: {
    'fill-color': ['match', ['get', 'level'], 3, DG[3], 2, DG[2], DG[1]],
  } }, firstRoad);
  map.addLayer({ id: 'danger-grid-line', type: 'line', source: 'danger', paint: {
    'line-color': ['match', ['get', 'level'], 3, 'rgba(239,68,68,.85)', 2, 'rgba(251,146,60,.7)', 'rgba(56,189,248,.55)'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 13, 1.6],
  } }, firstRoad);

  addGeoJson(map, 'raingrid', rainGridCollection(snapshot));
  map.addLayer({ id: 'raingrid', type: 'circle', source: 'raingrid', filter: ['in', ['get', 'cls'], ['literal', ['soon', 'later']]], paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 28, 12, 70, 14, 120],
    'circle-blur': 0.9,
    'circle-color': ['match', ['get', 'cls'], 'soon', C.rain, 'later', '#94a3b8', 'rgba(0,0,0,0)'],
    'circle-opacity': ['match', ['get', 'cls'], 'soon', 0.38, 'later', 0.3, 0],
  } }, firstLabel);
  map.addLayer({ id: 'raingrid-label', type: 'symbol', source: 'raingrid', minzoom: 9, maxzoom: 11.2,
    filter: ['in', ['get', 'cls'], ['literal', ['soon', 'later']]], layout: {
      'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 10,
      'text-allow-overlap': false, 'text-padding': 8, 'text-offset': [0, 2.4], 'symbol-sort-key': 50,
    }, paint: { 'text-color': '#cbd5e1', 'text-halo-color': '#0b0f14', 'text-halo-width': 3 },
  });
  addGeoJson(map, 'raindist', districtRainCollection(snapshot));
  map.addLayer({ id: 'raindist-label', type: 'symbol', source: 'raindist', minzoom: 11.2, maxzoom: 12.6,
    layout: {
      'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 10,
      'text-padding': 5, 'text-allow-overlap': false, 'text-optional': false,
      'symbol-sort-key': ['-', 0, ['get', 'n6']],
    }, paint: { 'text-color': '#e2e8f0', 'text-halo-color': '#182030', 'text-halo-width': 5 },
  });

  if (map.getSource(OSM_SOURCE)) {
    map.addLayer({ id: 'canals', type: 'line', source: OSM_SOURCE, 'source-layer': 'waterway', minzoom: 9,
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.canal, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.45, 12, 0.8],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 12, 1.8, 15, 4] } }, firstRoad);
    map.addLayer({ id: 'canals-label', type: 'symbol', source: OSM_SOURCE, 'source-layer': 'waterway', minzoom: 12,
      filter: ['all', ['in', ['get', 'class'], ['literal', ['river', 'canal']]], ['has', 'name']], layout: {
        'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']],
        'text-font': ['Noto Sans Italic'], 'text-size': 11, 'symbol-spacing': 320,
      }, paint: { 'text-color': '#a5f3fc', 'text-halo-color': '#0b0f14', 'text-halo-width': 1.5 } });
    map.addLayer({ id: 'ferry', type: 'line', source: OSM_SOURCE, 'source-layer': 'transportation', minzoom: 9,
      filter: ['==', ['get', 'class'], 'ferry'], paint: { 'line-color': C.ferry,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 13, 3], 'line-dasharray': [4, 2.5] } });
    map.addLayer({ id: 'rail', type: 'line', source: OSM_SOURCE, 'source-layer': 'transportation', minzoom: 8,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!', ['has', 'service']]], paint: {
        'line-color': ['match', ['get', 'subclass'], 'subway', C.metro, 'light_rail', C.sky, 'monorail', C.sky, C.rail],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 12, 2.2, 16, 4], 'line-dasharray': [3, 2.5], 'line-opacity': 0.85,
      } });
    map.addLayer({ id: 'rail-stations', type: 'circle', source: OSM_SOURCE, 'source-layer': 'poi', minzoom: 9.8,
      filter: ['all', ['==', ['get', 'class'], 'railway'],
        ['in', ['get', 'subclass'], ['literal', ['station', 'halt', 'subway', 'light_rail', 'monorail', 'tram']]]], paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9.8, 2.6, 13, 5.5, 16, 8],
        'circle-color': ['match', ['get', 'subclass'], 'subway', C.metro, 'light_rail', C.sky, 'monorail', C.sky, 'tram', C.sky, C.rail],
        'circle-stroke-color': '#0b0f14', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10.5, 1, 14, 2],
      } });
    map.addLayer({ id: 'rail-stations-label', type: 'symbol', source: OSM_SOURCE, 'source-layer': 'poi', minzoom: 12.5,
      filter: ['all', ['==', ['get', 'class'], 'railway'],
        ['in', ['get', 'subclass'], ['literal', ['station', 'halt', 'subway', 'light_rail', 'monorail', 'tram']]]], layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 8,
      }, paint: { 'text-color': C.rail, 'text-halo-color': '#0b0f14', 'text-halo-width': 1.6 } });
    map.addLayer({ id: 'airports', type: 'circle', source: OSM_SOURCE, 'source-layer': 'aerodrome_label', minzoom: 8,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 13, 8], 'circle-color': C.airport,
        'circle-stroke-color': '#0b0f14', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'airports-label', type: 'symbol', source: OSM_SOURCE, 'source-layer': 'aerodrome_label', minzoom: 9,
      layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-anchor': 'top',
        'text-offset': [0, 1], 'text-max-width': 9 },
      paint: { 'text-color': C.airport, 'text-halo-color': '#0b0f14', 'text-halo-width': 1.8 } });
  }

  const transit = snapshot.osm.transit;
  addGeoJson(map, 'transit-src', transit);
  map.addLayer({ id: 'transit', type: 'line', source: 'transit-src', minzoom: 8,
    filter: ['==', ['geometry-type'], 'LineString'], paint: {
      'line-color': ['case', ['!=', ['get', 'color'], ''], ['get', 'color'], ['==', ['get', 'kind'], 'metro'], C.metro, C.sky],
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 12, 3.2, 16, 5], 'line-opacity': 0.95,
    } });
  map.addLayer({ id: 'stations', type: 'circle', source: 'transit-src', minzoom: 9.8,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], 'station']], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9.8, 2.6, 13, 5.5, 16, 8],
      'circle-color': ['case', ['!=', ['get', 'color'], ''], ['get', 'color'], C.metro],
      'circle-stroke-color': '#0b0f14', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10.5, 1, 14, 2],
    } });
  map.addLayer({ id: 'stations-label', type: 'symbol', source: 'transit-src', minzoom: 12.5,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], 'station']], layout: {
      'text-field': ['coalesce', ['get', 'name'], ['get', 'ref']], 'text-font': ['Noto Sans Regular'],
      'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 8,
    }, paint: { 'text-color': C.metro, 'text-halo-color': '#0b0f14', 'text-halo-width': 1.6 } });

  addGeoJson(map, 'roads-src', roads);
  map.addLayer({ id: 'roads-hit', type: 'line', source: 'roads-src', layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#000000', 'line-opacity': 0.01, 'line-width': 18 } });
  map.addLayer({ id: 'roads-ok', type: 'line', source: 'roads-src', filter: ['==', ['get', 'sev'], 1],
    layout: { 'line-cap': 'round' }, paint: { 'line-color': C.ok,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 12, 2, 16, 5], 'line-opacity': 0.22 } });
  map.addLayer({ id: 'roads-glow', type: 'line', source: 'roads-src', filter: ['>=', ['get', 'sev'], 3],
    layout: { 'line-sort-key': ['get', 'sev'] }, paint: {
      'line-color': ['match', ['get', 'sedan'], 'blocked', C.blocked, 'risky', C.risky, C.caution],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 16, 12, 24, 15, 38], 'line-blur': 8, 'line-opacity': 0.85,
    } });
  map.addLayer({ id: 'roads-risk', type: 'line', source: 'roads-src', filter: ['all', ['>=', ['get', 'sev'], 2], ['<', ['get', 'sev'], 4]],
    layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'sev'] }, paint: {
      'line-color': ['match', ['get', 'sedan'], 'risky', C.risky, C.caution],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 11, 6, 13, 7.5, 16, 11], 'line-opacity': 1,
    } });
  map.addLayer({ id: 'roads-blocked', type: 'line', source: 'roads-src', filter: ['>=', ['get', 'sev'], 4],
    layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: {
      'line-color': C.blocked, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 11, 6, 13, 7.5, 16, 11],
      'line-dasharray': [2, 1.35], 'line-opacity': 1,
    } });

  addPointPair(map, 'landmarks', snapshot.osm.landmarks, C.landmark, '◆', 11.5);
  map.addLayer({ id: 'landmarks-label', type: 'symbol', source: 'landmarks', minzoom: 12.5, layout: {
    'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'],
    'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-max-width': 8, 'text-optional': true,
  }, paint: { 'text-color': '#ddd6fe', 'text-halo-color': '#0b0f14', 'text-halo-width': 1.6 } });
  addPointPair(map, 'pumping', snapshot.osm.pumping, C.pump, 'P', 10.3);
  addPointPair(map, 'fire', snapshot.osm.fireStations, C.fire, 'F', 10.3, 1.1);
  addPointPair(map, 'shelters', snapshot.osm.shelters, C.shelter, 'S', 9.5);
  addPointPair(map, 'hospitals', snapshot.osm.hospitals, C.hospital, 'H', 12.5, 1.1);

  addGeoJson(map, 'reports-src', reports, true);
  map.addLayer({ id: 'reports-cluster', type: 'circle', source: 'reports-src', filter: ['has', 'point_count'], paint: {
    'circle-radius': ['step', ['get', 'point_count'], 12, 10, 15, 40, 19, 120, 24, 300, 29],
    'circle-color': '#0e3a5c', 'circle-opacity': 0.92,
    'circle-stroke-color': ['case', ['>', ['get', 'closed'], 0], C.blocked, C.rain], 'circle-stroke-width': 2.2,
  } });
  map.addLayer({ id: 'reports-cluster-count', type: 'symbol', source: 'reports-src', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12,
      'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#ffffff' } });
  map.addLayer({ id: 'reports', type: 'circle', source: 'reports-src', filter: ['!', ['has', 'point_count']], paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.2, 11, 3.2, 13, 4.5],
    'circle-color': ['case', ['get', 'closed'], C.blocked, ['==', ['get', 'ver'], 'verified'], C.rain, 'rgba(11,15,20,.25)'],
    'circle-stroke-color': ['case', ['get', 'closed'], '#fecaca', ['==', ['get', 'ver'], 'traffy'], '#e879f9',
      ['==', ['get', 'ver'], 'verified'], '#0b0f14', '#7dd3fc'],
    'circle-stroke-width': ['case', ['get', 'closed'], 1.2, ['==', ['get', 'ver'], 'verified'], 1, 2],
  } });

  addGeoJson(map, 'depth-src', depth);
  map.addLayer({ id: 'depth-dots', type: 'circle', source: 'depth-src', minzoom: 9.8, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9.8, 3.5, 13, 5],
    'circle-color': 'rgba(11,15,20,.55)',
    'circle-stroke-color': ['step', ['get', 'cm'], '#7dd3fc', 35, C.caution, 70, C.risky, 120, C.blocked],
    'circle-stroke-width': 2.4,
  } });
  map.addLayer({ id: 'depth-labels', type: 'symbol', source: 'depth-src', minzoom: 9.8, layout: {
    'text-field': ['get', 'text'], 'text-font': ['Noto Sans Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 9.8, 10, 15, 13], 'text-anchor': 'left',
    'text-offset': [1.15, 0], 'text-max-width': 12, 'text-allow-overlap': false,
    'text-ignore-placement': false, 'text-optional': true, 'symbol-sort-key': ['-', 0, ['get', 'cm']],
  }, paint: { 'text-color': ['case', ['==', ['get', 'deep'], 1], '#fecaca', '#e6edf3'],
    'text-halo-color': '#0b0f14', 'text-halo-width': 2 } });

  addGeoJson(map, 'station-water-src', snapshot.stationWater);
  map.addLayer({ id: 'station-water', type: 'symbol', source: 'station-water-src', minzoom: 10.3, layout: {
    'text-field': ['concat', ['coalesce', ['get', 'name'], ['get', 'ref'], 'Station'], ' · ',
      ['to-string', ['round', ['get', 'maxDepthCm']]], ' cm'],
    'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-anchor': 'bottom', 'text-offset': [0, -1.1],
    'text-padding': 5, 'symbol-sort-key': ['-', 0, ['get', 'maxDepthCm']], 'text-max-width': 40,
    'text-allow-overlap': false, 'text-optional': false,
  }, paint: { 'text-color': '#e0f2fe', 'text-halo-color': '#0c2a44', 'text-halo-width': 5 } });

  map.addLayer({ id: 'districts-label', type: 'symbol', source: 'district-labels', minzoom: 10.6, layout: {
    'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 13, 13], 'text-transform': 'uppercase',
    'text-letter-spacing': 0.08, 'text-max-width': 7,
  }, paint: { 'text-color': '#cbd5e1', 'text-opacity': 0.7, 'text-halo-color': '#0b0f14', 'text-halo-width': 1.8 } });
}

export function applyLayerVisibility(map: MapLibreMap, active: Record<LayerKey, boolean>): void {
  for (const layer of LAYERS_2D) for (const id of layer.ids) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', active[layer.key] ? 'visible' : 'none');
  }
}

export function addRadarLayer(map: MapLibreMap, tile: string, visible: boolean): void {
  if (map.getSource('radar-src')) return;
  map.addSource('radar-src', { type: 'raster', tiles: [tile], tileSize: 256, maxzoom: 7 });
  const before = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
  map.addLayer({ id: 'radar', type: 'raster', source: 'radar-src', layout: {
    visibility: visible ? 'visible' : 'none',
  }, paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, before);
}

export function popupName(properties: Record<string, unknown>, fallback: string): string {
  return textValue(properties['name:en']) || textValue(properties.name_en) || textValue(properties.name) || fallback;
}
