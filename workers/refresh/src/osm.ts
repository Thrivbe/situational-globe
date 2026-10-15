import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Point, Position } from 'geojson';
import type { Snapshot } from '../../../src/situations/types';
import { stitch } from '../../../src/situations/bangkok-flood-2026/derive';
import hospitalsSeed from '../../../src/situations/bangkok-flood-2026/osm-seed/hospitals.json';
import sheltersSeed from '../../../src/situations/bangkok-flood-2026/osm-seed/shelters.json';
import pumpingSeed from '../../../src/situations/bangkok-flood-2026/osm-seed/pumping.json';
import landmarksSeed from '../../../src/situations/bangkok-flood-2026/osm-seed/landmarks.json';
import fireStationsSeed from '../../../src/situations/bangkok-flood-2026/osm-seed/fireStations.json';
import transitSeed from '../../../src/situations/bangkok-flood-2026/osm-seed/transit.json';
import districtsSeed from '../../../src/situations/bangkok-flood-2026/osm-seed/districts.json';
import { fetchJson, isRecord, type FetchFn } from './feeds';

export const OVERPASS_HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

const BANGKOK_BBOX = [100.3, 13.5, 100.95, 14.05] as const;
const OVERPASS_BBOX = `(${BANGKOK_BBOX[1]},${BANGKOK_BBOX[0]},${BANGKOK_BBOX[3]},${BANGKOK_BBOX[2]})`;
const query = (body: string, output = 'out center tags;'): string =>
  `[out:json][timeout:60];${body};${output}`;

export const OVERPASS_QUERIES = {
  hospitals: query(`nwr[amenity=hospital]${OVERPASS_BBOX}`),
  shelters: query(`(nwr[emergency=assembly_point]${OVERPASS_BBOX};nwr[social_facility=shelter]${OVERPASS_BBOX};nwr[amenity=community_centre]${OVERPASS_BBOX};nwr[emergency=shelter]${OVERPASS_BBOX};)`),
  pumping: query(`(nwr[man_made=pumping_station]${OVERPASS_BBOX};nwr[man_made=water_works]${OVERPASS_BBOX};nwr[waterway=sluice_gate]${OVERPASS_BBOX};nwr[waterway=lock_gate]${OVERPASS_BBOX};nwr[waterway=weir]${OVERPASS_BBOX};)`),
  landmarks: query(`(nwr[tourism=attraction][name]${OVERPASS_BBOX};nwr[historic~"^(monument|memorial|castle|temple)$"][name]${OVERPASS_BBOX};)`),
  fireStations: query(`nwr[amenity=fire_station]${OVERPASS_BBOX}`),
  transit: query(`rel[type=route][route~"^(subway|monorail|light_rail)$"]${OVERPASS_BBOX}`, 'out geom qt;'),
  districts: query(`rel[boundary=administrative][admin_level=6]["name"~"^เขต"]${OVERPASS_BBOX}`, 'out geom qt;'),
} as const;

export type OsmKey = keyof typeof OVERPASS_QUERIES;
export const OSM_KEYS = Object.keys(OVERPASS_QUERIES) as OsmKey[];
export type OsmBlock = Snapshot['osm'];
type OverpassTags = Record<string, string>;

export const OSM_SEED_BUILT_AT = '2026-10-13T00:00:00.000Z';

function elementsOf(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.elements)) throw new Error('Overpass response is missing elements');
  return value.elements.filter(isRecord);
}

function tagsOf(element: Record<string, unknown>): OverpassTags {
  return isRecord(element.tags) ? element.tags as OverpassTags : {};
}

function coordinateOf(value: unknown): Position | null {
  if (!isRecord(value) || typeof value.lon !== 'number' || !Number.isFinite(value.lon) ||
    typeof value.lat !== 'number' || !Number.isFinite(value.lat)) return null;
  return [value.lon, value.lat];
}

function pointCollection(value: unknown): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const element of elementsOf(value)) {
    const coordinate = coordinateOf(element) ?? coordinateOf(element.center);
    if (!coordinate) continue;
    features.push({
      type: 'Feature',
      id: `${element.type}/${element.id}`,
      properties: tagsOf(element),
      geometry: { type: 'Point', coordinates: coordinate },
    });
  }
  if (!features.length) throw new Error('Overpass point result is empty');
  return { type: 'FeatureCollection', features };
}

function memberLine(member: unknown): Position[] | null {
  if (!isRecord(member) || member.type !== 'way' || !Array.isArray(member.geometry)) return null;
  const coordinates = member.geometry.map(coordinateOf).filter((point): point is Position => point !== null);
  return coordinates.length > 1 ? coordinates : null;
}

