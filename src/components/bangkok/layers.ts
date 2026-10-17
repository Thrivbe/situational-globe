import type { Snapshot } from '@/situations/types';

export type LayerKey =
  | 'roads' | 'reports' | 'radar' | 'danger' | 'depth' | 'raingrid'
  | 'hospitals' | 'shelters' | 'pumping' | 'fire'
  | 'districts' | 'transit' | 'stationWater' | 'waterways' | 'airports' | 'landmarks';

export type LayerGroupKey = 'flood' | 'help' | 'city';
export type LegendItem = { shape: 'line' | 'dot' | 'swatch'; color: string; label: string; thai: string };
export type LayerDefinition = {
  key: LayerKey;
  group: LayerGroupKey;
  label: string;
  thai: string;
  ids2d: string[];
  ids3d: string[];
  legend2d: LegendItem[];
  legend3d?: LegendItem[];
  count?(snapshot: Snapshot): number;
};

export const C = {
  blocked: '#ef4444', risky: '#fb923c', caution: '#facc15', ok: '#4ade80', rain: '#38bdf8',
  hospital: '#ec4899', shelter: '#14b8a6', pump: '#c2855a', fire: '#d6d3d1',
  landmark: '#c4b5fd', rail: '#e5e7eb', metro: '#60a5fa', sky: '#4ade80', airport: '#fde68a',
  canal: '#22d3ee', ferry: '#f59e0b',
};

export const C3 = {
  roadWater: '#2f7fe0', roadBlocked: '#ef4444', roadRisky: '#fb923c', roadCaution: '#facc15', roadOk: '#4ade80',
  ankle: '#4fc3ff', knee: '#f2a93b', waist: '#e5304a', head: '#ff3d81', closed: '#ff1744',
  metro: '#c084fc', rail: '#94a3b8', hospital: '#2dd4bf', shelter: '#a3e635', pump: '#818cf8',
};

const n = (label: string, thai: string, color: string, shape: LegendItem['shape']): LegendItem =>
  ({ label, thai, color, shape });

