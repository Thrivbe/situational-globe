'use client';

import { useMemo } from 'react';
import type { Snapshot } from '@/situations/types';
import {
  bangkokTime,
  bangkokDay,
  deepestKnown,
  districtsWithSignals,
  metricsAt,
  numberValues,
  numberValue,
  partStatus,
  propertiesOf,
  rainRows,
  riverRows,
  roadCounts,
  roadGroups,
  severityName,
  SNAPSHOT_PARTS,
  snapshotPartTime,
  stringList,
  textValue,
  timeAgo,
  type RiverRow,
} from './helpers';
import { LAYERS, LAYER_GROUPS, type LayerKey } from './layers';
import { translate as tr } from './copy';
import type { BangkokMapApi, BangkokView, Language, RadarStatus } from './types';

type Props = {
  snapshot: Snapshot;
  language: Language;
  view: BangkokView;
  activeLayers: Record<LayerKey, boolean>;
  onToggle(key: LayerKey): void;
  mapApi: BangkokMapApi | null;
  radarStatus: RadarStatus;
  onSources(): void;
  now: number;
};

const displayNumber = (value: unknown, unit = '', digits = 1): string => {
  const number = numberValue(value, Number.NaN);
  if (!Number.isFinite(number)) return '—';
  const shown = Math.abs(number) >= 10 ? Math.round(number) : Number(number.toFixed(digits));
  return `${shown}${unit}`;
};

const segments = (road: ReturnType<typeof roadGroups>[number], language: Language): string => {
  const parts = [
    road.blocked ? `${road.blocked} ${tr(language, 'blocked', 'blocked')}` : '',
    road.risky ? `${road.risky} ${tr(language, 'risky', 'risky')}` : '',
    road.caution ? `${road.caution} ${tr(language, 'caution', 'caution')}` : '',
  ].filter(Boolean);
  return `${parts.join(', ')} ${tr(language, road.blocked + road.risky + road.caution === 1 ? 'segment' : 'segments',
    road.blocked + road.risky + road.caution === 1 ? 'segment' : 'segments')}`;
};

function RiverDischarge({ rows, now, unavailable, language }: { rows: RiverRow[]; now: number; unavailable: boolean; language: Language }) {
  const t = (key: string, english: string) => tr(language, key, english);
  if (unavailable || !rows.length) return <p className="dim">{t('riverUnavailable', 'River discharge unavailable')}</p>;
  const today = bangkokDay(now);
  return <div className="riverrows">{rows.map((row) => {
    const currentIndex = Math.max(0, row.days.indexOf(today));
    const current = row.q[currentIndex] ?? row.q[0];
    const end = row.q.at(-1) ?? current;
    const trend = end > current * 1.05 ? 'rising' : end < current * 0.95 ? 'falling' : 'steady';
    let max = 1;
    for (const value of row.q) max = Math.max(max, value);
    const points = row.q.map((value, index) => `${index * 84 / Math.max(1, row.q.length - 1)},${23 - value / max * 20}`).join(' ');
    return <div className="riverrow" key={row.name}>
      <span>{row.name}</span>
      <svg width="84" height="24" role="img" aria-label={`${row.name} ${t('dischargeTrend', 'discharge trend')}`}><polyline fill="none" stroke="#818cf8" strokeWidth="1.8" points={points} /></svg>
      <span><b>{displayNumber(current)}</b> m³/s<small className={trend}>{t(trend, trend)}</small></span>
    </div>;
  })}</div>;
}

