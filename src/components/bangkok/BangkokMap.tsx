'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, RasterTileSource } from 'maplibre-gl';
import type { Snapshot } from '@/situations/types';
import { createCityAnimation, type CityAnimation } from './animation';
import { addCityLayers, applyView, cameraTarget } from './city3d';
import { translate as tr } from './copy';
import { BANGKOK_CENTRE, isRecord, numberValue, textValue } from './helpers';
import type { LayerKey } from './layers';
import { addRadarLayer, addSnapshotLayers, popupName } from './mapLayers';
import type { BangkokMapApi, BangkokView, Language, RadarStatus } from './types';
import MapCredit from './MapCredit';
import MapLegend from './MapLegend';
import RadarTimeline, { type RadarFrame } from './RadarTimeline';

const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const RADAR_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_TILES = 'https://tilecache.rainviewer.com';

type Props = {
  snapshot: Snapshot;
  language: Language;
  activeLayers: Record<LayerKey, boolean>;
  onMapReady(api: BangkokMapApi | null): void;
  onRadarStatus(status: RadarStatus): void;
  view: BangkokView;
  onView(view: BangkokView): void;
  city3d: boolean;
  onCity3d(value: boolean): void;
  animation: boolean;
  onAnimation(value: boolean): void;
};

const append = (parent: HTMLElement, tag: string, className: string, value: string): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
};

