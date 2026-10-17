import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { haversine, type LngLat } from '@/lib/geo';
import type { Snapshot } from '@/situations/types';

export type Bounds = [west: number, south: number, east: number, north: number];
export const BANGKOK_CENTRE: [number, number] = [100.53, 13.75];
export const SNAPSHOT_PARTS = ['roads', 'reports', 'forecast', 'grid', 'districtRain', 'river', 'osm'] as const;
export type SnapshotPart = typeof SNAPSHOT_PARTS[number];
export type SnapshotPartStatus = 'ok' | 'stale' | 'missing';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const textValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

export const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const stringList = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : [];

export const propertiesOf = (feature: Feature): Record<string, unknown> =>
  isRecord(feature.properties) ? feature.properties : {};

export const snapshotPartTime = (snapshot: Snapshot, part: SnapshotPart): string =>
  part === 'osm' ? snapshot.osm.builtAt : snapshot.feedsAt[part] ?? '';

export function partStatus(snapshot: Snapshot, now: Date | number): Record<SnapshotPart, SnapshotPartStatus> {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return Object.fromEntries(SNAPSHOT_PARTS.map((part) => {
    const time = Date.parse(snapshotPartTime(snapshot, part));
    if (!Number.isFinite(time)) return [part, 'missing'];
    const maxAge = part === 'osm' ? 48 * 60 * 60 * 1_000 : 60 * 60 * 1_000;
    return [part, nowMs - time > maxAge ? 'stale' : 'ok'];
  })) as Record<SnapshotPart, SnapshotPartStatus>;
}