export const LAYERS: LayerDefinition[] = [
  { key: 'roads', group: 'flood', label: 'Flooded roads (for a sedan)', thai: 'ถนนน้ำท่วม (รถเก๋ง)',
    ids2d: ['roads-ok', 'roads-glow', 'roads-risk', 'roads-blocked', 'roads-hit'],
    ids3d: ['c3-roads-water', 'c3-water-sheen-fill', 'c3-water-sheen-edge', 'c3-glow-plus-wide', 'c3-glow-plus-mid',
      'c3-roads-halo', 'c3-roads-glow', 'c3-roads-core', 'c3-roads-dash', 'c3-roads-ribbon'],
    legend2d: [
      n('blocked for a sedan', 'รถเก๋งผ่านไม่ได้', C.blocked, 'line'), n('risky', 'เสี่ยง', C.risky, 'line'),
      n('caution', 'ระวัง', C.caution, 'line'), n('passable (dim)', 'ผ่านได้ (สีจาง)', C.ok, 'line'),
      n('no colour = no data, not dry', 'ไม่มีสี = ไม่มีข้อมูล ไม่ได้แปลว่าแห้ง', '#27313c', 'swatch'),
    ],
    legend3d: [
      n('water glow under risky roads', 'แสงน้ำใต้ถนนเสี่ยง', C3.roadWater, 'line'),
      n('blocked (static dash + ribbon)', 'ผ่านไม่ได้ (เส้นประคงที่ + แถบยกสูง)', C3.roadBlocked, 'line'),
      n('risky (raised ribbon)', 'เสี่ยง (แถบยกสูง)', C3.roadRisky, 'line'),
      n('caution', 'ระวัง', C3.roadCaution, 'line'),
    ], count: (snapshot) => snapshot.flood.roads.features.length },
  { key: 'reports', group: 'flood', label: 'Citizen reports', thai: 'รายงานประชาชน',
    ids2d: ['reports', 'reports-cluster', 'reports-cluster-count'],
    ids3d: ['c3-glow-plus-columns', 'c3-reports-cluster', 'c3-reports-cluster-count', 'c3-report-ring', 'c3-report-glow',
      'c3-report-columns', 'c3-report-caps'],
    legend2d: [
      n('cluster of reports (click to zoom)', 'กลุ่มรายงาน (คลิกเพื่อซูม)', '#0e3a5c', 'dot'),
      n('verified report', 'รายงานยืนยันแล้ว', C.rain, 'dot'), n('unverified report (hollow)', 'รายงานยังไม่ยืนยัน (วงกลวง)', '#7dd3fc', 'dot'),
      n('road closed', 'ถนนปิด', C.blocked, 'dot'),
    ],
    legend3d: [
      n('ankle depth column', 'เสาความลึกระดับข้อเท้า', C3.ankle, 'swatch'), n('knee depth column', 'เสาความลึกระดับเข่า', C3.knee, 'swatch'),
      n('waist depth column', 'เสาความลึกระดับเอว', C3.waist, 'swatch'), n('over-head depth column', 'เสาความลึกเหนือศีรษะ', C3.head, 'swatch'),
      n('white cap = road closed', 'ยอดสีขาว = ถนนปิด', '#ffffff', 'swatch'),
    ], count: (snapshot) => snapshot.flood.reports.features.length },
  { key: 'radar', group: 'flood', label: 'Rain radar', thai: 'เรดาร์ฝน', ids2d: ['radar'], ids3d: ['radar'], legend2d: [
    n('light rain', 'ฝนเบา', '#88ddee', 'swatch'), n('moderate rain', 'ฝนปานกลาง', '#0077ee', 'swatch'),
    n('heavy rain', 'ฝนหนัก', '#ffaa00', 'swatch'),
  ] },
  { key: 'danger', group: 'flood', label: 'Danger hexes', thai: 'พื้นที่อันตราย', ids2d: ['danger-grid', 'danger-grid-line'],
    ids3d: ['c3-danger', 'c3-danger-line'], legend2d: [
      n('danger', 'อันตราย', 'rgba(239,68,68,.55)', 'swatch'), n('warning', 'เตือน', 'rgba(251,146,60,.45)', 'swatch'),
      n('watch', 'เฝ้าระวัง', 'rgba(56,189,248,.35)', 'swatch'),
    ], legend3d: [
      n('danger (pulsing)', 'อันตราย (กะพริบ)', '#b3263a', 'swatch'), n('warning', 'เตือน', '#f2a93b', 'swatch'),
      n('watch', 'เฝ้าระวัง', '#2f7fe0', 'swatch'),
    ], count: (snapshot) => snapshot.flood.dangerHexes.features.length },
  { key: 'depth', group: 'flood', label: 'Depth labels', thai: 'ป้ายความลึก', ids2d: ['depth-dots', 'depth-labels'], ids3d: ['c3-depth-labels'],
    legend2d: [n('ankle / knee / waist / over head + cm', 'ข้อเท้า / เข่า / เอว / เหนือศีรษะ + ซม.', '#e6edf3', 'swatch')],
    legend3d: [n('deepest labels win collision placement', 'ป้ายจุดลึกที่สุดมีลำดับก่อน', '#ffffff', 'swatch')],
    count: (snapshot) => snapshot.flood.depthPoints.features.length },
  { key: 'raingrid', group: 'flood', label: 'Rain grid + district rain', thai: 'กริดฝนและฝนรายเขต',
    ids2d: ['raingrid', 'raingrid-label', 'raindist-label'], ids3d: [], legend2d: [
      n('rain soon (next 6 h)', 'ฝนเร็ว ๆ นี้ (6 ชม.)', C.rain, 'dot'), n('district rain chip', 'ชิปฝนรายเขต', '#1e293b', 'swatch'),
    ] },
  { key: 'hospitals', group: 'help', label: 'Hospitals', thai: 'โรงพยาบาล', ids2d: ['hospitals', 'hospitals-g'],
    ids3d: ['c3-hospitals', 'c3-hospitals-badge', 'c3-hospitals-glyph'],
    legend2d: [n('H  hospital', 'H โรงพยาบาล', C.hospital, 'dot')], legend3d: [n('H  hospital pillar', 'H เสาโรงพยาบาล', C3.hospital, 'dot')],
    count: (snapshot) => snapshot.osm.hospitals.features.length },
  { key: 'shelters', group: 'help', label: 'Possible gathering sites, not official', thai: 'จุดรวมพลที่เป็นไปได้ (ไม่เป็นทางการ)',
    ids2d: ['shelters', 'shelters-g'], ids3d: ['c3-shelters', 'c3-shelters-badge', 'c3-shelters-glyph'],
    legend2d: [n('S  possible gathering site', 'S จุดรวมพลที่เป็นไปได้', C.shelter, 'dot')],
    legend3d: [n('S  possible gathering-site pillar', 'S เสาจุดรวมพลที่เป็นไปได้', C3.shelter, 'dot')],
    count: (snapshot) => snapshot.osm.shelters.features.length },
  { key: 'pumping', group: 'help', label: 'Pumping stations, gates, weirs', thai: 'สถานีสูบน้ำ ประตูน้ำ และฝาย',
    ids2d: ['pumping', 'pumping-g'], ids3d: ['c3-pumping', 'c3-pumping-badge', 'c3-pumping-glyph'],
    legend2d: [n('P  pump / gate / weir', 'P ปั๊ม / ประตูน้ำ / ฝาย', C.pump, 'dot')],
    legend3d: [n('P  flood-control pillar', 'P เสาโครงสร้างควบคุมน้ำ', C3.pump, 'dot')],
    count: (snapshot) => snapshot.osm.pumping.features.length },
  { key: 'fire', group: 'help', label: 'Fire / rescue stations', thai: 'สถานีดับเพลิงและกู้ภัย', ids2d: ['fire', 'fire-g'], ids3d: [],
    legend2d: [n('F  fire station', 'F สถานีดับเพลิง', C.fire, 'dot')], count: (snapshot) => snapshot.osm.fireStations.features.length },
  { key: 'districts', group: 'city', label: 'Districts (50 khet)', thai: 'เขต (50 เขต)', ids2d: ['districts-fill', 'districts-line', 'districts-label'],
    ids3d: ['c3-districts'], legend2d: [
      n('district: 1–11 flood signals', 'เขต: สัญญาณน้ำท่วม 1–11', 'rgba(250,204,21,.45)', 'swatch'),
      n('12–39 signals', '12–39 สัญญาณ', 'rgba(251,146,60,.6)', 'swatch'), n('40+ signals', '40+ สัญญาณ', 'rgba(239,68,68,.75)', 'swatch'),
    ], legend3d: [n('taller and redder = more signals', 'สูงและแดงขึ้น = สัญญาณมากขึ้น', '#f43f5e', 'swatch')],
    count: (snapshot) => snapshot.osm.districts.features.length },
  { key: 'transit', group: 'city', label: 'Metro / rail lines + stations', thai: 'รถไฟฟ้า รถไฟ และสถานี',
    ids2d: ['rail', 'transit', 'stations', 'stations-label', 'rail-stations', 'rail-stations-label'],
    ids3d: ['c3-transit-osm', 'c3-transit-osm-stations', 'c3-transit-osm-station-labels',
      'c3-transit', 'c3-transit-stations', 'c3-transit-station-labels'], legend2d: [
      n('rail line (dashed)', 'ทางรถไฟ (เส้นประ)', C.rail, 'line'), n('metro / sky train', 'รถไฟฟ้า / บีทีเอส', C.metro, 'line'),
      n('station', 'สถานี', C.metro, 'dot'),
    ], legend3d: [
      n('metro / sky train', 'รถไฟฟ้า / บีทีเอส', C3.metro, 'line'), n('heavy rail', 'รถไฟทางไกล', C3.rail, 'line'),
      n('station', 'สถานี', '#ffffff', 'dot'),
    ], count: (snapshot) => snapshot.osm.transit.features.length },
  { key: 'stationWater', group: 'city', label: 'Water near station', thai: 'น้ำใกล้สถานี', ids2d: ['station-water'], ids3d: ['c3-station-water'],
    legend2d: [n('station with water within 500 m', 'สถานีที่มีน้ำภายใน 500 ม.', '#0c2a44', 'swatch')],
    legend3d: [n('station water chip', 'ชิปน้ำใกล้สถานี', '#ef4444', 'swatch')], count: (snapshot) => snapshot.stationWater.features.length },
  { key: 'waterways', group: 'city', label: 'Canals, rivers, boat lines', thai: 'คลอง แม่น้ำ และเส้นทางเรือ',
    ids2d: ['canals', 'canals-label', 'ferry'], ids3d: [], legend2d: [
      n('canal / river', 'คลอง / แม่น้ำ', C.canal, 'line'), n('boat line', 'เส้นทางเรือ', C.ferry, 'line'),
    ] },
  { key: 'airports', group: 'city', label: 'Airports', thai: 'สนามบิน', ids2d: ['airports', 'airports-label'], ids3d: [],
    legend2d: [n('airport', 'สนามบิน', C.airport, 'dot')] },
  { key: 'landmarks', group: 'city', label: 'Landmarks', thai: 'สถานที่สำคัญ', ids2d: ['landmarks', 'landmarks-g', 'landmarks-label'], ids3d: [],
    legend2d: [n('named landmark', 'สถานที่สำคัญที่มีชื่อ', C.landmark, 'dot')], count: (snapshot) => snapshot.osm.landmarks.features.length },
];

export const TWO_D_ONLY_KEYS = LAYERS.filter((layer) => !layer.ids3d.length).map((layer) => layer.key);

export const LAYER_GROUPS: { key: LayerGroupKey; label: string; thai: string; keys: LayerKey[] }[] = [
  { key: 'flood', label: 'Flood', thai: 'น้ำท่วม', keys: LAYERS.filter((layer) => layer.group === 'flood').map((layer) => layer.key) },
  { key: 'help', label: 'Help', thai: 'ความช่วยเหลือ', keys: LAYERS.filter((layer) => layer.group === 'help').map((layer) => layer.key) },
  { key: 'city', label: 'City', thai: 'เมือง', keys: LAYERS.filter((layer) => layer.group === 'city').map((layer) => layer.key) },
];

export const INITIAL_LAYERS = Object.fromEntries(
  LAYERS.map((layer) => [layer.key, layer.group === 'flood']),
) as Record<LayerKey, boolean>;

// Kept for slice 3a callers while the single table remains the source of truth.
export const LAYERS_2D = LAYERS.map((layer) => ({
  key: layer.key, label: layer.label, thai: layer.thai, ids: layer.ids2d, legend: layer.legend2d,
}));
