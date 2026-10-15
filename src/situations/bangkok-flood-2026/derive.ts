import type { Feature, FeatureCollection, GeoJsonProperties, LineString, MultiLineString, Point, Polygon,
  Position } from 'geojson';
import type { Bbox, Level } from '../types';
const BANGKOK_CENTER: Position = [100.53, 13.75];
const BANGKOK_BBOX: Bbox = [100.3, 13.5, 100.95, 14.05];
const BLOCKED_SOURCES = new Set(['news', 'social_fb']);
const HEX = 0.02;
const SQRT_THREE = Math.sqrt(3);
const SEV: Record<string, number> = { blocked: 4, risky: 3, caution: 2, ok: 1 };
const inBangkok = ([longitude, latitude]: Position): boolean =>
  longitude > BANGKOK_BBOX[0] && longitude < BANGKOK_BBOX[2] &&
  latitude > BANGKOK_BBOX[1] && latitude < BANGKOK_BBOX[3];

export type RoadProps = Record<string, unknown> & {
  sedan: string; motorbike: string; pickup: string; truck: string;
  sev: number; named: boolean; label: string; srcs: string; depthCm: number | null;
};

export type ReportProps = Record<string, unknown> & {
  depth: number; closed: boolean; source: string; tier: string; ver: string; time: string; text: string;
};

export type FloodRoadFeature = Feature<LineString | MultiLineString, RoadProps>;
export type FloodReportFeature = Feature<Point, ReportProps>;
export type FloodData = {
  roads: FeatureCollection<LineString | MultiLineString, RoadProps>; reports: FeatureCollection<Point, ReportProps>;
  wx?: { current?: { time?: string } };
};
export type ForecastGridPoint = {
  lat: number; lon: number; time: readonly string[]; mm: readonly (number | null)[];
};
export const FORECAST_GRID_POINTS = [
  { lat: 13.6, lon: 100.4 }, { lat: 13.6, lon: 100.55 }, { lat: 13.6, lon: 100.7 },
  { lat: 13.75, lon: 100.4 }, { lat: 13.75, lon: 100.55 }, { lat: 13.75, lon: 100.7 },
  { lat: 13.9, lon: 100.4 }, { lat: 13.9, lon: 100.55 }, { lat: 13.9, lon: 100.7 },
] as const;

type DangerCell = {
  q: number; r: number; blocked: number; risky: number; reports: number; closed: number; rain6: number;
};
type DangerProperties = Omit<DangerCell, 'q' | 'r'> & { level: Level; name: string; score: number };
export type TransitMatch = { line: string; color: string; kind: string; operator: string };

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = false;
      } else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (character !== '\r') cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const REPORT_COLUMNS = ['lat', 'lon', 'source', 'tier', 'depth_cm', 'closed_all', 'cleared', 'time_utc'];

export function parseReportsCsv(text: string): { features: FloodReportFeature[]; dropped: number } {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  const header = rows.shift() ?? [];
  const missing = REPORT_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length) throw new Error(`reports CSV missing required columns: ${missing.join(', ')}`);
  const features: FloodReportFeature[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (row.length !== header.length) { dropped += 1; continue; }
    const values = Object.fromEntries(header.map((name, index) => [name, row[index]]));
    const latitude = Number(values.lat), longitude = Number(values.lon);
    if (!values.lat || !values.lon || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      dropped += 1;
      continue;
    }
    if (values.cleared === 'true' || BLOCKED_SOURCES.has(values.source)) continue;
    features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: {
        depth: values.depth_cm ? Number(values.depth_cm) : 0,
        closed: values.closed_all === 'true', source: values.source, tier: values.tier,
        ver: values.source === 'traffy' ? 'traffy' : values.tier === 'official' ? 'verified' : 'unverified',
        time: values.time_utc,
        text: values.source === 'crowd' || values.source === 'traffy' ? (values.text || '').slice(0, 140) : '',
      },
    });
  }
  return { features, dropped };
}