export function bangkokDay(now: number): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function timeAgo(value: string | number, now = Date.now()): string {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '—';
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 2_880) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1_440)} d ago`;
}

export function bangkokTime(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

function visitCoordinates(value: unknown, bounds: Bounds): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    bounds[0] = Math.min(bounds[0], value[0]);
    bounds[1] = Math.min(bounds[1], value[1]);
    bounds[2] = Math.max(bounds[2], value[0]);
    bounds[3] = Math.max(bounds[3], value[1]);
    return;
  }
  for (const child of value) visitCoordinates(child, bounds);
}

export function geometryBounds(geometry: Geometry | null): Bounds | null {
  if (!geometry || geometry.type === 'GeometryCollection') return null;
  const bounds: Bounds = [180, 90, -180, -90];
  visitCoordinates(geometry.coordinates, bounds);
  return bounds[0] <= bounds[2] && bounds[1] <= bounds[3] ? bounds : null;
}

export function featureCentre(feature: Feature): Position | null {
  if (feature.geometry?.type === 'Point') return feature.geometry.coordinates;
  const bounds = geometryBounds(feature.geometry);
  return bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null;
}

export type RoadGroup = {
  label: string;
  severity: number;
  blocked: number;
  risky: number;
  caution: number;
  depth: number;
  updated: number;
  bounds: Bounds;
};

export function roadGroups(roads: FeatureCollection): RoadGroup[] {
  const groups = new Map<string, RoadGroup & { zoomSeverity: number; zoomDepth: number }>();
  for (const feature of roads.features) {
    const properties = propertiesOf(feature);
    const severity = numberValue(properties.sev, 1);
    if (severity < 2) continue;
    const label = textValue(properties.label, 'Unnamed road');
    const bounds = geometryBounds(feature.geometry);
    if (!bounds) continue;
    const depth = numberValue(properties.depthCm);
    const group = groups.get(label) ?? {
      label, severity: 0, blocked: 0, risky: 0, caution: 0, depth: 0, updated: 0,
      bounds, zoomSeverity: 0, zoomDepth: 0,
    };
    group.severity = Math.max(group.severity, severity);
    if (severity >= 4) group.blocked += 1;
    else if (severity === 3) group.risky += 1;
    else group.caution += 1;
    group.depth = Math.max(group.depth, depth);
    group.updated = Math.max(group.updated, numberValue(properties.updated));
    if (severity > group.zoomSeverity || (severity === group.zoomSeverity && depth > group.zoomDepth)) {
      group.bounds = bounds;
      group.zoomSeverity = severity;
      group.zoomDepth = depth;
    }
    groups.set(label, group);
  }
  return [...groups.values()].map((group): RoadGroup => ({
    label: group.label,
    severity: group.severity,
    blocked: group.blocked,
    risky: group.risky,
    caution: group.caution,
    depth: group.depth,
    updated: group.updated,
    bounds: group.bounds,
  }))
    .sort((left, right) => right.severity - left.severity || right.depth - left.depth ||
    (right.blocked + right.risky) - (left.blocked + left.risky));
}

export type RoadCounts = { blocked: number; risky: number; caution: number; ok: number };

export function roadCounts(roads: FeatureCollection): RoadCounts {
  const counts: RoadCounts = { blocked: 0, risky: 0, caution: 0, ok: 0 };
  for (const feature of roads.features) {
    const sedan = textValue(propertiesOf(feature).sedan, 'ok');
    if (Object.hasOwn(counts, sedan)) counts[sedan as keyof RoadCounts] += 1;
  }
  return counts;
}

export function deepestKnown(roads: FeatureCollection, reports: FeatureCollection): { cm: number; where: string } {
  let deepest = { cm: 0, where: '' };
  for (const feature of roads.features) {
    const properties = propertiesOf(feature);
    const cm = numberValue(properties.depthCm);
    if (cm > deepest.cm) deepest = { cm, where: textValue(properties.label, 'road') };
  }
  for (const feature of reports.features) {
    const cm = numberValue(propertiesOf(feature).depth);
    if (cm > deepest.cm) deepest = { cm, where: 'citizen report' };
  }
  return deepest;
}

export type RainRow = { name?: string; lat: number; lon: number; time: string[]; mm: number[] };

export function rainRows(value: unknown): RainRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const lat = numberValue(candidate.lat, Number.NaN);
    const lon = numberValue(candidate.lon, Number.NaN);
    const time = stringList(candidate.time);
    const raw = Array.isArray(candidate.mm) ? candidate.mm : [];
    const mm = raw.map((item) => numberValue(item));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !time.length || time.length !== mm.length) return [];
    const name = textValue(candidate.name);
    return [{ lat, lon, time, mm, ...(name ? { name } : {}) }];
  });
}

export function numberValues(value: unknown, length = Number.POSITIVE_INFINITY): number[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, length).map((item) => numberValue(item));
}

export type RainMetrics = { now: number; next3: number; next6: number; next24: number };

export function metricsAt(mm: number[], index: number): RainMetrics {
  if (index < 0 || index >= mm.length) {
    return { now: Number.NaN, next3: Number.NaN, next6: Number.NaN, next24: Number.NaN };
  }
  const sum = (hours: number) => {
    let total = 0;
    for (let cursor = index; cursor < Math.min(index + hours, mm.length); cursor += 1) total += mm[cursor];
    return Number(total.toFixed(1));
  };
  return {
    now: mm[index],
    next3: sum(3),
    next6: sum(6),
    next24: sum(24),
  };
}

export type RiverRow = { name: string; days: string[]; q: number[] };

export function riverRows(value: unknown): RiverRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const name = textValue(candidate.name, 'River cell');
    const days = stringList(candidate.days);
    const q = numberValues(candidate.q, days.length);
    return days.length && q.length === days.length ? [{ name, days, q }] : [];
  });
}

const namesOf = (feature: Feature): string[] => {
  const properties = propertiesOf(feature);
  return [textValue(properties.name), textValue(properties.nameTh)].filter(Boolean);
};

export function districtNames(districts: FeatureCollection): string[] {
  return [...new Set(districts.features.flatMap(namesOf))];
}

export function findDistrict(districts: FeatureCollection, query: string): Feature | undefined {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return undefined;
  const lowerNames = (feature: Feature) => namesOf(feature).map((name) => name.toLocaleLowerCase());
  return districts.features.find((feature) => lowerNames(feature).includes(needle))
    ?? districts.features.find((feature) => lowerNames(feature).some((name) => name.includes(needle)));
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > point[1]) !== (previousY > point[1]) &&
      point[0] < (previousX - x) * (point[1] - y) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(point: Position, geometry: Geometry | null): boolean {
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some((polygon) => Boolean(polygon[0]) && pointInRing(point, polygon[0]) &&
    !polygon.slice(1).some((hole) => pointInRing(point, hole)));
}

export function districtsWithSignals(
  districts: FeatureCollection,
  dangerHexes: FeatureCollection,
): FeatureCollection {
  const signals = districts.features.map(() => 0);
  for (const danger of dangerHexes.features) {
    const centre = featureCentre(danger);
    if (!centre) continue;
    const districtIndex = districts.features.findIndex((district) => pointInGeometry(centre, district.geometry));
    if (districtIndex >= 0) signals[districtIndex] += Math.max(1, numberValue(propertiesOf(danger).score));
  }
  return {
    type: 'FeatureCollection',
    features: districts.features.map((feature, index) => ({
      ...feature,
      properties: { ...propertiesOf(feature), signals: Math.round(signals[index]) },
    })),
  };
}

export function pointsOf(geometry: Geometry | null): Position[] {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') return geometry.coordinates;
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return geometry.geometries.flatMap(pointsOf);
}

export function nearFlooding(
  at: Position,
  roads: FeatureCollection,
  reports: FeatureCollection,
): { roads: { label: string; severity: number; km: number }[]; reportCount: number } {
  const distance = (feature: Feature) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const point of pointsOf(feature.geometry)) {
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      const km = haversine(at as LngLat, point as LngLat);
      if (Number.isFinite(km) && km < nearest) nearest = km;
    }
    return nearest;
  };
  const nearby = new Map<string, { label: string; severity: number; km: number }>();
  for (const feature of roads.features) {
    const properties = propertiesOf(feature);
    const severity = numberValue(properties.sev, 1);
    if (severity < 3) continue;
    const km = distance(feature);
    if (!(km <= 3)) continue;
    const label = textValue(properties.label, 'Unnamed road');
    const previous = nearby.get(label);
    nearby.set(label, {
      label,
      severity: Math.max(severity, previous?.severity ?? 0),
      km: Math.min(km, previous?.km ?? Number.POSITIVE_INFINITY),
    });
  }
  let reportCount = 0;
  for (const feature of reports.features) if (distance(feature) <= 3) reportCount += 1;
  return {
    roads: [...nearby.values()].sort((left, right) => right.severity - left.severity || left.km - right.km),
    reportCount,
  };
}

export const severityName = (severity: number): keyof RoadCounts =>
  severity >= 4 ? 'blocked' : severity === 3 ? 'risky' : severity === 2 ? 'caution' : 'ok';

// ponytail: top-level shape only; the refresh Worker validates the parts before it writes.
export function isSnapshotShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const isObject = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x);
  return Array.isArray(v.credits) && isObject(v.feedsAt) && isObject(v.flood) && isObject(v.weather) && isObject(v.osm) &&
    isObject(v.stationWater);
}
