'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Snapshot } from '@/situations/types';
import {
  bangkokTime,
  districtNames,
  partStatus,
  propertiesOf,
  SNAPSHOT_PARTS,
  textValue,
  timeAgo,
} from './helpers';
import { translate as tr } from './copy';
import type { Language } from './types';

type Props = {
  snapshot: Snapshot;
  language: Language;
  onLanguage(language: Language): void;
  search: string;
  searchMiss: boolean;
  onSearch(value: string): void;
  onSearchSubmit(value?: string): void;
  onNear(): void;
  mapAvailable: boolean;
  nearPending: boolean;
  sourcesOpen: boolean;
  onSources(): void;
  now: number;
};

export default function BangkokHeader({
  snapshot, language, onLanguage, search, searchMiss, onSearch, onSearchSubmit, onNear,
  mapAvailable, nearPending, sourcesOpen, onSources, now,
}: Props) {
  const t = (key: string, english: string) => tr(language, key, english);
  const [announceStatus, setAnnounceStatus] = useState(false);
  const names = useMemo(() => districtNames(snapshot.osm.districts), [snapshot]);
  const latestReport = useMemo(() => snapshot.flood.reports.features.reduce((latest, feature) => {
    const time = Date.parse(textValue(propertiesOf(feature).time));
    return Number.isFinite(time) && time > latest ? time : latest;
  }, 0), [snapshot]);
  const statuses = partStatus(snapshot, now);
  const missing = SNAPSHOT_PARTS.filter((part) => statuses[part] === 'missing');
  const stale = SNAPSHOT_PARTS.filter((part) => statuses[part] === 'stale');
  let oldestStale = 0;
  for (const part of stale) {
    const time = Date.parse(snapshot.feedsAt[part]);
    if (!oldestStale || time < oldestStale) oldestStale = time;
  }
  const partNames = (parts: readonly string[]) => parts.map((part) => part === 'districtRain' ? 'district rain' : part).join(', ');

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounceStatus(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <header id="top">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <div><b>{t('brand', 'Bangkok flood watch')}</b><span className="dim">{t('tag', 'Live road and rain situation')}</span></div>
      </div>
      <div className="search">
        <label className="sr-only" htmlFor="find">{t('search', 'Find a district')}</label>
        <input
          id="find"
          list="dlist"
          type="search"
          autoComplete="off"
          className={searchMiss ? 'nomatch' : ''}
          placeholder={t('search', 'Find a district')}
          aria-label={t('search', 'Find a district')}
          aria-invalid={searchMiss || undefined}
          aria-describedby={searchMiss ? 'find-error' : undefined}
          value={search}
          disabled={!mapAvailable}
          title={!mapAvailable ? 'Map unavailable' : undefined}
          onInput={(event) => {
            const value = event.currentTarget.value;
            onSearch(value);
            if (names.includes(value)) onSearchSubmit(value);
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') onSearchSubmit(); }}
        />
        <datalist id="dlist">{names.map((name) => <option value={name} key={name} />)}</datalist>
        {searchMiss && <span id="find-error" className="searcherror">No district found</span>}
        <button type="button" className="tbtn" onClick={onNear} disabled={!mapAvailable || nearPending}
          title={!mapAvailable ? 'Map unavailable' : nearPending ? 'Finding your location' : 'Show flooding within 3 km of your position'}>
          {t('near', 'Around me')}
        </button>
      </div>
      <div className="status" aria-live="polite">
        {announceStatus && <>
          <span className={`live${missing.length ? ' missing' : stale.length ? ' stale' : ''}`} />
          {missing.length ? <span>{t('missing', 'Some data unavailable')}: {partNames(missing)}{stale.length ? ` · ${t('old', 'Data is old')}: ${partNames(stale)}` : ''}</span>
            : stale.length ? <span>{t('old', 'Data is old')}: {partNames(stale)}</span>
              : <span>{t('live', 'Live')}</span>}
          {stale.length > 0 && <><span className="sep" /><span className="dim">{t('dataFrom', 'data from')} <b>{bangkokTime(oldestStale)}</b></span></>}
          <span className="sep" /><span className="dim">{t('roadsUpdated', 'Roads updated')} <b>{statuses.roads === 'missing' ? '—' : timeAgo(snapshot.feedsAt.roads, now)}</b></span>
          <span className="sep" /><span className="dim">{t('latestReport', 'Latest report')} <b>{statuses.reports !== 'missing' && latestReport ? timeAgo(latestReport, now) : '—'}</b></span>
        </>}
      </div>
      <div className="tools">
        <div className="seg" role="group" aria-label="Language">
          <button type="button" className={language === 'en' ? 'on' : ''} aria-pressed={language === 'en'} onClick={() => onLanguage('en')}>EN</button>
          <button type="button" lang="th" className={language === 'th' ? 'on' : ''} aria-pressed={language === 'th'} onClick={() => onLanguage('th')}>ไทย</button>
        </div>
        <button type="button" id="srcbtn" className="tbtn" aria-expanded={sourcesOpen} aria-controls="sources" onClick={onSources}>
          {t('sources', 'Sources')}
        </button>
        <nav className="seg" aria-label="View">
          <button type="button" className="on" aria-pressed="true">{t('view2d', '2D map')}</button>
        </nav>
      </div>
    </header>
  );
}
