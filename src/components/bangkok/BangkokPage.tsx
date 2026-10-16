'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Position } from 'geojson';
import { haversine } from '@/lib/geo';
import type { Snapshot } from '@/situations/types';
import BangkokHeader from './BangkokHeader';
import BangkokMap from './BangkokMap';
import BangkokPanel from './BangkokPanel';
import SourcesPopover from './SourcesPopover';
import { translate as tr } from './copy';
import {
  districtsWithSignals,
  findDistrict,
  geometryBounds,
  isSnapshotShape,
  nearFlooding,
  numberValue,
  pointInGeometry,
  propertiesOf,
  textValue,
} from './helpers';
import { INITIAL_LAYERS, type LayerKey } from './layers';
import type { BangkokMapApi, Language, RadarStatus } from './types';
import 'maplibre-gl/dist/maplibre-gl.css';

let snapshotRequest: Promise<Snapshot> | null = null;

function loadSnapshot(): Promise<Snapshot> {
  if (snapshotRequest) return snapshotRequest;
  const request = fetch('/api/snapshot/bangkok-flood', { signal: AbortSignal.timeout(20_000) }).then(async (response) => {
    if (!response.ok) throw new Error(`snapshot ${response.status}`);
    const value: unknown = await response.json();
    if (!isSnapshotShape(value)) throw new Error('snapshot is invalid');
    return value as Snapshot;
  });
  snapshotRequest = request.then((value) => {
    snapshotRequest = null;
    return value;
  }).catch((error: unknown) => {
    snapshotRequest = null;
    throw error;
  });
  return snapshotRequest;
}

type NearState =
  | { kind: 'hidden' }
  | { kind: 'message'; message: string }
  | { kind: 'result'; district: string; blocked: number; risky: number; reports: number; roads: { label: string; severity: number; km: number }[] };