function popupContent(key: string, properties: Record<string, unknown>, language: Language): HTMLElement {
  const t = (copyKey: string, english: string) => tr(language, copyKey, english);
  const root = document.createElement('div');
  root.className = 'pp-body';
  const title = (value: string, sub = '') => {
    append(root, 'div', 'pp-t', value);
    if (sub) append(root, 'div', 'pp-s', sub);
  };
  const row = (label: string, value: unknown) => {
    const shown = typeof value === 'number' ? String(value) : textValue(value);
    if (!shown) return;
    const line = append(root, 'div', 'pp-row', '');
    append(line, 'span', '', label);
    append(line, 'b', '', shown);
  };
  const note = (value: string) => append(root, 'div', 'pp-note', value);
  const cm = numberValue(properties.cm, numberValue(properties.maxDepthCm, numberValue(properties.depth)));

  if (key === 'reports') {
    title(t('floodReport', 'Flood report'), [textValue(properties.source), textValue(properties.tier)].filter(Boolean).join(' · '));
    row(t('statusLabel', 'Status'), textValue(properties.ver));
    row(t('depthLabel', 'Depth'), cm ? `${Math.round(cm)} cm` : t('notStated', 'not stated'));
    row(t('roadLabel', 'Road'), properties.closed ? t('closed', 'closed') : '');
    row(t('reportedLabel', 'Reported'), textValue(properties.time));
    if (textValue(properties.text)) note(textValue(properties.text));
  } else if (key === 'roads') {
    title(textValue(properties.label, t('road', 'Road')), textValue(properties.hw) ? `${textValue(properties.hw)} ${t('roadLower', 'road')}` : '');
    row(t('sedan', 'Sedan'), properties.sedan); row(t('motorbike', 'Motorbike'), properties.motorbike);
    row(t('pickup', 'Pickup'), properties.pickup); row(t('truck', 'Truck'), properties.truck);
    row(t('depthLabel', 'Depth'), numberValue(properties.depthCm) ? `${Math.round(numberValue(properties.depthCm))} cm` : '');
    row(t('sources', 'Sources'), properties.srcs);
  } else if (key === 'danger-grid') {
    title(`${textValue(properties.name, t('danger', 'Danger'))} ${t('cell', 'cell')}`, t('dangerDerived', 'Derived from snapshot roads, reports and rain'));
    row(t('blockedRoads', 'Blocked roads'), properties.blocked); row(t('riskyRoadsTitle', 'Risky roads'), properties.risky);
    row(t('openReports', 'Open reports'), properties.reports);
    row(t('rainNext6', 'Rain next 6 h'), numberValue(properties.rain6) ? `${numberValue(properties.rain6)} mm` : '');
    row(t('score', 'Score'), properties.score);
  } else if (key === 'depth-labels') {
    title(t('floodDepth', 'Flood depth'), textValue(properties.text));
    row(t('roadLabel', 'Road'), properties.road); row(t('depthLabel', 'Depth'), cm ? `${Math.round(cm)} cm` : '');
    row(t('seenIn', 'Seen in'), properties.src);
  } else if (key === 'districts-fill') {
    title(`${popupName(properties, t('district', 'District'))} ${t('districtLower', 'district')}`, textValue(properties.nameTh));
    row(t('floodSignals', 'Flood signals'), properties.signals); row(t('population', 'Population'), numberValue(properties.population) || '');
  } else if (key === 'raingrid') {
    title(t('rainCell', 'Rain cell'), t('gridForecast', 'Forecast at the 3×3 grid point'));
    const mm = numberValue(properties.mm, Number.NaN);
    const next6 = numberValue(properties.n6, Number.NaN);
    const next24 = numberValue(properties.n24, Number.NaN);
    row(t('thisHour', 'This hour'), Number.isFinite(mm) ? `${mm} mm` : '—');
    row(t('next6', 'Next 6 h'), Number.isFinite(next6) ? `${next6} mm` : '—');
    row(t('next24', 'Next 24 h'), Number.isFinite(next24) ? `${next24} mm` : '—');
  } else if (key === 'raindist') {
    title(`${popupName(properties, t('district', 'District'))} ${t('districtLower', 'district')}`, t('districtForecast', 'Rain forecast at district centre'));
    row(t('next6', 'Next 6 h'), `${numberValue(properties.n6)} mm`); row(t('next24', 'Next 24 h'), `${numberValue(properties.n24)} mm`);
  } else if (key === 'station-water') {
    title(popupName(properties, textValue(properties.ref, t('station', 'Station'))), t('waterNearby', 'Water nearby'));
    row(t('deepest500', 'Deepest within 500 m'), cm ? `${Math.round(cm)} cm` : t('notStated', 'not stated'));
    row(t('floodPoints', 'Flood points nearby'), properties.n);
    note(t('stationNote', 'Water is near the station; this does not say that the station is closed.'));
  } else if (key === 'stations') {
    title(popupName(properties, textValue(properties.ref, t('station', 'Station'))), t('metroStation', 'Metro / rail station'));
    row(t('line', 'Line'), properties.line); row(t('operator', 'Operator'), properties.operator);
  } else if (key === 'transit') {
    title(popupName(properties, textValue(properties.line, t('transitLine', 'Transit line'))), t('metroLine', 'Metro / rail line'));
    row(t('ref', 'Ref'), properties.ref); row(t('operator', 'Operator'), properties.operator);
  } else if (key === 'shelters') {
    title(popupName(properties, t('unnamedSite', 'Unnamed site')), t('possibleGathering', 'Possible gathering site'));
    note(t('shelterNote', 'Possible gathering site from OpenStreetMap. Not an official evacuation list: check with the district office.'));
  } else if (key === 'hospitals') {
    title(popupName(properties, t('unnamedHospital', 'Hospital (unnamed)')), t('hospital', 'Hospital'));
    row(t('emergency', 'Emergency'), properties.emergency); row(t('phone', 'Phone'), properties.phone);
  } else if (key === 'pumping') {
    title(popupName(properties, t('pumpFallback', 'Pumping / gate / weir')), t('floodControl', 'Flood-control infrastructure'));
    row(t('operator', 'Operator'), properties.operator);
  } else if (key === 'fire') {
    title(popupName(properties, t('unnamedFire', 'Fire station (unnamed)')), t('fireRescue', 'Fire / rescue station'));
    row(t('phone', 'Phone'), properties.phone);
  } else if (key === 'landmarks') {
    title(popupName(properties, t('landmark', 'Landmark')), [textValue(properties.tourism), textValue(properties.historic)].filter(Boolean).join(' · '));
  } else if (key === 'airports') {
    title(popupName(properties, t('airport', 'Airport')), t('airport', 'Airport'));
    row(t('iata', 'IATA'), properties.iata); row(t('icao', 'ICAO'), properties.icao);
  } else if (key === 'canals') {
    title(popupName(properties, t('waterway', 'Waterway')), textValue(properties.class, t('canalRiver', 'Canal / river')));
  } else if (key === 'ferry') {
    title(t('boatLine', 'Boat line'), t('boatCheck', 'Check the operator for service conditions.'));
  } else {
    title(popupName(properties, key));
  }
  return root;
}

