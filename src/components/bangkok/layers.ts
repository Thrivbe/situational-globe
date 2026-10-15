export type LayerKey =
  | 'roads' | 'reports' | 'radar' | 'danger' | 'depth' | 'raingrid'
  | 'hospitals' | 'shelters' | 'pumping' | 'fire'
  | 'districts' | 'transit' | 'stationWater' | 'waterways' | 'airports' | 'landmarks';

export type LegendItem = { shape: 'line' | 'dot' | 'swatch'; color: string; label: string };
export type LayerDefinition = {
  key: LayerKey;
  label: string;
  thai: string;
  ids: string[];
  legend: LegendItem[];
};

export const C = {
  blocked: '#ef4444', risky: '#fb923c', caution: '#facc15', ok: '#4ade80', rain: '#38bdf8',
  hospital: '#ec4899', shelter: '#14b8a6', pump: '#c2855a', fire: '#d6d3d1',
  landmark: '#c4b5fd', rail: '#e5e7eb', metro: '#60a5fa', sky: '#4ade80', airport: '#fde68a',
  canal: '#22d3ee', ferry: '#f59e0b',
};

export const LAYERS_2D: LayerDefinition[] = [
  { key: 'roads', label: 'Flooded roads (for a sedan)', thai: 'ถนนน้ำท่วม (รถเก๋ง)', ids: ['roads-ok', 'roads-glow', 'roads-risk', 'roads-blocked', 'roads-hit'], legend: [
    { shape: 'line', color: C.blocked, label: 'blocked for a sedan' },
    { shape: 'line', color: C.risky, label: 'risky' },
    { shape: 'line', color: C.caution, label: 'caution' },
    { shape: 'line', color: C.ok, label: 'passable (dim)' },
    { shape: 'swatch', color: '#27313c', label: 'no colour = no data, not dry' },
  ] },
  { key: 'reports', label: 'Citizen reports', thai: 'รายงานประชาชน', ids: ['reports', 'reports-cluster', 'reports-cluster-count'], legend: [
    { shape: 'dot', color: '#0e3a5c', label: 'cluster of reports (click to zoom)' },
    { shape: 'dot', color: C.rain, label: 'verified report' },
    { shape: 'dot', color: '#7dd3fc', label: 'unverified report (hollow)' },
    { shape: 'dot', color: C.blocked, label: 'road closed' },
  ] },
  { key: 'radar', label: 'Rain radar', thai: 'เรดาร์ฝน', ids: ['radar'], legend: [
    { shape: 'swatch', color: '#88ddee', label: 'light rain' },
    { shape: 'swatch', color: '#0077ee', label: 'moderate rain' },
    { shape: 'swatch', color: '#ffaa00', label: 'heavy rain' },
  ] },
  { key: 'danger', label: 'Danger hexes', thai: 'พื้นที่อันตราย', ids: ['danger-grid', 'danger-grid-line'], legend: [
    { shape: 'swatch', color: 'rgba(239,68,68,.55)', label: 'danger' },
    { shape: 'swatch', color: 'rgba(251,146,60,.45)', label: 'warning' },
    { shape: 'swatch', color: 'rgba(56,189,248,.35)', label: 'watch' },
  ] },
  { key: 'depth', label: 'Depth labels', thai: 'ป้ายความลึก', ids: ['depth-dots', 'depth-labels'], legend: [
    { shape: 'swatch', color: '#e6edf3', label: 'ankle / knee / waist / over head + cm' },
  ] },
  { key: 'raingrid', label: 'Rain grid + district rain', thai: 'กริดฝนและฝนรายเขต', ids: ['raingrid', 'raingrid-label', 'raindist-label'], legend: [
    { shape: 'dot', color: C.rain, label: 'rain soon (next 6 h)' },
    { shape: 'swatch', color: '#1e293b', label: 'district rain chip' },
  ] },
  { key: 'hospitals', label: 'Hospitals', thai: 'โรงพยาบาล', ids: ['hospitals', 'hospitals-g'], legend: [{ shape: 'dot', color: C.hospital, label: 'H  hospital' }] },
  { key: 'shelters', label: 'Possible gathering sites, not official', thai: 'จุดรวมพลที่เป็นไปได้ (ไม่เป็นทางการ)', ids: ['shelters', 'shelters-g'], legend: [{ shape: 'dot', color: C.shelter, label: 'S  possible gathering site' }] },
  { key: 'pumping', label: 'Pumping stations, gates, weirs', thai: 'สถานีสูบน้ำ ประตูน้ำ และฝาย', ids: ['pumping', 'pumping-g'], legend: [{ shape: 'dot', color: C.pump, label: 'P  pump / gate / weir' }] },
  { key: 'fire', label: 'Fire / rescue stations', thai: 'สถานีดับเพลิงและกู้ภัย', ids: ['fire', 'fire-g'], legend: [{ shape: 'dot', color: C.fire, label: 'F  fire station' }] },
  { key: 'districts', label: 'Districts (50 khet)', thai: 'เขต (50 เขต)', ids: ['districts-fill', 'districts-line', 'districts-label'], legend: [
    { shape: 'swatch', color: 'rgba(250,204,21,.45)', label: 'district: 1–11 flood signals' },
    { shape: 'swatch', color: 'rgba(251,146,60,.6)', label: '12–39 signals' },
    { shape: 'swatch', color: 'rgba(239,68,68,.75)', label: '40+ signals' },
  ] },
  { key: 'transit', label: 'Metro / rail lines + stations', thai: 'รถไฟฟ้า รถไฟ และสถานี', ids: ['rail', 'transit', 'stations', 'stations-label', 'rail-stations', 'rail-stations-label'], legend: [
    { shape: 'line', color: C.rail, label: 'rail line (dashed)' },
    { shape: 'line', color: C.metro, label: 'metro / sky train' },
    { shape: 'dot', color: C.metro, label: 'station' },
  ] },
  { key: 'stationWater', label: 'Water near station', thai: 'น้ำใกล้สถานี', ids: ['station-water'], legend: [{ shape: 'swatch', color: '#0c2a44', label: 'station with water within 500 m' }] },
  { key: 'waterways', label: 'Canals, rivers, boat lines', thai: 'คลอง แม่น้ำ และเส้นทางเรือ', ids: ['canals', 'canals-label', 'ferry'], legend: [
    { shape: 'line', color: C.canal, label: 'canal / river' },
    { shape: 'line', color: C.ferry, label: 'boat line' },
  ] },
  { key: 'airports', label: 'Airports', thai: 'สนามบิน', ids: ['airports', 'airports-label'], legend: [{ shape: 'dot', color: C.airport, label: 'airport' }] },
  { key: 'landmarks', label: 'Landmarks', thai: 'สถานที่สำคัญ', ids: ['landmarks', 'landmarks-g', 'landmarks-label'], legend: [{ shape: 'dot', color: C.landmark, label: 'named landmark' }] },
];

export const LAYER_GROUPS: { label: string; thai: string; keys: LayerKey[] }[] = [
  { label: 'Flood', thai: 'น้ำท่วม', keys: ['roads', 'reports', 'radar', 'danger', 'depth', 'raingrid'] },
  { label: 'Help', thai: 'ความช่วยเหลือ', keys: ['hospitals', 'shelters', 'pumping', 'fire'] },
  { label: 'City', thai: 'เมือง', keys: ['districts', 'transit', 'stationWater', 'waterways', 'airports', 'landmarks'] },
];

export const INITIAL_LAYERS: Record<LayerKey, boolean> = Object.fromEntries(
  LAYERS_2D.map((layer) => [layer.key, LAYER_GROUPS[0].keys.includes(layer.key)]),
) as Record<LayerKey, boolean>;
