import type { FeatureCollection, LineString, MultiLineString, Point } from 'geojson';
import type { LocalMap, Snapshot, Situation } from '../../../src/situations/types';
import {
  clipToBbox,
  dangerGrid,
  depthPoints,
  normaliseRoads,
  parseReportsCsv,
  snapshotLevel,
  stationWater,
  type FloodData,
  type ForecastGridPoint,
  type ReportProps,
  type RoadProps,
} from '../../../src/situations/bangkok-flood-2026/derive';
import type { DistrictRain, ForecastData, RiverDischarge } from './feeds';

export type BuildFeeds = {
  roads: PromiseSettledResult<unknown>;
  reports: PromiseSettledResult<string>;
  forecast: PromiseSettledResult<ForecastData>;
  grid: PromiseSettledResult<ForecastGridPoint[]>;
  districtRain: PromiseSettledResult<DistrictRain[]>;
  river: PromiseSettledResult<RiverDischarge[]>;
};

export type FeedPart = keyof BuildFeeds;
export type BuildFailure = { part: FeedPart; reason: string };

export type BuildSnapshotInput = {
  situation: Situation;
  localMap: LocalMap;
  now: string;
  previous: Snapshot | null;
  feeds: BuildFeeds;
  osm: Snapshot['osm'];
};

export type BuildSnapshotResult = {
  snapshot: Snapshot;
  failures: BuildFailure[];
};

const emptyCollection = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });
const reasonOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const CREDITS: Snapshot['credits'] = [
  {
    feed: 'floodboard',
    text: 'Flood roads/reports © Floodboard',
    url: 'https://floodboard.org',
    licence: 'CC BY 4.0',
    note: 'may be incomplete',
  },
  {
    feed: 'open-meteo',
    text: 'Weather and river discharge data by Open-Meteo.com',
    url: 'https://open-meteo.com/',
    licence: 'CC BY 4.0',
  },
  {
    feed: 'rainviewer',
    text: 'Radar © RainViewer',
    url: 'https://www.rainviewer.com',
    licence: 'RainViewer attribution',
  },
  {
    feed: 'openstreetmap',
    text: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    licence: 'ODbL',
  },
  {
    feed: 'openfreemap',
    text: 'Basemap by OpenFreeMap / OpenMapTiles',
    url: 'https://tiles.openfreemap.org/styles/dark',
    licence: 'OpenFreeMap / OpenMapTiles attribution',
  },
];

function dropRatioFailure(kept: number, dropped: number): string | null {
  const total = kept + dropped;
  return total > 0 && dropped / total > 0.05
    ? `dropped ${dropped} of ${total} records (${(100 * dropped / total).toFixed(1)}%)`
    : null;
}

export function buildSnapshot(input: BuildSnapshotInput): BuildSnapshotResult {
  const { situation, localMap, now, previous, feeds, osm } = input;
  const failures: BuildFailure[] = [];
  const feedsAt = { ...(previous?.feedsAt ?? {}) };

  const fail = (part: FeedPart, error: unknown): void => {
    failures.push({ part, reason: reasonOf(error) });
  };
  const take = <T>(
    part: FeedPart,
    settled: PromiseSettledResult<T>,
    fallback: T,
    validate: (value: T) => T = (value) => value,
  ): T => {
    if (settled.status === 'rejected') {
      fail(part, settled.reason);
      return fallback;
    }
    try {
      const value = validate(settled.value);
      feedsAt[part] = now;
      return value;
    } catch (error) {
      fail(part, error);
      return fallback;
    }
  };
  const takeFlood = <T, F extends FeatureCollection>(
    part: 'roads' | 'reports',
    settled: PromiseSettledResult<T>,
    fallback: F,
    convert: (value: T) => { value: F; kept: number; dropped: number },
  ): F => {
    if (settled.status === 'rejected') {
      fail(part, settled.reason);
      return fallback;
    }
    try {
      const candidate = convert(settled.value);
      const ratioFailure = dropRatioFailure(candidate.kept, candidate.dropped);
      if (ratioFailure) throw new Error(ratioFailure);
      const previousCount = fallback.features.length;
      const previousAt = Date.parse(previous?.feedsAt[part] ?? '');
      const stale = Number.isFinite(previousAt) && Date.parse(now) - previousAt > 3 * 60 * 60 * 1_000;
      if (!stale && previousCount > 50 && candidate.value.features.length < previousCount * 0.2) {
        throw new Error(`received ${candidate.value.features.length} features after previously having ${previousCount}`);
      }
      feedsAt[part] = now;
      return candidate.value;
    } catch (error) {
      fail(part, error);
      return fallback;
    }
  };

  const roadFallback = (previous?.flood.roads ?? emptyCollection()) as
    FeatureCollection<LineString | MultiLineString, RoadProps>;
  const roads = takeFlood('roads', feeds.roads, roadFallback, (raw) => {
    const normalised = normaliseRoads(raw);
    return {
      value: clipToBbox(normalised.roads, localMap.bbox),
      kept: normalised.roads.features.length,
      dropped: normalised.dropped,
    };
  });

  const reportFallback = (previous?.flood.reports ?? emptyCollection()) as FeatureCollection<Point, ReportProps>;
  const reports = takeFlood('reports', feeds.reports, reportFallback, (csv) => {
    const parsed = parseReportsCsv(csv);
    return {
      value: clipToBbox({ type: 'FeatureCollection', features: parsed.features }, localMap.bbox),
      kept: parsed.features.length,
      dropped: parsed.dropped,
    };
  });

  const forecast = take('forecast', feeds.forecast, {
    current: previous?.weather.current ?? {},
    hourly: previous?.weather.hourly ?? {},
  }, (value) => {
    if (typeof value.current.time !== 'string' || !Array.isArray(value.hourly.time) || value.hourly.time.length === 0) {
      throw new Error('forecast is missing current.time or hourly.time');
    }
    return value;
  });
  const grid = take('grid', feeds.grid, (previous?.weather.grid ?? []) as ForecastGridPoint[], (value) => {
    if (value.flatMap((point) => point.mm).every((amount) => amount === null)) {
      throw new Error('forecast grid contains no precipitation values');
    }
    return value;
  });
  const districtRain = take('districtRain', feeds.districtRain,
    (previous?.weather.districtRain ?? []) as DistrictRain[]);
  const river = take('river', feeds.river, (previous?.weather.river ?? []) as RiverDischarge[]);

  const floodData: FloodData = { roads, reports, wx: { current: forecast.current } };
  const dangerHexes = dangerGrid(floodData, grid);
  const depths = depthPoints(floodData);

  return {
    failures,
    snapshot: {
      localMap: localMap.id,
      situation: situation.id,
      builtAt: now,
      feedsAt,
      level: snapshotLevel(dangerHexes),
      credits: CREDITS,
      flood: { roads, reports, dangerHexes, depthPoints: depths },
      weather: { current: forecast.current, hourly: forecast.hourly, grid, districtRain, river },
      osm,
      stationWater: stationWater(osm.transit, roads, reports),
    },
  };
}
