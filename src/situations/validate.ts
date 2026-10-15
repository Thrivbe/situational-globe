import type { Bbox, LocalMap, Situation } from './types';

const TOP_LEVEL_KEYS = new Set([
  'id', 'title', 'story', 'hazard', 'status', 'defaultGlobalLayers', 'situationLayers', 'fallbackLevel', 'localMaps',
]);
const LOCAL_MAP_KEYS = new Set(['id', 'name', 'bbox', 'feeds', 'layers2d', 'cityPack']);
const CITY_PACK_KEYS = new Set(['buildings', 'minZoom']);

function check(condition: unknown, path: string, message: string): asserts condition {
  if (!condition) throw new Error(`${path}: ${message}`);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) check(allowed.has(key), path ? `${path}.${key}` : key, 'unknown field');
}

export function validateSituation(value: unknown): Situation {
  check(typeof value === 'object' && value !== null && !Array.isArray(value), 'situation', 'expected an object');
  const situation = value as Record<string, unknown>;
  rejectUnknownKeys(situation, TOP_LEVEL_KEYS, '');

  check(typeof situation.id === 'string' && situation.id.length > 0, 'id', 'expected a non-empty string');
  check(typeof situation.title === 'string' && situation.title.length > 0, 'title', 'expected a non-empty string');
  check(typeof situation.story === 'string', 'story', 'expected a string');
  check(typeof situation.hazard === 'string', 'hazard', 'expected a string');
  check(situation.status === 'live' || situation.status === 'past', 'status', "expected 'live' or 'past'");
  check(Array.isArray(situation.defaultGlobalLayers) &&
    situation.defaultGlobalLayers.every((item) => typeof item === 'string'), 'defaultGlobalLayers', 'expected an array of strings');
  check(Array.isArray(situation.situationLayers) &&
    situation.situationLayers.every((item) => typeof item === 'string'), 'situationLayers', 'expected an array of strings');
  check(Array.isArray(situation.localMaps), 'localMaps', 'expected an array');

  const localMaps = situation.localMaps.map((value, index): LocalMap => {
    const path = `localMaps[${index}]`;
    check(typeof value === 'object' && value !== null && !Array.isArray(value), path, 'expected an object');
    const map = value as Record<string, unknown>;
    rejectUnknownKeys(map, LOCAL_MAP_KEYS, path);
    check(typeof map.id === 'string' && map.id.length > 0, `${path}.id`, 'expected a non-empty string');
    check(typeof map.name === 'string', `${path}.name`, 'expected a string');
    check(Array.isArray(map.feeds) && map.feeds.every((item) => typeof item === 'string'),
      `${path}.feeds`, 'expected an array of strings');
    check(Array.isArray(map.layers2d) && map.layers2d.every((item) => typeof item === 'string'),
      `${path}.layers2d`, 'expected an array of strings');
    const bbox = map.bbox;
    check(Array.isArray(bbox) && bbox.length === 4 && bbox.every((item) => typeof item === 'number' && Number.isFinite(item)) &&
      bbox[0] < bbox[2] && bbox[1] < bbox[3] && bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90,
    `${path}.bbox`, 'expected four finite bounds with west < east and south < north within ±180/±90');

    let cityPack: LocalMap['cityPack'];
    if (map.cityPack !== undefined) {
      check(typeof map.cityPack === 'object' && map.cityPack !== null && !Array.isArray(map.cityPack),
        `${path}.cityPack`, 'expected an object');
      const pack = map.cityPack as Record<string, unknown>;
      rejectUnknownKeys(pack, CITY_PACK_KEYS, `${path}.cityPack`);
      check(typeof pack.buildings === 'string', `${path}.cityPack.buildings`, 'expected a string');
      check(typeof pack.minZoom === 'number' && Number.isFinite(pack.minZoom) && pack.minZoom >= 0 && pack.minZoom <= 22,
        `${path}.cityPack.minZoom`, 'expected a finite number from 0 to 22');
      cityPack = { buildings: pack.buildings, minZoom: pack.minZoom };
    }
    return {
      id: map.id, name: map.name, bbox: bbox as Bbox, feeds: map.feeds, layers2d: map.layers2d,
      ...(cityPack ? { cityPack } : {}),
    };
  });

  check(new Set(localMaps.map((map) => map.id)).size === localMaps.length, 'localMaps', 'duplicate local-map id');
  if (localMaps.length === 0) {
    check(typeof situation.fallbackLevel === 'number', 'fallbackLevel', 'must be a number when localMaps is empty');
  }
  check(situation.fallbackLevel === null || situation.fallbackLevel === 0 || situation.fallbackLevel === 1 ||
    situation.fallbackLevel === 2 || situation.fallbackLevel === 3,
  'fallbackLevel', 'expected null or an integer from 0 to 3');

  return {
    id: situation.id, title: situation.title, story: situation.story, hazard: situation.hazard,
    status: situation.status, defaultGlobalLayers: situation.defaultGlobalLayers,
    situationLayers: situation.situationLayers, fallbackLevel: situation.fallbackLevel, localMaps,
  };
}