const PICK: [string, string, LayerKey][] = [
  ['c3-station-water', 'station-water', 'stationWater'], ['station-water', 'station-water', 'stationWater'],
  ['raindist-label', 'raindist', 'raingrid'],
  ['c3-reports-cluster', 'cluster', 'reports'], ['c3-reports-cluster-count', 'cluster', 'reports'],
  ['reports-cluster', 'cluster', 'reports'], ['reports-cluster-count', 'cluster', 'reports'],
  ['c3-hospitals', 'hospitals', 'hospitals'], ['c3-hospitals-badge', 'hospitals', 'hospitals'], ['c3-hospitals-glyph', 'hospitals', 'hospitals'],
  ['c3-shelters', 'shelters', 'shelters'], ['c3-shelters-badge', 'shelters', 'shelters'], ['c3-shelters-glyph', 'shelters', 'shelters'],
  ['c3-pumping', 'pumping', 'pumping'], ['c3-pumping-badge', 'pumping', 'pumping'], ['c3-pumping-glyph', 'pumping', 'pumping'],
  ['hospitals', 'hospitals', 'hospitals'], ['hospitals-g', 'hospitals', 'hospitals'],
  ['shelters', 'shelters', 'shelters'], ['shelters-g', 'shelters', 'shelters'],
  ['pumping', 'pumping', 'pumping'], ['pumping-g', 'pumping', 'pumping'],
  ['fire', 'fire', 'fire'], ['fire-g', 'fire', 'fire'], ['stations', 'stations', 'transit'],
  ['stations-label', 'stations', 'transit'], ['rail-stations', 'stations', 'transit'], ['rail-stations-label', 'stations', 'transit'],
  ['c3-transit-osm-stations', 'stations', 'transit'], ['c3-transit-osm-station-labels', 'stations', 'transit'],
  ['c3-transit-stations', 'stations', 'transit'], ['c3-transit-station-labels', 'stations', 'transit'],
  ['airports', 'airports', 'airports'], ['airports-label', 'airports', 'airports'],
  ['landmarks', 'landmarks', 'landmarks'], ['landmarks-g', 'landmarks', 'landmarks'],
  ['c3-depth-labels', 'depth-labels', 'depth'], ['depth-dots', 'depth-labels', 'depth'], ['depth-labels', 'depth-labels', 'depth'],
  ['c3-report-columns', 'reports', 'reports'], ['c3-report-caps', 'reports', 'reports'],
  ['c3-report-ring', 'reports', 'reports'], ['c3-report-glow', 'reports', 'reports'], ['reports', 'reports', 'reports'],
  ['c3-roads-ribbon', 'roads', 'roads'], ['c3-roads-dash', 'roads', 'roads'], ['c3-roads-core', 'roads', 'roads'],
  ['roads-blocked', 'roads', 'roads'], ['roads-risk', 'roads', 'roads'], ['roads-ok', 'roads', 'roads'], ['roads-hit', 'roads', 'roads'],
  ['c3-transit', 'transit', 'transit'], ['c3-transit-osm', 'transit', 'transit'],
  ['transit', 'transit', 'transit'], ['rail', 'transit', 'transit'], ['ferry', 'ferry', 'waterways'], ['canals', 'canals', 'waterways'],
  ['c3-danger', 'danger-grid', 'danger'], ['c3-danger-line', 'danger-grid', 'danger'],
  ['danger-grid', 'danger-grid', 'danger'], ['raingrid', 'raingrid', 'raingrid'], ['districts-fill', 'districts-fill', 'districts'],
];
const NO_HOVER = new Set(['danger-grid', 'districts-fill', 'raingrid']);