export function normaliseRoads(raw: unknown): {
  roads: FeatureCollection<LineString | MultiLineString, RoadProps>; dropped: number;
} {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { features?: unknown }).features)) {
    throw new Error('roads feed must be an object with a features array');
  }
  const features: FloodRoadFeature[] = [];
  let dropped = 0;
  for (const candidate of (raw as { features: unknown[] }).features) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) { dropped += 1; continue; }
    const feature = candidate as Record<string, unknown>;
    const geometry = feature.geometry as Record<string, unknown> | null;
    const validPosition = (position: unknown): boolean => Array.isArray(position) && position.length >= 2 &&
      position.every((value) => typeof value === 'number' && Number.isFinite(value));
    const validLine = (line: unknown): boolean => Array.isArray(line) && line.length >= 2 && line.every(validPosition);
    const validGeometry = geometry?.type === 'LineString' ? validLine(geometry.coordinates) :
      geometry?.type === 'MultiLineString' && Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0 && geometry.coordinates.every(validLine);
    if (feature.type !== 'Feature' || !validGeometry) { dropped += 1; continue; }
    const properties = typeof feature.properties === 'object' && feature.properties !== null &&
      !Array.isArray(feature.properties) ? feature.properties as Record<string, unknown> : {};
    const verdict = typeof properties.verdict === 'object' && properties.verdict !== null &&
      !Array.isArray(properties.verdict) ? properties.verdict as Record<string, unknown> : {};
    const sedan = properties.cleared === true ? 'ok' : typeof verdict.sedan === 'string' && verdict.sedan ? verdict.sedan : 'ok';
    const nameEn = typeof properties.nameEn === 'string' ? properties.nameEn : '';
    const name = typeof properties.name === 'string' ? properties.name : '';
    const highway = typeof properties.hw === 'string' ? properties.hw : '';
    features.push({
      ...feature as unknown as Feature<LineString | MultiLineString, RoadProps>,
      type: 'Feature', geometry: geometry as unknown as LineString | MultiLineString,
      properties: {
        ...properties, sedan,
        motorbike: typeof verdict.motorbike === 'string' ? verdict.motorbike : '',
        pickup: typeof verdict.pickup === 'string' ? verdict.pickup : '',
        truck: typeof verdict.truck === 'string' ? verdict.truck : '',
        sev: Object.hasOwn(SEV, sedan) ? SEV[sedan] || 1 : 1,
        named: Boolean(nameEn || name), label: nameEn || name || `Unnamed ${highway} road`,
        srcs: Array.isArray(properties.sources) ? properties.sources.join(', ') : '',
        depthCm: typeof properties.depthCm === 'number' && Number.isFinite(properties.depthCm) ? properties.depthCm : null,
      },
    });
  }
  return { roads: { type: 'FeatureCollection', features }, dropped };
}

const linesOf = (geometry: LineString | MultiLineString): Position[][] =>
  geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
const middlePoint = (geometry: LineString | MultiLineString): Position | null => {
  const line = linesOf(geometry).reduce<Position[]>((longest, item) => item.length > longest.length ? item : longest, []);
  return line[Math.floor(line.length / 2)] ?? null;
};

export function worst(data: FloodData): FloodRoadFeature[] {
  return data.roads.features.filter((feature) => feature.properties.sev >= 2)
    .sort((left, right) => right.properties.sev - left.properties.sev ||
      Number(right.properties.named) - Number(left.properties.named) ||
      (right.properties.depthCm ?? 0) - (left.properties.depthCm ?? 0));
}

export function centerOfTrouble(data: FloodData): Position {
  const points = [
    ...data.roads.features.filter((feature) => feature.properties.sev >= 3)
      .map((feature) => middlePoint(feature.geometry)).filter((point): point is Position => point !== null),
    ...data.reports.features.map((feature) => feature.geometry.coordinates),
  ].filter(inBangkok);
  const cells = new Map<string, Position[]>();
  for (const [longitude, latitude] of points) {
    const key = `${Math.floor(longitude / 0.02)},${Math.floor(latitude / 0.02)}`;
    cells.set(key, [...(cells.get(key) ?? []), [longitude, latitude]]);
  }
  const best = [...cells.values()].sort((left, right) => right.length - left.length)[0];
  return best ? [
    best.reduce((sum, point) => sum + point[0], 0) / best.length,
    best.reduce((sum, point) => sum + point[1], 0) / best.length,
  ] : [...BANGKOK_CENTER];
}

const depthWord = (cm: number): string => cm < 35 ? 'ankle' : cm < 70 ? 'knee' : cm < 120 ? 'waist' : 'over head';
const depthText = (cm: number): string => `${depthWord(cm)} ${cm >= 150 ? '150+' : Math.round(cm)} cm`;