function transitCollection(value: unknown): FeatureCollection<Point | MultiLineString> {
  const features: Feature<Point | MultiLineString>[] = [];
  const stationRefs = new Set<string>();
  for (const element of elementsOf(value)) {
    const tags = tagsOf(element);
    const operator = tags.operator ?? '';
    const operatorEn = tags['operator:en'] ?? '';
    const name = tags.name ?? '';
    const nameEn = tags['name:en'] ?? '';
    const who = `${operator} ${operatorEn} ${tags.network ?? ''} ${name} ${nameEn}`;
    const bts = /\bBTS\b|Bangkok Mass Transit System|บีทีเอส/i.test(who);
    const kind = bts ? 'sky' : tags.route === 'subway' ? 'metro' : tags.route === 'monorail' ? 'monorail' : 'people';
    const fullName = nameEn || name;
    const line = fullName.replace(/\s*\(.*$/, '').replace(/\s+Supplementary Route$/i, '').trim();
    const ref = tags.ref ?? '';
    const members = Array.isArray(element.members) ? element.members : [];
    const ways = members.map(memberLine).filter((member): member is Position[] => member !== null);
    if (ways.length) {
      features.push({
        type: 'Feature',
        id: `${element.type}/${element.id}`,
        properties: {
          name: fullName,
          line,
          ref,
          operator: operatorEn || operator,
          color: /^#[0-9a-f]{3,8}$/i.test(tags.colour ?? '') ? tags.colour : '',
          kind: kind || 'line',
        },
        geometry: { type: 'MultiLineString', coordinates: ways },
      });
    }
    for (const member of members) {
      if (!isRecord(member) || member.type !== 'node' || typeof member.role !== 'string' ||
        (typeof member.ref !== 'number' && typeof member.ref !== 'string') ||
        (member.role !== 'platform' && (!member.role.startsWith('stop') || member.role === 'stop_inactive'))) continue;
      const coordinate = coordinateOf(member);
      const memberRef = String(member.ref);
      if (!coordinate || stationRefs.has(memberRef)) continue;
      stationRefs.add(memberRef);
      features.push({
        type: 'Feature',
        id: `node/${memberRef}`,
        properties: { kind: 'station', line, ref },
        geometry: { type: 'Point', coordinates: coordinate },
      });
    }
  }
  if (!features.length) throw new Error('Overpass transit result is empty');
  return { type: 'FeatureCollection', features };
}

function districtsCollection(value: unknown): FeatureCollection<MultiPolygon> {
  const features: Feature<MultiPolygon>[] = [];
  for (const element of elementsOf(value)) {
    const members = Array.isArray(element.members) ? element.members : [];
    const outers = members.filter((member) => isRecord(member) && member.role === 'outer')
      .map(memberLine).filter((line): line is Position[] => line !== null);
    const rings = stitch(outers);
    if (!rings.length) continue;
    const tags = tagsOf(element);
    const rawName = tags['name:en'] ?? tags.name ?? '';
    const population = Number(tags.population ?? 0);
    features.push({
      type: 'Feature',
      id: `${element.type}/${element.id}`,
      properties: {
        name: rawName.replace(/^เขต/, '').replace(/\s+District$/i, '').trim() || 'District',
        nameTh: tags['name:th'] ?? tags.name ?? '',
        population: Number.isFinite(population) ? population : 0,
      },
      geometry: { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
    });
  }
  if (!features.length) throw new Error('Overpass district result is empty');
  return { type: 'FeatureCollection', features };
}

export function convertOverpass(key: OsmKey, value: unknown): FeatureCollection {
  if (key === 'transit') return transitCollection(value);
  if (key === 'districts') return districtsCollection(value);
  return pointCollection(value);
}

export const overpassUrl = (key: OsmKey, host: string): string =>
  `${host}?data=${encodeURIComponent(OVERPASS_QUERIES[key])}`;

export async function fetchOverpassKey(
  fetcher: FetchFn,
  key: OsmKey,
  previousCount = 0,
): Promise<FeatureCollection> {
  let last: unknown = new Error(`${new URL(OVERPASS_HOSTS[0]).host}: request failed`);
  for (const host of OVERPASS_HOSTS) {
    try {
      const value = await fetchJson(fetcher, overpassUrl(key, host), 75_000);
      if (isRecord(value) && typeof value.remark === 'string' && /runtime error|timed out/i.test(value.remark)) {
        throw new Error(`${new URL(host).host}: ${value.remark}`);
      }
      const converted = convertOverpass(key, value);
      if (previousCount > 0 && converted.features.length < previousCount * 0.5) {
        throw new Error(`${new URL(host).host}: received ${converted.features.length} features after previously having ${previousCount}`);
      }
      return converted;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

const SEEDS: Record<OsmKey, unknown> = {
  hospitals: hospitalsSeed,
  shelters: sheltersSeed,
  pumping: pumpingSeed,
  landmarks: landmarksSeed,
  fireStations: fireStationsSeed,
  transit: transitSeed,
  districts: districtsSeed,
};

export function seedOsm(): OsmBlock {
  return {
    builtAt: OSM_SEED_BUILT_AT,
    ...Object.fromEntries(OSM_KEYS.map((key) => [key, convertOverpass(key, SEEDS[key])])),
  } as OsmBlock;
}