export default function BangkokPanel({ snapshot, language, view, activeLayers, onToggle, mapApi, radarStatus, onSources, now }: Props) {
  const t = (key: string, english: string) => tr(language, key, english);
  const reports = snapshot.flood.reports;
  const statuses = partStatus(snapshot, now);
  const counts = useMemo(() => roadCounts(snapshot.flood.roads), [snapshot]);
  const groups = useMemo(() => roadGroups(snapshot.flood.roads), [snapshot]);
  const deepest = useMemo(() => deepestKnown(snapshot.flood.roads, snapshot.flood.reports), [snapshot]);
  const districtProperties = useMemo(() => districtsWithSignals(snapshot.osm.districts, snapshot.flood.dangerHexes)
    .features.map(propertiesOf)
    .sort((left, right) => numberValue(right.signals) - numberValue(left.signals)), [snapshot]);
  const avoided = districtProperties.filter((properties) => numberValue(properties.signals) >= 12);
  const watched = districtProperties.filter((properties) => numberValue(properties.signals) > 0 && numberValue(properties.signals) < 12);
  const current = snapshot.weather.current;
  const hourly = snapshot.weather.hourly;
  const currentTime = textValue(current.time).slice(0, 13);
  const forecastMissing = statuses.forecast === 'missing';
  const { rain, maxChance } = useMemo(() => {
    if (forecastMissing) {
      return { rain: metricsAt([], -1), maxChance: Number.NaN };
    }
    const time = stringList(hourly.time);
    const precipitation = numberValues(hourly.precipitation, time.length);
    const index = currentTime ? time.findIndex((item) => item >= currentTime) : -1;
    const metrics = { ...metricsAt(precipitation, index),
      now: numberValue(current.precipitation, numberValue(current.rain, Number.NaN)) };
    const chance = numberValues(hourly.precipitation_probability, time.length);
    let peak = index >= 0 ? 0 : Number.NaN;
    for (let cursor = index; cursor >= 0 && cursor < Math.min(index + 24, chance.length); cursor += 1) {
      peak = Math.max(peak, chance[cursor]);
    }
    return { rain: metrics, maxChance: peak };
  }, [current, currentTime, forecastMissing, hourly]);
  const grid = useMemo(() => rainRows(snapshot.weather.grid), [snapshot]);
  const districtRainSource = snapshot.weather.districtRain;
  const districtRain = useMemo(() => rainRows(districtRainSource).map((row) => ({
    row,
    rain: metricsAt(row.mm, currentTime ? row.time.findIndex((item) => item >= currentTime) : -1),
  })).sort((left, right) => {
    const leftRain = Number.isFinite(left.rain.next6) ? left.rain.next6 : -1;
    const rightRain = Number.isFinite(right.rain.next6) ? right.rain.next6 : -1;
    return rightRain - leftRain;
  }), [currentTime, districtRainSource]);
  const river = useMemo(() => riverRows(snapshot.weather.river), [snapshot]);
  const total = counts.blocked + counts.risky + counts.caution + counts.ok || 1;

  return (
    <aside>
      <section className="top">
        <h2><span>{t('roadsSedan', 'Roads for a sedan')}</span></h2>
        {statuses.roads === 'missing' ? <p className="unavailable">{t('roadsUnavailable', 'Road data unavailable')}</p> : <>
          <div className="hero"><b style={{ color: 'var(--blocked)' }}>{counts.blocked}</b><span>{t('blocked', 'blocked')}<br /><em>{counts.risky} {t('moreRisky', 'more risky')}</em></span></div>
          <div className="sevbar" role="img" aria-label={t('roadStatusSplit', 'Road status split')}>
            {(Object.keys(counts) as (keyof typeof counts)[]).map((key) => <i key={key} style={{ flex: counts[key] / total, background: `var(--${key})` }} />)}
          </div>
          <div className="sevkey">
            <div><b style={{ color: 'var(--blocked)' }}>{counts.blocked}</b><span>{t('blocked', 'Blocked')}</span></div>
            <div><b style={{ color: 'var(--risky)' }}>{counts.risky}</b><span>{t('risky', 'Risky')}</span></div>
            <div><b style={{ color: 'var(--caution)' }}>{counts.caution}</b><span>{t('caution', 'Caution')}</span></div>
            <div><b style={{ color: 'var(--ok)' }}>{counts.ok}</b><span>{t('passable', 'Passable')}</span></div>
          </div>
        </>}
        <p className="disc">{t('disclaimer', 'Community and model data, not a government alert. Check before you travel.')} <button type="button" className="lnk" onClick={onSources}>{t('sources', 'Sources')}</button></p>
        <div className="tiles tiles4">
          <div><b>{avoided.length || '—'}</b><span>{t('districtsAvoid', 'districts to avoid')}</span></div>
          <div><b>{deepest.cm ? <>{Math.round(deepest.cm)}<small> cm</small></> : '—'}</b><span>{t('deepest', 'deepest known')}</span></div>
          <div><b>{statuses.reports === 'missing' ? '—' : reports.features.length}</b><span>{t('reports', 'live reports')}</span></div>
          <div><b>{statuses.river === 'missing' ? '—' : river.length || '—'}</b><span>{t('riverCells', 'river discharge cells')}</span></div>
        </div>
        <p className={`dsum${districtProperties.length ? '' : ' dim'}`}>{districtProperties.length
          ? <>{watched.length} {t('toWatch', 'to watch')}. {t('worstShort', 'Worst')}: <b>{textValue(districtProperties[0]?.name, '—')}</b> ({Math.round(numberValue(districtProperties[0]?.signals))} {t('signals', 'signals')}).</>
          : t('districtSummaryUnavailable', 'District summary unavailable.')}</p>
      </section>

      <section className="weathersec">
        <h2>{t('rain', 'Rain')}</h2>
        <div className="rainhead">{forecastMissing ? t('weatherUnavailable', 'Weather data unavailable')
          : rain.now >= 0.2 ? t('rainingNow', 'Raining now')
            : rain.next24 > 0 ? t('dryRainComing', 'Dry now, rain in the forecast')
              : Number.isFinite(rain.next24) ? t('dryNoRain', 'Dry now, none forecast') : t('forecastUnavailable', 'Forecast unavailable')}</div>
        <div className="stats3">
          <div><b>{displayNumber(rain.now)}<small> mm/h</small></b><span>{t('now', 'now')}</span></div>
          <div><b>{displayNumber(rain.next6)}<small> mm</small></b><span>{t('next6', 'next 6 h')}</span></div>
          <div><b>{Number.isFinite(maxChance) ? <>{Math.round(maxChance)}<small>%</small></> : '—'}</b><span>{t('peak', 'peak chance, 24 h')}</span></div>
        </div>
        <div className="tiles weather4">
          <div><b>{forecastMissing ? '—' : displayNumber(current.temperature_2m, '°C')}</b><span>{t('temperature', 'temperature')}</span></div>
          <div><b>{forecastMissing ? '—' : displayNumber(current.relative_humidity_2m, '%')}</b><span>{t('humidity', 'humidity')}</span></div>
          <div><b>{forecastMissing ? '—' : displayNumber(current.wind_speed_10m)}</b><span>{t('wind', 'km/h wind')}</span></div>
          <div><b>{forecastMissing ? '—' : displayNumber(current.uv_index)}</b><span>{t('uv', 'UV')}</span></div>
        </div>
        <div className="rainextras">
          <div><h3>{t('rainGrid', 'Rain grid 3×3')}</h3><div className="grid9">{Array.from({ length: 9 }, (_, index) => {
            const row = grid[index];
            const value = statuses.grid !== 'missing' && row
              ? metricsAt(row.mm, currentTime ? row.time.findIndex((item) => item >= currentTime) : -1).next6
              : Number.NaN;
            return <span key={index} title={row ? `${row.lat}, ${row.lon}` : ''}>{Number.isFinite(value) ? `${value} mm` : '—'}</span>;
          })}</div></div>
          <div><h3>{t('districtRain', 'District rain')}</h3><div className="districtchips">{statuses.districtRain === 'missing'
            ? <span>—</span>
            : districtRain.slice(0, 8).map(({ row, rain: metrics }) =>
              <span key={`${row.name}-${row.lat}`}>{row.name ?? t('district', 'District')} · {Number.isFinite(metrics.next6) ? `${metrics.next6} mm` : '—'}</span>)}</div></div>
        </div>
      </section>

      <section className="roadsec">
        <h2><span>{t('worst', 'Worst roads now')}</span><span className="hint">{groups.length} {t('roads', 'roads')} · {t('clickZoom', 'click to zoom')}</span></h2>
        <div className="rscroll"><ol className="roads">{groups.slice(0, 25).map((road, index) => {
          const severity = severityName(road.severity);
          return <li key={`${road.label}-${index}`} style={{ '--c': `var(--${severity})` } as React.CSSProperties}>
            <button type="button" className="roadbtn" disabled={!mapApi} title={!mapApi ? t('mapUnavailable', 'Map unavailable') : undefined}
              onClick={() => mapApi?.fitBounds(road.bounds, 16)}>
              <span className="rk">{index + 1}</span><span className="rn"><b title={road.label}>{road.label}</b><span className="dim">{segments(road, language)}{road.depth ? ` · ${t('deepestLower', 'deepest')} ${Math.round(road.depth)} cm` : ''}{road.updated ? ` · ${timeAgo(language, road.updated, now)}` : ''}</span></span><span className={`pill ${severity}`}>{t(severity, severity)}</span>
            </button>
          </li>;
        })}</ol></div>
      </section>

      <details className="lay laysec" open>
        <summary>{t('layers', 'Layers')}</summary>
        <div className="layergroups">{LAYER_GROUPS.map((group) => <div className="grp" key={group.label}>
          <h3>{tr(language, `group_${group.key}`, group.label, group.thai)}</h3>
          <div className="tchips all">{group.keys.map((key) => {
            const layer = LAYERS.find((candidate) => candidate.key === key);
            if (!layer) return null;
            const count = layer.count?.(snapshot) ?? null;
            const radarUnavailable = key === 'radar' && radarStatus === 'unavailable';
            const twoDOnly = view === '3d' && !layer.ids3d.length;
            const legend = view === '3d' ? layer.legend3d ?? layer.legend2d : layer.legend2d;
            return <label className={`tchip${twoDOnly ? ' only2d' : ''}`} key={key} title={twoDOnly ? t('twoDOnly', '2D only') : undefined}>
              <input type="checkbox" checked={activeLayers[key]} disabled={radarUnavailable || twoDOnly} onChange={() => onToggle(key)} />
              <i className={`lg ${legend[0]?.shape ?? 'swatch'}`} style={{ background: legend[0]?.color ?? 'var(--dim)' }} />
              <span className="nm">{radarUnavailable ? t('radarUnavailable', 'Radar unavailable') : tr(language, `layer_${key}`, layer.label, layer.thai)}</span>{count !== null && <span className="ct">{count}</span>}
            </label>;
          })}</div>
        </div>)}</div>
      </details>

      {view === '2d' && <details className="flowpanel"><summary>{t('river', 'River discharge')} <span className="dim">m³/s</span></summary><RiverDischarge rows={river} now={now} unavailable={statuses.river === 'missing'} language={language} /></details>}
      <details className="freshd"><summary>{t('fresh', 'Data freshness')}</summary><dl className="fresh">
        {SNAPSHOT_PARTS.map((part) => <div className="freshrow" key={part}><dt>{t(`part_${part}`, part === 'districtRain' ? 'district rain' : part)}</dt><dd>{statuses[part] === 'missing'
          ? t('unavailable', 'unavailable') : `${timeAgo(language, snapshotPartTime(snapshot, part), now)} · ${bangkokTime(snapshotPartTime(snapshot, part))}`}</dd></div>)}
      </dl></details>
    </aside>
  );
}
