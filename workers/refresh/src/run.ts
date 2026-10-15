import type { FeatureCollection } from 'geojson';
import type { LocalMap, Situation, Snapshot } from '../../../src/situations/types';
import { validateSituation } from '../../../src/situations/validate';
import { stationWater, type FloodData } from '../../../src/situations/bangkok-flood-2026/derive';
import bangkokDefinition from '../../../src/situations/bangkok-flood-2026/situation.json';
import { buildSnapshot, type BuildFeeds } from './build';
import {
  fetchDistrictRain,
  fetchFloodReports,
  fetchFloodRoads,
  fetchForecast,
  fetchForecastGrid,
  fetchRiverDischarge,
  isRecord,
  type FetchFn,
} from './feeds';
import { fetchOverpassKey, OSM_KEYS, seedOsm, type OsmBlock, type OsmKey } from './osm';

export interface SnapshotStore {
  get(key: string): Promise<{ json(): Promise<unknown> } | null>;
  put(key: string, value: string, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}

export interface Env {
  SNAPSHOTS: SnapshotStore;
  SENTRY_DSN: string | undefined;
}

export interface Reporter {
  warn(message: string, key: { localMap: string; part: string }): void;
  error(error: unknown): void;
}

export interface RunOptions {
  fetcher: FetchFn;
  reporter: Reporter;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  situations?: readonly Situation[];
  builder?: typeof buildSnapshot;
}

export const SITUATIONS: readonly Situation[] = [validateSituation(bangkokDefinition)];

const SNAPSHOT_KEYS = [
  'localMap', 'situation', 'builtAt', 'feedsAt', 'level', 'credits', 'flood', 'weather', 'osm', 'stationWater',
] as const;

const isFeatureCollection = (value: unknown): value is FeatureCollection =>
  isRecord(value) && value.type === 'FeatureCollection' && Array.isArray(value.features);

type InvalidPrevious = { kind: 'invalid'; reason: string };
type PreviousResult =
  | { kind: 'missing' }
  | InvalidPrevious
  | { kind: 'error'; reason: string }
  | { kind: 'ok'; snapshot: Snapshot };

export function parseSnapshot(
  value: unknown,
  expected: { localMap: string; situation: string },
): InvalidPrevious | { kind: 'ok'; snapshot: Snapshot } {
  if (!isRecord(value)) return { kind: 'invalid', reason: 'snapshot is not an object' };
  const keys = Object.keys(value).sort();
  if (keys.join('\0') !== [...SNAPSHOT_KEYS].sort().join('\0')) {
    return { kind: 'invalid', reason: 'snapshot has the wrong top-level keys' };
  }
  if (value.localMap !== expected.localMap || value.situation !== expected.situation) {
    return {
      kind: 'invalid',
      reason: `snapshot ids are ${String(value.situation)}/${String(value.localMap)}, expected ${expected.situation}/${expected.localMap}`,
    };
  }
  if (typeof value.builtAt !== 'string' || !isRecord(value.feedsAt) ||
    !Object.values(value.feedsAt).every((time) => typeof time === 'string') ||
    typeof value.level !== 'number' || ![0, 1, 2, 3].includes(value.level) || !Array.isArray(value.credits) ||
    !isRecord(value.flood) || !isRecord(value.weather) || !isRecord(value.osm)) {
    return { kind: 'invalid', reason: 'snapshot metadata or main blocks have the wrong shape' };
  }
  const flood = value.flood;
  const weather = value.weather;
  const osm = value.osm;
  if (!isFeatureCollection(flood.roads) || !isFeatureCollection(flood.reports) ||
    !isFeatureCollection(flood.dangerHexes) || !isFeatureCollection(flood.depthPoints) ||
    !isRecord(weather.current) || !isRecord(weather.hourly) || !Array.isArray(weather.grid) ||
    !Array.isArray(weather.districtRain) || !Array.isArray(weather.river) ||
    typeof osm.builtAt !== 'string' || !isFeatureCollection(value.stationWater) ||
    !OSM_KEYS.every((key) => isFeatureCollection(osm[key]))) {
    return { kind: 'invalid', reason: 'snapshot contains a part with the wrong container' };
  }
  return { kind: 'ok', snapshot: value as unknown as Snapshot };
}

export async function readPrevious(
  store: SnapshotStore,
  key: string,
  expected: { localMap: string; situation: string },
): Promise<PreviousResult> {
  let object: { json(): Promise<unknown> } | null;
  try {
    object = await store.get(key);
  } catch (error) {
    return { kind: 'error', reason: reasonOf(error) };
  }
  if (!object) return { kind: 'missing' };
  try {
    return parseSnapshot(await object.json(), expected);
  } catch (error) {
    return { kind: 'invalid', reason: `snapshot JSON is invalid: ${reasonOf(error)}` };
  }
}

const reasonOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

async function fetchAll(fetcher: FetchFn, osm: OsmBlock): Promise<BuildFeeds> {
  const [roads, reports, forecast, grid, districtRain, river] = await Promise.allSettled([
    fetchFloodRoads(fetcher),
    fetchFloodReports(fetcher),
    fetchForecast(fetcher),
    fetchForecastGrid(fetcher),
    fetchDistrictRain(fetcher, osm.districts),
    fetchRiverDischarge(fetcher),
  ] as const);
  return { roads, reports, forecast, grid, districtRain, river };
}

type OsmRefreshResult = { osm: OsmBlock; failures: { key: OsmKey; reason: string }[] };

async function refreshOsm(
  fetcher: FetchFn,
  previous: OsmBlock,
  startedAt: number,
  now: () => Date,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<OsmRefreshResult> {
  const osm: OsmBlock = { ...previous };
  const failures: { key: OsmKey; reason: string }[] = [];
  for (let index = 0; index < OSM_KEYS.length; index += 1) {
    const key = OSM_KEYS[index];
    if (now().getTime() - startedAt >= 10 * 60 * 1_000) {
      failures.push(...OSM_KEYS.slice(index).map((unreached) => ({ key: unreached, reason: 'OSM deadline reached' })));
      break;
    }
    try {
      osm[key] = await fetchOverpassKey(fetcher, key, previous[key].features.length);
    } catch (error) {
      failures.push({ key, reason: reasonOf(error) });
    }
    if (index < OSM_KEYS.length - 1) await sleep(1_500);
  }
  osm.builtAt = failures.length === 0 ? now().toISOString() : previous.builtAt;
  return { osm, failures };
}

type MapState = { localMap: LocalMap; key: string; previous: Snapshot | null; snapshot: Snapshot };

export async function runRefresh(scheduledTime: number, env: Env, options: RunOptions): Promise<void> {
  const startedAt = options.now().getTime();
  const situations = options.situations ?? SITUATIONS;
  const builder = options.builder ?? buildSnapshot;
  let writes = 0;
  let warningCount = 0;
  let errorCount = 0;
  const warn = (message: string, key: { localMap: string; part: string }): void => {
    warningCount += 1;
    options.reporter.warn(message, key);
  };
  const reportError = (error: unknown): void => {
    errorCount += 1;
    options.reporter.error(error);
  };

  try {
    for (const situation of situations) {
      if (situation.status === 'past') continue;
      const states: MapState[] = [];

      for (const localMap of situation.localMaps) {
        try {
          const key = `snapshots/${localMap.id}.json`;
          const read = await readPrevious(env.SNAPSHOTS, key, { localMap: localMap.id, situation: situation.id });
          if (read.kind === 'error') {
            reportError(new Error(`${localMap.id}: previous snapshot read failed: ${read.reason}`));
            continue;
          }
          if (read.kind === 'invalid') {
            reportError(new Error(`${localMap.id}: invalid previous snapshot: ${read.reason}`));
          }
          const previous = read.kind === 'ok' ? read.snapshot : null;
          const osm = previous?.osm ?? seedOsm();
          const feeds = await fetchAll(options.fetcher, osm);
          const result = builder({
            situation,
            localMap,
            now: options.now().toISOString(),
            previous,
            feeds,
            osm,
          });
          for (const failure of result.failures) {
            warn(`${localMap.id}: ${failure.part} failed: ${failure.reason}`, {
              localMap: localMap.id,
              part: failure.part,
            });
          }
          if (result.failures.length === Object.keys(feeds).length) {
            reportError(new Error(`${localMap.id}: every flood and weather feed failed`));
          }
          await env.SNAPSHOTS.put(key, JSON.stringify(result.snapshot), {
            httpMetadata: { contentType: 'application/json' },
          });
          writes += 1;
          states.push({ localMap, key, previous, snapshot: result.snapshot });
        } catch (error) {
          reportError(error);
        }
      }

      const scheduled = new Date(scheduledTime);
      if (scheduled.getUTCHours() !== 3 || scheduled.getUTCMinutes() !== 0 || states.length === 0) continue;
      const previousOsm = states.find((state) => state.previous)?.previous?.osm ?? states[0].snapshot.osm;
      const refreshed = await refreshOsm(options.fetcher, previousOsm, startedAt, options.now, options.sleep);
      for (const failure of refreshed.failures) {
        warn(`${states[0].localMap.id}: osm.${failure.key} failed: ${failure.reason}`, {
          localMap: states[0].localMap.id,
          part: `osm.${failure.key}`,
        });
      }
      for (const state of states) {
        try {
          const snapshot = {
            ...state.snapshot,
            osm: refreshed.osm,
            stationWater: stationWater(
              refreshed.osm.transit,
              state.snapshot.flood.roads as FloodData['roads'],
              state.snapshot.flood.reports as FloodData['reports'],
            ),
          };
          await env.SNAPSHOTS.put(state.key, JSON.stringify(snapshot), {
            httpMetadata: { contentType: 'application/json' },
          });
          writes += 1;
        } catch (error) {
          reportError(error);
        }
      }
    }
  } finally {
    console.log(`[refresh] ${writes} snapshot writes; ${warningCount} warnings; ${errorCount} errors`);
  }
}