export function depthPoints(data: FloodData): FeatureCollection<Point> {
  const candidates = [
    ...data.reports.features.filter((feature) => feature.properties.depth > 0)
      .map((feature) => ({ at: feature.geometry.coordinates, cm: feature.properties.depth, src: 'report', road: '' })),
    ...data.roads.features.filter((feature) => feature.properties.depthCm !== null &&
      feature.properties.depthCm > 0 && feature.properties.sev >= 2).map((feature) => ({
      at: middlePoint(feature.geometry) as Position, cm: feature.properties.depthCm as number,
      src: 'road', road: feature.properties.label,
    })),
  ].sort((left, right) => right.cm - left.cm);
  const seen = new Set<string>(), features: Feature<Point>[] = [];
  for (const candidate of candidates) {
    const key = `${Math.round(candidate.at[0] / 0.0015)},${Math.round(candidate.at[1] / 0.0015)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: candidate.at }, properties: {
      cm: candidate.cm, text: depthText(candidate.cm), deep: candidate.cm >= 120 ? 1 : 0,
      src: candidate.src, road: candidate.road,
    } });
  }
  return { type: 'FeatureCollection', features };
}

function hexOf(longitude: number, latitude: number): [number, number] {
  const q = (SQRT_THREE / 3 * longitude - latitude / 3) / HEX, r = (2 / 3 * latitude) / HEX;
  const cubeX = q, cubeZ = r, cubeY = -cubeX - cubeZ;
  let roundedX = Math.round(cubeX), roundedY = Math.round(cubeY), roundedZ = Math.round(cubeZ);
  const dx = Math.abs(roundedX - cubeX), dy = Math.abs(roundedY - cubeY), dz = Math.abs(roundedZ - cubeZ);
  if (dx > dy && dx > dz) roundedX = -roundedY - roundedZ;
  else if (dy > dz) roundedY = -roundedX - roundedZ;
  else roundedZ = -roundedX - roundedY;
  return [roundedX, roundedZ];
}

const hexPolygon = (q: number, r: number): Position[] => {
  const centerX = HEX * SQRT_THREE * (q + r / 2), centerY = HEX * 1.5 * r;
  return Array.from({ length: 7 }, (_, index) => {
    const angle = Math.PI / 180 * (60 * (index % 6) - 30);
    return [centerX + HEX * Math.cos(angle), centerY + HEX * Math.sin(angle)];
  });
};

export const DG_LEVEL = (score: number): Level => score >= 12 ? 3 : score >= 4 ? 2 : score >= 1 ? 1 : 0;
const DANGER_NAMES = ['', 'watch', 'warning', 'danger'] as const;

export function dangerGrid(data: FloodData, grid: readonly ForecastGridPoint[] | null = null): FeatureCollection<Polygon, DangerProperties> {
  const cells = new Map<string, DangerCell>();
  const cellAt = (longitude: number, latitude: number): DangerCell => {
    const [q, r] = hexOf(longitude, latitude), key = `${q},${r}`;
    let cell = cells.get(key);
    if (!cell) { cell = { q, r, blocked: 0, risky: 0, reports: 0, closed: 0, rain6: 0 }; cells.set(key, cell); }
    return cell;
  };
  for (const feature of data.roads.features) {
    const point = middlePoint(feature.geometry), severity = feature.properties.sev;
    if (severity < 3 || !point || !inBangkok(point)) continue;
    cellAt(point[0], point[1])[severity === 4 ? 'blocked' : 'risky'] += 1;
  }
  for (const feature of data.reports.features) {
    const point = feature.geometry.coordinates;
    if (!inBangkok(point)) continue;
    const cell = cellAt(point[0], point[1]);
    cell.reports += 1;
    if (feature.properties.closed) cell.closed += 1;
  }
  if (grid?.length) {
    const startIndex = Math.max(0, grid[0].time.findIndex((time) => time >= (data.wx?.current?.time ?? '').slice(0, 13)));
    for (const point of grid) {
      const rain6 = point.mm.slice(startIndex, startIndex + 6)
        .reduce<number>((sum, amount) => sum +
          (typeof amount === 'number' && Number.isFinite(amount) ? amount : 0), 0);
      if (rain6 < 1) continue;
      for (let dx = -0.12; dx <= 0.12; dx += HEX) for (let dy = -0.12; dy <= 0.12; dy += HEX) {
        const cell = cellAt(point.lon + dx, point.lat + dy);
        cell.rain6 = Math.max(cell.rain6, Number(rain6.toFixed(1)));
      }
    }
  }
  const features: Feature<Polygon, DangerProperties>[] = [];
  for (const { q, r, ...signals } of cells.values()) {
    const score = Number((3 * signals.blocked + signals.risky + 0.5 * signals.reports + signals.closed +
      (signals.rain6 >= 5 ? 2 : signals.rain6 >= 1 ? 1 : 0)).toFixed(1));
    const level = DG_LEVEL(score);
    if (level) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [hexPolygon(q, r)] },
      properties: { level, name: DANGER_NAMES[level], score, ...signals } });
  }
  return { type: 'FeatureCollection', features };
}

export function stitch(ways: readonly Position[][]): Position[][] {
  const equal = (left: Position, right: Position): boolean => left[0] === right[0] && left[1] === right[1];
  const pool = ways.filter((way) => way.length > 1).map((way) => way.slice()), rings: Position[][] = [];
  while (pool.length) {
    let current = pool.shift() as Position[];
    for (let guard = 0; guard < 500 && !equal(current[0], current[current.length - 1]); guard += 1) {
      const end = current[current.length - 1];
      const index = pool.findIndex((way) => equal(way[0], end) || equal(way[way.length - 1], end));
      if (index < 0) break;
      const way = pool.splice(index, 1)[0];
      if (!equal(way[0], end)) way.reverse();
      current = current.concat(way.slice(1));
    }
    if (current.length >= 4) { if (!equal(current[0], current[current.length - 1])) current.push(current[0]); rings.push(current); }
  }
  return rings;
}

export const distM = (left: Position, right: Position): number => Math.hypot(
  (left[0] - right[0]) * 111320 * Math.cos(left[1] * Math.PI / 180),
  (left[1] - right[1]) * 110540,
);

export function snapToTransit(
  transit: FeatureCollection<LineString | MultiLineString, Record<string, unknown>> | null,
  longitude: number, latitude: number, maxM = 100,
): TransitMatch | null {
  if (!transit) return null;
  const metresLongitude = 111320 * Math.cos(latitude * Math.PI / 180), metresLatitude = 110540, padding = maxM / 90000;
  let best: Record<string, unknown> | null = null, bestDistance = maxM;
  for (const feature of transit.features) for (const line of linesOf(feature.geometry)) for (let index = 1; index < line.length; index += 1) {
    const [x1, y1] = line[index - 1], [x2, y2] = line[index];
    if (longitude < Math.min(x1, x2) - padding || longitude > Math.max(x1, x2) + padding ||
      latitude < Math.min(y1, y2) - padding || latitude > Math.max(y1, y2) + padding) continue;
    const ax = (x1 - longitude) * metresLongitude, ay = (y1 - latitude) * metresLatitude;
    const bx = (x2 - longitude) * metresLongitude, by = (y2 - latitude) * metresLatitude;
    const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
    const along = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(ax + along * dx, ay + along * dy);
    if (distance < bestDistance) { bestDistance = distance; best = feature.properties; }
  }
  if (!best) return null;
  return {
    line: typeof best.line === 'string' ? best.line : typeof best.name === 'string' ? best.name : '',
    color: typeof best.color === 'string' ? best.color : '', kind: typeof best.kind === 'string' ? best.kind : '',
    operator: typeof best.operator === 'string' ? best.operator : '',
  };
}

export function stationWater(
  transit: FeatureCollection, roads: FloodData['roads'], reports: FloodData['reports'],
): FeatureCollection<Point> {
  const water: { position: Position; depth: number }[] = [];
  for (const feature of reports.features) if (feature.properties.closed || feature.properties.depth >= 30) {
    water.push({ position: feature.geometry.coordinates, depth: feature.properties.depth || 0 });
  }
  for (const feature of roads.features) if (feature.properties.sev === 4) {
    for (const position of linesOf(feature.geometry).flat()) water.push({ position, depth: 0 });
  }
  const features: Feature<Point>[] = [];
  // ponytail: stations x water points scan, grid-index points if it gets slow
  for (const feature of transit.features) {
    if (feature.geometry?.type !== 'Point') continue;
    let n = 0, maxDepthCm = 0;
    for (const sample of water) if (distM(sample.position, feature.geometry.coordinates) < 500) {
      n += 1; maxDepthCm = Math.max(maxDepthCm, sample.depth);
    }
    if (n) features.push({ type: 'Feature', ...(feature.id === undefined ? {} : { id: feature.id }),
      geometry: feature.geometry, properties: { ...(feature.properties ?? {}), maxDepthCm, n } });
  }
  return { type: 'FeatureCollection', features };
}

export function clipToBbox<G extends Point | LineString | MultiLineString | null, P = GeoJsonProperties>(
  collection: FeatureCollection<G, P>, bbox: Bbox,
): FeatureCollection<G, P> {
  return { ...collection, features: collection.features.filter((feature) => {
    if (!feature.geometry) return false;
    const positions = feature.geometry.type === 'Point' ? [feature.geometry.coordinates] :
      feature.geometry.type === 'LineString' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
    return positions.some(([longitude, latitude]) => longitude >= bbox[0] && longitude <= bbox[2] &&
      latitude >= bbox[1] && latitude <= bbox[3]);
  }) };
}

export function snapshotLevel(dangerHexes: FeatureCollection): Level {
  return Math.max(0, ...dangerHexes.features.map((feature) => Number(feature.properties?.level) || 0)) as Level;
}
