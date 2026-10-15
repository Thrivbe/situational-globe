'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, RasterTileSource } from 'maplibre-gl';
import type { Snapshot } from '@/situations/types';
import { isRecord, numberValue, partStatus, riverRows, textValue } from './helpers';
import { addRadarLayer, addSnapshotLayers, applyLayerVisibility, popupName } from './mapLayers';
import type { LayerKey } from './layers';
import type { BangkokMapApi, Language, RadarStatus } from './types';
import MapCredit from './MapCredit';
import MapLegend from './MapLegend';
import RadarTimeline, { type RadarFrame } from './RadarTimeline';

const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const BANGKOK: [number, number] = [100.53, 13.75];
const RADAR_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_TILES = 'https://tilecache.rainviewer.com';

type Props = {
  snapshot: Snapshot;
  language: Language;
  activeLayers: Record<LayerKey, boolean>;
  onMapReady(api: BangkokMapApi | null): void;
  onRadarStatus(status: RadarStatus): void;
  now: number;
};

const append = (parent: HTMLElement, tag: string, className: string, value: string): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
};

function popupContent(key: string, properties: Record<string, unknown>, language: Language): HTMLElement {
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
  const cm = numberValue(properties.cm, numberValue(properties.maxDepthCm));

  if (key === 'reports') {
    title(language === 'th' ? 'รายงานน้ำท่วม' : 'Flood report', [textValue(properties.source), textValue(properties.tier)].filter(Boolean).join(' · '));
    row('Status', textValue(properties.ver)); row('Depth', cm ? `${Math.round(cm)} cm` : 'not stated');
    row('Road', properties.closed ? 'closed' : ''); row('Reported', textValue(properties.time));
    if (textValue(properties.text)) note(textValue(properties.text));
  } else if (key === 'roads') {
    title(textValue(properties.label, 'Road'), textValue(properties.hw) ? `${textValue(properties.hw)} road` : '');
    row('Sedan', properties.sedan); row('Motorbike', properties.motorbike); row('Pickup', properties.pickup);
    row('Truck', properties.truck); row('Depth', numberValue(properties.depthCm) ? `${Math.round(numberValue(properties.depthCm))} cm` : '');
    row('Sources', properties.srcs);
  } else if (key === 'danger-grid') {
    title(`${textValue(properties.name, 'Danger')} cell`, 'Derived from snapshot roads, reports and rain');
    row('Blocked roads', properties.blocked); row('Risky roads', properties.risky); row('Open reports', properties.reports);
    row('Rain next 6 h', numberValue(properties.rain6) ? `${numberValue(properties.rain6)} mm` : ''); row('Score', properties.score);
  } else if (key === 'depth-labels') {
    title(language === 'th' ? 'ความลึกน้ำท่วม' : 'Flood depth', textValue(properties.text));
    row('Road', properties.road); row('Depth', cm ? `${Math.round(cm)} cm` : ''); row('Seen in', properties.src);
  } else if (key === 'districts-fill') {
    title(`${popupName(properties, 'District')} district`, textValue(properties.nameTh));
    row('Flood signals', properties.signals); row('Population', numberValue(properties.population) || '');
  } else if (key === 'raingrid') {
    title('Rain cell', 'Forecast at the 3×3 grid point');
    const mm = numberValue(properties.mm, Number.NaN);
    const next6 = numberValue(properties.n6, Number.NaN);
    const next24 = numberValue(properties.n24, Number.NaN);
    row('This hour', Number.isFinite(mm) ? `${mm} mm` : '—'); row('Next 6 h', Number.isFinite(next6) ? `${next6} mm` : '—');
    row('Next 24 h', Number.isFinite(next24) ? `${next24} mm` : '—');
  } else if (key === 'raindist') {
    title(`${popupName(properties, 'District')} district`, 'Rain forecast at district centre');
    row('Next 6 h', `${numberValue(properties.n6)} mm`); row('Next 24 h', `${numberValue(properties.n24)} mm`);
  } else if (key === 'station-water') {
    title(popupName(properties, textValue(properties.ref, 'Station')), 'Water nearby');
    row('Deepest within 500 m', cm ? `${Math.round(cm)} cm` : 'not stated'); row('Flood points nearby', properties.n);
    note('Water is near the station; this does not say that the station is closed.');
  } else if (key === 'stations') {
    title(popupName(properties, textValue(properties.ref, 'Station')), 'Metro / rail station');
    row('Line', properties.line); row('Operator', properties.operator);
  } else if (key === 'transit') {
    title(popupName(properties, textValue(properties.line, 'Transit line')), 'Metro / rail line');
    row('Ref', properties.ref); row('Operator', properties.operator);
  } else if (key === 'shelters') {
    title(popupName(properties, 'Unnamed site'), 'Possible gathering site');
    note('Possible gathering site from OpenStreetMap. Not an official evacuation list: check with the district office.');
  } else if (key === 'hospitals') {
    title(popupName(properties, 'Hospital (unnamed)'), 'Hospital'); row('Emergency', properties.emergency); row('Phone', properties.phone);
  } else if (key === 'pumping') {
    title(popupName(properties, 'Pumping / gate / weir'), 'Flood-control infrastructure'); row('Operator', properties.operator);
  } else if (key === 'fire') {
    title(popupName(properties, 'Fire station (unnamed)'), 'Fire / rescue station'); row('Phone', properties.phone);
  } else if (key === 'landmarks') {
    title(popupName(properties, 'Landmark'), [textValue(properties.tourism), textValue(properties.historic)].filter(Boolean).join(' · '));
  } else if (key === 'airports') {
    title(popupName(properties, 'Airport'), 'Airport'); row('IATA', properties.iata); row('ICAO', properties.icao);
  } else if (key === 'canals') {
    title(popupName(properties, 'Waterway'), textValue(properties.class, 'Canal / river'));
  } else if (key === 'ferry') {
    title('Boat line', 'Check the operator for service conditions.');
  } else {
    title(popupName(properties, key));
  }
  return root;
}