export default function BangkokPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [language, setLanguage] = useState<Language>('en');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchMiss, setSearchMiss] = useState(false);
  const [near, setNear] = useState<NearState>({ kind: 'hidden' });
  const [nearPending, setNearPending] = useState(false);
  const [activeLayers, setActiveLayers] = useState({ ...INITIAL_LAYERS });
  const [mapApi, setMapApi] = useState<BangkokMapApi | null>(null);
  const [radarStatus, setRadarStatus] = useState<RadarStatus>('loading');
  const [now, setNow] = useState(() => Date.now());
  const [announceLoading, setAnnounceLoading] = useState(false);
  const mapApiRef = useRef<BangkokMapApi | null>(null);
  const locationRequestRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      locationRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void loadSnapshot().then((value) => { if (live) setSnapshot(value); })
      .catch((fetchError: unknown) => {
        console.error('[bangkok] snapshot unavailable', fetchError);
        if (live) setError(true);
      });
    return () => { live = false; };
  }, [retry]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (snapshot || error) return;
    const timer = window.setTimeout(() => setAnnounceLoading(true), 0);
    return () => window.clearTimeout(timer);
  }, [error, retry, snapshot]);

  useEffect(() => {
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = 'en'; };
  }, [language]);

  const closeSources = useCallback((returnFocus = false) => {
    setSourcesOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => document.getElementById('srcbtn')?.focus());
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !sourcesOpen) return;
      const target = event.target;
      const sources = document.getElementById('sources');
      const trigger = document.getElementById('srcbtn');
      if (target instanceof Node && (sources?.contains(target) || trigger?.contains(target))) {
        event.preventDefault();
        closeSources(true);
      }
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('#sources,#srcbtn')) closeSources();
    };
    window.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', outside);
    };
  }, [closeSources, sourcesOpen]);

  const mapReady = useCallback((api: BangkokMapApi | null) => {
    mapApiRef.current = api;
    if (mountedRef.current) setMapApi(() => api);
  }, []);
  const retryLoad = () => {
    setSnapshot(null);
    setError(false);
    setAnnounceLoading(false);
    setRetry((value) => value + 1);
  };
  const toggle = (key: LayerKey) => setActiveLayers((current) => ({ ...current, [key]: !current[key] }));

  const submitSearch = (value = search) => {
    if (!value.trim()) {
      setSearchMiss(false);
      return;
    }
    const currentMap = mapApiRef.current;
    if (!snapshot || !currentMap) return;
    const feature = findDistrict(snapshot.osm.districts, value);
    const bounds = feature ? geometryBounds(feature.geometry) : null;
    setSearchMiss(!bounds);
    if (bounds) currentMap.fitBounds(bounds, 13.5);
  };

  const aroundMe = () => {
    if (!snapshot || nearPending || !mapApiRef.current) return;
    const request = locationRequestRef.current + 1;
    locationRequestRef.current = request;
    setNearPending(true);
    setNear({ kind: 'message', message: tr(language, 'finding', 'Finding your location…') });
    if (!navigator.geolocation) {
      setNearPending(false);
      setNear({ kind: 'message', message: 'Location unavailable' });
      return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
      if (!mountedRef.current || locationRequestRef.current !== request) return;
      setNearPending(false);
      const at: Position = [position.coords.longitude, position.coords.latitude];
      if (haversine([at[0], at[1]], [100.53, 13.75]) > 60) {
        setNear({ kind: 'message', message: 'You appear to be outside the Bangkok area. Use the district search instead.' });
        return;
      }
      const roads = snapshot.flood.roads;
      const reports = snapshot.flood.reports;
      const nearby = nearFlooding(at, roads, reports);
      const districts = districtsWithSignals(snapshot.osm.districts, snapshot.flood.dangerHexes);
      const district = districts.features.find((feature) => pointInGeometry(at, feature.geometry));
      const districtProperties = district ? propertiesOf(district) : {};
      const districtName = textValue(districtProperties.name);
      const signals = numberValue(districtProperties.signals);
      const districtStatus = !districtName ? 'Not inside a known district'
        : signals >= 12 ? `${districtName}: avoid (${Math.round(signals)} signals)`
          : signals > 0 ? `${districtName}: watch (${Math.round(signals)} signals)` : `${districtName}: no flood signals`;
      setNear({
        kind: 'result',
        district: districtStatus,
        blocked: nearby.roads.filter((road) => road.severity >= 4).length,
        risky: nearby.roads.filter((road) => road.severity === 3).length,
        reports: nearby.reportCount,
        roads: nearby.roads.slice(0, 5),
      });
      mapApiRef.current?.showUserLocation(at[0], at[1]);
    }, (locationError) => {
      if (!mountedRef.current || locationRequestRef.current !== request) return;
      setNearPending(false);
      setNear({ kind: 'message', message: locationError.code === 1 ? 'Location permission denied' : 'Location unavailable' });
    }, { timeout: 10_000, maximumAge: 60_000 });
  };

  if (!snapshot) {
    return <div className="bangkok-root"><main id="app"><div className="loading" role={error ? undefined : 'status'}>
      {error ? <div className="loaderror" role="alert"><p>Could not load live Bangkok data.</p><button type="button" className="tbtn" onClick={retryLoad}>{tr(language, 'retry', 'Retry')}</button></div>
        : announceLoading ? tr(language, 'loading', 'Loading live Bangkok data…') : ''}
    </div></main></div>;
  }

  return (
    <div className="bangkok-root">
      <BangkokHeader
        snapshot={snapshot}
        language={language}
        onLanguage={setLanguage}
        search={search}
        searchMiss={searchMiss}
        onSearch={(value) => { setSearch(value); setSearchMiss(false); }}
        onSearchSubmit={submitSearch}
        onNear={aroundMe}
        mapAvailable={Boolean(mapApi)}
        nearPending={nearPending}
        sourcesOpen={sourcesOpen}
        onSources={() => sourcesOpen ? closeSources(true) : setSourcesOpen(true)}
        now={now}
      />
      {sourcesOpen && <SourcesPopover snapshot={snapshot} language={language} onClose={() => closeSources(true)} />}
      {near.kind !== 'hidden' && <div className="near" role="status">
        {near.kind === 'message' ? <p className="dsum">{near.message}</p> : <>
          <h2><span>{tr(language, 'within', 'Within 3 km of you')}</span><button type="button" className="lnk" onClick={() => setNear({ kind: 'hidden' })}>{tr(language, 'close', 'Close')}</button></h2>
          <p className="dsum"><b>{near.district}</b></p>
          <p className="dsum"><b>{near.blocked}</b> blocked, <b>{near.risky}</b> risky roads · <b>{near.reports}</b> live reports</p>
          <ul className="nlist">{near.roads.length ? near.roads.map((road) => <li key={road.label}><span className={`pill ${road.severity >= 4 ? 'blocked' : 'risky'}`}>{road.severity >= 4 ? 'blocked' : 'risky'}</span> {road.label} <span className="dim">{road.km.toFixed(1)} km</span></li>)
            : <li className="dim">{tr(language, 'noNearby', 'No blocked or risky roads within 3 km.')}</li>}</ul>
        </>}
        {near.kind === 'message' && <button type="button" className="lnk" onClick={() => setNear({ kind: 'hidden' })}>{tr(language, 'close', 'Close')}</button>}
      </div>}
      <main id="app"><div className="a">
        <BangkokPanel snapshot={snapshot} language={language} activeLayers={activeLayers} onToggle={toggle} mapApi={mapApi}
          radarStatus={radarStatus} onSources={() => setSourcesOpen(true)} now={now} />
        <BangkokMap snapshot={snapshot} language={language} activeLayers={activeLayers} onMapReady={mapReady}
          onRadarStatus={setRadarStatus} now={now} />
      </div></main>
    </div>
  );
}