export default function BangkokMap({
  snapshot, language, activeLayers, onMapReady, onRadarStatus, view, onView, city3d, onCity3d, animation, onAnimation,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const animationRef = useRef<CityAnimation | null>(null);
  const styleReadyRef = useRef(false);
  const activeRef = useRef(activeLayers);
  const languageRef = useRef(language);
  const viewRef = useRef(view);
  const city3dRef = useRef(city3d);
  const animationEnabledRef = useRef(animation);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    activeRef.current = activeLayers;
    if (styleReadyRef.current && mapRef.current) applyView(mapRef.current, viewRef.current, activeLayers, city3dRef.current);
  }, [activeLayers]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => {
    const previous = viewRef.current;
    viewRef.current = view;
    const map = mapRef.current;
    if (!styleReadyRef.current || !map) return;
    applyView(map, view, activeRef.current, city3dRef.current);
    if (previous !== view) {
      if (view === '3d') map.easeTo({ center: cameraTarget(snapshot), pitch: 60, bearing: -28, zoom: 14.1, duration: 1_200 });
      else map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
    }
    animationRef.current?.update({ enabled: animationEnabledRef.current, view, city3d: city3dRef.current });
  }, [snapshot, view]);
  useEffect(() => {
    city3dRef.current = city3d;
    if (styleReadyRef.current && mapRef.current) applyView(mapRef.current, viewRef.current, activeRef.current, city3d);
    animationRef.current?.update({ enabled: animationEnabledRef.current, view: viewRef.current, city3d });
  }, [city3d]);
  useEffect(() => {
    animationEnabledRef.current = animation;
    animationRef.current?.update({ enabled: animation, view: viewRef.current, city3d: city3dRef.current });
  }, [animation]);

  const chooseFrame = useCallback((index: number) => {
    setFrameIndex(index);
    const frame = frames[index];
    const source = mapRef.current?.getSource('radar-src') as RasterTileSource | undefined;
    if (frame && source) source.setTiles([frame.tile]);
  }, [frames]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let disposed = false;
    let failed = false;
    let map: maplibregl.Map;
    let radarController: AbortController | null = null;
    const failMap = (error: unknown) => {
      if (disposed || failed) return;
      failed = true;
      console.error('[bangkok] map unavailable', error);
      setMapError(true);
      onMapReady(null);
    };
    try {
      maplibregl.setWorkerUrl(`/vendor/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
      map = new maplibregl.Map({
        container,
        style: STYLE,
        center: BANGKOK_CENTRE,
        zoom: 10.6,
        maxPitch: 75,
        attributionControl: false,
      });
    } catch (error) {
      failMap(error);
      return;
    }
    mapRef.current = map;
    const earlyMapError = (event: maplibregl.ErrorEvent) => failMap(event.error);
    map.on('error', earlyMapError);
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px', className: 'pp' });
    try {
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
    } catch (error) {
      failMap(error);
    }

    const api: BangkokMapApi = {
      fitBounds: (bounds, maxZoom = 13.5) => map.fitBounds(bounds, { padding: 120, maxZoom }),
      flyTo: (longitude, latitude, zoom = 13.2) => map.flyTo({ center: [longitude, latitude], zoom }),
      showUserLocation: (longitude, latitude) => {
        markerRef.current?.remove();
        markerRef.current = new maplibregl.Marker({ color: '#38bdf8' }).setLngLat([longitude, latitude]).addTo(map);
        map.flyTo({ center: [longitude, latitude], zoom: 13.2 });
      },
    };

    const livePicks = () => PICK.filter(([id, , key]) => activeRef.current[key] && map.getLayer(id) &&
      map.getLayoutProperty(id, 'visibility') !== 'none');
    const click = (event: maplibregl.MapMouseEvent) => {
      const picks = livePicks();
      const box: [[number, number], [number, number]] = [
        [event.point.x - 9, event.point.y - 9], [event.point.x + 9, event.point.y + 9],
      ];
      const hits = picks.length ? map.queryRenderedFeatures(box, { layers: picks.map(([id]) => id) }) : [];
      for (const [id, key] of picks) {
        const feature = hits.find((hit) => hit.layer.id === id);
        if (!feature) continue;
        if (key === 'cluster') {
          popup.remove();
          const coordinates = feature.geometry.type === 'Point' ? feature.geometry.coordinates : null;
          const clusterId = numberValue(feature.properties?.cluster_id, Number.NaN);
          const sourceId = id.startsWith('c3-') ? 'c3-report-points' : 'reports-src';
          const source = map.getSource(sourceId) as GeoJSONSource | undefined;
          if (coordinates && Number.isFinite(clusterId) && source) {
            void source.getClusterExpansionZoom(clusterId).then((zoom) => {
              if (!disposed) map.easeTo({ center: coordinates as [number, number], zoom: Math.min(16, zoom + 0.3) });
            });
          }
          return;
        }
        const properties = isRecord(feature.properties) ? feature.properties : {};
        const location = feature.geometry.type === 'Point' ? feature.geometry.coordinates as [number, number] : event.lngLat;
        popup.setLngLat(location).setDOMContent(popupContent(key, properties, languageRef.current)).addTo(map);
        return;
      }
      popup.remove();
    };
    const move = (event: maplibregl.MapMouseEvent) => {
      const ids = livePicks().filter(([, key]) => !NO_HOVER.has(key)).map(([id]) => id);
      const box: [[number, number], [number, number]] = [[event.point.x - 5, event.point.y - 5], [event.point.x + 5, event.point.y + 5]];
      map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(box, { layers: ids }).length ? 'pointer' : '';
    };
    const styleLoad = () => {
      if (disposed || failed) return;
      try {
        addSnapshotLayers(map, snapshot);
        addCityLayers(map, snapshot);
        styleReadyRef.current = true;
        applyView(map, viewRef.current, activeRef.current, city3dRef.current);
        if (viewRef.current === '3d') {
          map.easeTo({ center: cameraTarget(snapshot), pitch: 60, bearing: -28, zoom: 14.1, duration: 1_200 });
        }
        animationRef.current = createCityAnimation(map);
        animationRef.current.update({ enabled: animationEnabledRef.current, view: viewRef.current, city3d: city3dRef.current });
        onMapReady(api);
        map.off('error', earlyMapError);
      } catch (error) {
        failMap(error);
        return;
      }
      radarController = new AbortController();
      onRadarStatus('loading');
      void fetch(RADAR_INDEX, { signal: radarController.signal }).then(async (response) => {
        if (!response.ok) throw new Error(`radar index ${response.status}`);
        const value: unknown = await response.json();
        if (!isRecord(value) || !isRecord(value.radar) || !Array.isArray(value.radar.past)) throw new Error('radar index is invalid');
        return value.radar.past.flatMap((candidate): RadarFrame[] => {
          if (!isRecord(candidate) || typeof candidate.time !== 'number' || typeof candidate.path !== 'string') return [];
          return [{ time: candidate.time, tile: `${RADAR_TILES}${candidate.path}/256/{z}/{x}/{y}/2/1_1.png` }];
        });
      }).then((loaded) => {
        if (disposed) return;
        if (!loaded.length) throw new Error('radar index has no frames');
        setFrames(loaded);
        setFrameIndex(loaded.length - 1);
        addRadarLayer(map, loaded.at(-1)?.tile ?? loaded[0].tile, activeRef.current.radar);
        applyView(map, viewRef.current, activeRef.current, city3dRef.current);
        onRadarStatus('ready');
      }).catch((error: unknown) => {
        if (disposed || radarController?.signal.aborted) return;
        console.error('[bangkok] radar unavailable', error);
        onRadarStatus('unavailable');
      });
    };
    try {
      map.once('style.load', styleLoad);
      map.on('click', click);
      map.on('mousemove', move);
    } catch (error) {
      failMap(error);
    }

    return () => {
      disposed = true;
      radarController?.abort();
      onMapReady(null);
      styleReadyRef.current = false;
      animationRef.current?.destroy();
      animationRef.current = null;
      markerRef.current?.remove();
      markerRef.current = null;
      popup.remove();
      map.off('error', earlyMapError);
      map.off('style.load', styleLoad);
      map.off('click', click);
      map.off('mousemove', move);
      map.remove();
      mapRef.current = null;
    };
  }, [onMapReady, onRadarStatus, snapshot]);

  const t = (key: string, english: string) => tr(language, key, english);
  return (
    <div className="mapwrap">
      <div className="mapbox">
        <div ref={containerRef} className="map" />
        <div className={`city-vignette${view === '3d' ? ' on' : ''}`} aria-hidden="true" />
        <div className="viewcontrols">
          <div className="seg" role="group" aria-label={t('view', 'View')}>
            <button type="button" className={view === '2d' ? 'on' : ''} aria-pressed={view === '2d'} onClick={() => onView('2d')}>2D</button>
            <button type="button" className={view === '3d' ? 'on' : ''} aria-pressed={view === '3d'} onClick={() => onView('3d')}>3D</button>
          </div>
          <label className="mapsetting" title={view === '2d' ? t('threeDOnly', 'Available in 3D view') : undefined}>
            <input type="checkbox" checked={city3d} disabled={view !== '3d'} onChange={(event) => onCity3d(event.currentTarget.checked)} />
            <span>{t('cityPack', '3D city')}</span>
          </label>
          <label className="mapsetting">
            <input type="checkbox" checked={animation} onChange={(event) => onAnimation(event.currentTarget.checked)} />
            <span>{t('animation', 'Animation')}</span>
          </label>
        </div>
        {mapError && <div className="maperror" role="alert">{t('mapFailed', 'Map could not load. The list still works.')}</div>}
        <MapLegend active={activeLayers} language={language} view={view} city3d={city3d} />
        <MapCredit snapshot={snapshot} language={language} />
      </div>
      <RadarTimeline frames={frames} frameIndex={frameIndex} onFrame={chooseFrame} snapshot={snapshot} language={language} />
    </div>
  );
}