const PICK: [string, string, LayerKey][] = [
  ['station-water', 'station-water', 'stationWater'], ['raindist-label', 'raindist', 'raingrid'],
  ['reports-cluster', 'cluster', 'reports'], ['reports-cluster-count', 'cluster', 'reports'],
  ['hospitals', 'hospitals', 'hospitals'], ['hospitals-g', 'hospitals', 'hospitals'],
  ['shelters', 'shelters', 'shelters'], ['shelters-g', 'shelters', 'shelters'],
  ['pumping', 'pumping', 'pumping'], ['pumping-g', 'pumping', 'pumping'],
  ['fire', 'fire', 'fire'], ['fire-g', 'fire', 'fire'], ['stations', 'stations', 'transit'],
  ['stations-label', 'stations', 'transit'], ['rail-stations', 'stations', 'transit'], ['rail-stations-label', 'stations', 'transit'],
  ['airports', 'airports', 'airports'], ['airports-label', 'airports', 'airports'],
  ['landmarks', 'landmarks', 'landmarks'], ['landmarks-g', 'landmarks', 'landmarks'],
  ['depth-dots', 'depth-labels', 'depth'], ['depth-labels', 'depth-labels', 'depth'],
  ['reports', 'reports', 'reports'], ['roads-blocked', 'roads', 'roads'], ['roads-risk', 'roads', 'roads'], ['roads-ok', 'roads', 'roads'], ['roads-hit', 'roads', 'roads'],
  ['transit', 'transit', 'transit'], ['rail', 'transit', 'transit'], ['ferry', 'ferry', 'waterways'], ['canals', 'canals', 'waterways'],
  ['danger-grid', 'danger-grid', 'danger'], ['raingrid', 'raingrid', 'raingrid'], ['districts-fill', 'districts-fill', 'districts'],
];
const NO_HOVER = new Set(['danger-grid', 'districts-fill', 'raingrid']);

function RiverCard({ snapshot, now }: { snapshot: Snapshot; now: number }) {
  const rows = useMemo(() => riverRows(snapshot.weather.river), [snapshot]);
  const unavailable = partStatus(snapshot, now).river === 'missing';
  return <details className="flowcard" open><summary>River discharge <span className="dim">m³/s</span></summary>
    <div className="fl-sub dim">7 d back · 14 d ahead · modelled</div>
    <div className="fl-rows">{!unavailable && rows.length ? rows.map((row) => {
      const current = row.q[Math.max(0, row.days.indexOf(new Date(now + 7 * 3_600_000).toISOString().slice(0, 10)))] ?? row.q[0];
      return <div className="fl-row" key={row.name}><span className="fl-n">{row.name}</span><span className="fl-v"><b>{Number.isFinite(current) ? Math.round(current).toLocaleString('en') : '—'}</b> now</span></div>;
    }) : <span className="dim">River discharge unavailable</span>}</div>
  </details>;
}

export default function BangkokMap({ snapshot, language, activeLayers, onMapReady, onRadarStatus, now }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const styleReadyRef = useRef(false);
  const activeRef = useRef(activeLayers);
  const languageRef = useRef(language);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    activeRef.current = activeLayers;
    if (mapRef.current) applyLayerVisibility(mapRef.current, activeLayers);
  }, [activeLayers]);
  useEffect(() => { languageRef.current = language; }, [language]);

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
        center: BANGKOK,
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
          if (coordinates && Number.isFinite(clusterId)) {
            const source = map.getSource('reports-src') as GeoJSONSource | undefined;
            void source?.getClusterExpansionZoom(clusterId).then((zoom) => map.easeTo({ center: coordinates as [number, number], zoom: Math.min(16, zoom + 0.3) }));
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
        styleReadyRef.current = true;
        applyLayerVisibility(map, activeRef.current);
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
        if (!isRecord(value) || !isRecord(value.radar) || !Array.isArray(value.radar.past)) {
          throw new Error('radar index is invalid');
        }
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

  return (
    <div className="mapwrap">
      <div className="mapbox">
        <div ref={containerRef} className="map" />
        {mapError && <div className="maperror" role="alert">Map could not load. The list still works.</div>}
        <RiverCard snapshot={snapshot} now={now} />
        <MapLegend active={activeLayers} language={language} />
        <MapCredit snapshot={snapshot} />
      </div>
      <RadarTimeline frames={frames} frameIndex={frameIndex} onFrame={chooseFrame} snapshot={snapshot} />
    </div>
  );
}
