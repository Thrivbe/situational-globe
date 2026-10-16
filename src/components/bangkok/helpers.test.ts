import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/situations/types';
import BangkokPanel from './BangkokPanel';
import { isSnapshotShape, nearFlooding, partStatus } from './helpers';

describe('isSnapshotShape', () => {
  const ok = { credits: [], feedsAt: {}, flood: {}, weather: {}, osm: {}, stationWater: {} };
  it('accepts the top-level shape and rejects a snapshot missing a part', () => {
    expect(isSnapshotShape(ok)).toBe(true);
    expect(isSnapshotShape({ ...ok, credits: undefined })).toBe(false);
    expect(isSnapshotShape({ ...ok, flood: null })).toBe(false);
    expect(isSnapshotShape([])).toBe(false);
  });
});
import { INITIAL_LAYERS } from './layers';

const emptyCollection = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });
const NOW = new Date('2026-10-15T12:00:00.000Z');

function snapshot(feedsAt: Record<string, string>): Snapshot {
  return {
    localMap: 'bangkok-flood', situation: 'bangkok-flood-2026', builtAt: NOW.toISOString(), feedsAt,
    level: 0, credits: [],
    flood: { roads: emptyCollection(), reports: emptyCollection(), dangerHexes: emptyCollection(), depthPoints: emptyCollection() },
    weather: { current: {}, hourly: {}, grid: [], districtRain: [], river: [] },
    osm: {
      builtAt: NOW.toISOString(), hospitals: emptyCollection(), shelters: emptyCollection(), pumping: emptyCollection(),
      fireStations: emptyCollection(), districts: emptyCollection(), transit: emptyCollection(), landmarks: emptyCollection(),
    },
    stationWater: emptyCollection(),
  };
}

const freshFeeds = (): Record<string, string> => Object.fromEntries(
  ['roads', 'reports', 'forecast', 'grid', 'districtRain', 'river'].map((part) => [part, NOW.toISOString()]),
);

describe('Bangkok snapshot helpers', () => {
  it('does not report live and shows the panel unavailable state when roads metadata is missing', () => {
    const feedsAt = freshFeeds();
    delete feedsAt.roads;
    const value = snapshot(feedsAt);
    const statuses = partStatus(value, NOW);
    const panel = renderToStaticMarkup(createElement(BangkokPanel, {
      snapshot: value, language: 'en', activeLayers: INITIAL_LAYERS, onToggle: () => undefined,
      mapApi: null, radarStatus: 'loading', onSources: () => undefined, now: NOW.getTime(),
    }));

    expect(Object.values(statuses).every((status) => status === 'ok')).toBe(false);
    expect(statuses.roads).toBe('missing');
    expect(panel).toContain('Road data unavailable');
    expect(panel).not.toContain('aria-label="Road status split"');
  });

  it('marks a feed part that is 61 minutes old as stale', () => {
    expect(partStatus(snapshot({ ...freshFeeds(), roads: '2026-10-15T10:59:00.000Z' }), NOW).roads).toBe('stale');
  });

  it('marks a feed part that is 59 minutes old as ok', () => {
    expect(partStatus(snapshot({ ...freshFeeds(), roads: '2026-10-15T11:01:00.000Z' }), NOW).roads).toBe('ok');
  });

  it('marks an unparseable feed time as missing', () => {
    expect(partStatus(snapshot({ ...freshFeeds(), roads: 'not-a-time' }), NOW).roads).toBe('missing');
  });
});

describe('near flooding', () => {
  it('keeps the worst severity and nearest distance for a road label', () => {
    const roads: FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [100.5001, 13.75] }, properties: { label: 'Road A', sev: 3 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [100.51, 13.75] }, properties: { label: 'Road A', sev: 4 } },
    ] };
    const result = nearFlooding([100.5, 13.75], roads, emptyCollection());

    expect(result.roads).toHaveLength(1);
    expect(result.roads[0].severity).toBe(4);
    expect(result.roads[0].km).toBeLessThan(0.1);
  });

  it('excludes non-finite coordinates', () => {
    const roads: FeatureCollection = { type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [Number.NaN, 13.75] }, properties: { label: 'Bad', sev: 4 },
    }] };
    const reports: FeatureCollection = { type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [100.5, Number.NaN] }, properties: {},
    }] };

    expect(nearFlooding([100.5, 13.75], roads, reports)).toEqual({ roads: [], reportCount: 0 });
  });
});
